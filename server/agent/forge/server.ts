/**
 * Tool MCP `forge` (PLAN Lampiran B). Gerbang ditegakkan di sini, bukan di prompt:
 * brief wajib, batas build per pesan, kunci review, syarat submit (validator + budget), tahap tekstur hanya setelah
 * bentuk dasar disetujui, dan cek bentuk aset final terhadap bentuk dasar itu.
 * Hasil ke Claude ringkas: JSON + paling banyak 1 gambar (contact sheet atau lembar contoh material).
 */
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { AssetStats } from "../../../shared/asset-stats.ts";
import { Brief } from "../../../shared/brief.ts";
import { BUILD_CAPS, type BudgetCheck, DETAIL_USAGE, type TierBudget } from "../../../shared/limits.ts";
import { MATERIAL_CATEGORIES } from "../../../shared/material-catalog.ts";
import {
  type AssetState,
  type BuildStage,
  buildsLeft,
  type RejectCode,
  stageOf,
  type TransitionResult,
  transition,
} from "../../domain/status.ts";
import { MAX_RESULTS, type MaterialLibrary, searchCatalog } from "../../library/materials.ts";
import type { ValidationResult } from "../../pipeline/validate.ts";
import { RENDER_VIEWS } from "../../render/protocol.ts";
import { type BuildOutcome, shapeOf } from "../../services/build-version.ts";
import { listVersions, versionDir } from "../../services/versions.ts";
import { FORGE_SERVER } from "../guard.ts";
import type { ApprovedBase, AssetBuilder, BuildProgress } from "./builder.ts";
import type { ForgeAsset, ForgeStore } from "./state.ts";

/** Batas waktu per pemanggilan tool (ms): build bertekstur Maksimal 600 dtk + antre + render, dengan cadangan. */
export const FORGE_TOOL_TIMEOUT_MS = 15 * 60_000;
/** Nama skrip bentuk dasar di `work/`. */
export const BASE_SCRIPT = "base.py";
/** Nama skrip tahap tekstur di `work/` (PLAN Lampiran B). */
export const MATERIAL_SCRIPT = "material.py";
/** Batas ukuran skrip yang dijalankan. */
export const SCRIPT_MAX_BYTES = 256 * 1024;

export type ForgeErrorCode =
  | RejectCode
  | "SCRIPT_MISSING"
  | "BUDGET_EXCEEDED"
  | "VALIDATION_FAILED"
  | "SCRIPT_ERROR"
  | "TIMEOUT"
  | "OOM"
  | "VERSION_NOT_FOUND"
  | "CANCELLED"
  | "SHAPE_DRIFT"
  | "LIBRARY_MISSING";

export type ForgeEvent =
  | Readonly<{ type: "brief"; brief: Brief }>
  | Readonly<{ type: "build_started"; jobId: string; stage: BuildStage; buildNumber: number }>
  | Readonly<{ type: "build_progress"; jobId: string; step: string; pct: number }>
  | Readonly<{ type: "build_finished"; jobId: string; ok: boolean; version?: number; code?: string }>
  | Readonly<{ type: "submitted"; version: number; summary: string; stage: "base" | "textured" }>;

type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: "image/png" };
export type ForgeToolResult = { content: Array<TextContent | ImageContent>; isError?: boolean };

function json(value: unknown): TextContent {
  return { type: "text", text: JSON.stringify(value) };
}

function ok(body: Record<string, unknown>, image?: Uint8Array): ForgeToolResult {
  const content: ForgeToolResult["content"] = [json({ ok: true, ...body })];
  if (image !== undefined)
    content.push({ type: "image", data: Buffer.from(image).toString("base64"), mimeType: "image/png" });
  return { content };
}

function fail(code: ForgeErrorCode, message: string, extra: Record<string, unknown> = {}): ForgeToolResult {
  return { content: [json({ ok: false, code, message, ...extra })], isError: true };
}

/** Penolakan `transition()` → hasil tool. Jatah build ikut dikirim supaya Claude tahu sisanya. */
function rejected(result: Extract<TransitionResult, { ok: false }>, extra: Record<string, unknown> = {}) {
  return fail(result.code, result.message, extra);
}

/** Signal dari `extra` handler MCP (`RequestHandlerExtra.signal`); dibatalkan bila CLI membatalkan pemanggilan. */
function requestSignal(extra: unknown): AbortSignal | undefined {
  if (typeof extra !== "object" || extra === null || !("signal" in extra)) return undefined;
  return extra.signal instanceof AbortSignal ? extra.signal : undefined;
}

/** Statistik versi yang ditulis `buildBaseVersion`/`buildTexturedVersion` (`stats.json`). */
const VersionReport = z.object({
  stage: z.enum(["base", "textured"]).default("base"),
  stats: AssetStats,
  budget: z.object({ ok: z.boolean() }),
  validation: z.object({ errors: z.number(), warnings: z.number() }),
});

/** Ringkasan budget untuk Claude: hanya angka yang relevan. */
/**
 * Petunjuk ruang detail untuk bentuk dasar yang jauh di bawah target segitiga tier, atau `null`. Murni.
 * Bukan gerbang: bentuk yang memang sederhana boleh dikirim dengan penjelasan.
 */
export function detailHint(triangles: number, tier: TierBudget): string | null {
  const target = tier.triangles.target;
  if (triangles >= target * DETAIL_USAGE.floor) return null;
  const pct = Math.round((triangles / target) * 100);
  return (
    `Segitiga baru ${pct}% dari target tier (${target}); arahan ${Math.round(DETAIL_USAGE.floor * 100)}–` +
    `${Math.round(DETAIL_USAGE.ceiling * 100)}%. Masih ada ruang untuk detail sekunder yang terlihat di contact sheet ` +
    "(wajah, telapak/cakar, paku, engsel, panel, gagang) atau segmen lebih halus pada bentuk bulat yang dominan."
  );
}

function detailField(triangles: number, tier: TierBudget) {
  const hint = detailHint(triangles, tier);
  return hint === null ? {} : { detailHint: hint };
}

/** Pesan validator yang ditampilkan ke Claude: hanya error dan peringatan. */
const VALIDATOR_MESSAGES_SHOWN = 3;

/** Ringkasan validator untuk hasil tool: jumlah + isi pesan error/peringatan pertama (Claude perlu tahu isinya). */
export function validatorSummary(validation: ValidationResult) {
  const messages = validation.messages
    .filter((message) => message.severity <= 1)
    .slice(0, VALIDATOR_MESSAGES_SHOWN)
    .map((message) => `${message.code}: ${message.message}`);
  return {
    errors: validation.errors,
    warnings: validation.warnings,
    ...(messages.length === 0 ? {} : { messages }),
  };
}

function budgetSummary(budget: BudgetCheck) {
  return budget.items.map((item) => ({
    key: item.key,
    value: item.value,
    target: item.target,
    max: item.max,
    status: item.status,
  }));
}

function tierSummary(tier: TierBudget) {
  return {
    triangles: tier.triangles,
    materials: tier.materials,
    textures: tier.textures,
    webBytes: tier.webBytes,
  };
}

/**
 * Selisih ukuran hasil terhadap brief. bbox statistik memakai glTF Y-up: x = lebar, y = tinggi, z = kedalaman.
 */
export function dimensionCheck(brief: Brief | null, size: readonly [number, number, number]) {
  if (brief === null) return null;
  const [x, y, z] = size;
  const rows = [
    ["width", brief.dimensionsM.width, x],
    ["depth", brief.dimensionsM.depth, z],
    ["height", brief.dimensionsM.height, y],
  ] as const;
  return Object.fromEntries(
    rows.map(([key, target, actual]) => [
      key,
      {
        targetM: target,
        actualM: Math.round(actual * 1000) / 1000,
        diffPct: Math.round(((actual - target) / target) * 1000) / 10,
      },
    ]),
  );
}

export type ForgeOptions = Readonly<{
  asset: ForgeAsset;
  /** Status aset di database; semua gerbang lewat `transition()`. */
  store: ForgeStore;
  builder: AssetBuilder;
  library: MaterialLibrary;
  emit: (event: ForgeEvent) => void;
  /** Pembuat jobId; tes mengisinya supaya deterministik. */
  newJobId?: () => string;
}>;

export class Forge {
  readonly #asset: ForgeAsset;
  readonly #store: ForgeStore;
  readonly #builder: AssetBuilder;
  readonly #library: MaterialLibrary;
  readonly #emit: (event: ForgeEvent) => void;
  readonly #newJobId: () => string;
  /** Build/inspeksi yang sedang berjalan; dibatalkan oleh Stop. */
  readonly #active = new Set<AbortController>();

  constructor(options: ForgeOptions) {
    this.#asset = options.asset;
    this.#store = options.store;
    this.#builder = options.builder;
    this.#library = options.library;
    this.#emit = options.emit;
    this.#newJobId = options.newJobId ?? (() => `job-${randomBytes(8).toString("hex")}`);
  }

  get asset(): ForgeAsset {
    return this.#asset;
  }

  /** Status aset terkini (dari database). */
  get state(): AssetState {
    return this.#store.read();
  }

  get buildsLeft(): number {
    return buildsLeft(this.#store.read());
  }

  /** Stop: batalkan build yang berjalan (container di-kill lewat jalur job berat). */
  cancelActive(): void {
    for (const controller of this.#active) controller.abort();
  }

  async #withSignal<T>(extra: unknown, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const external = requestSignal(extra);
    const signal =
      external === undefined ? controller.signal : AbortSignal.any([controller.signal, external]);
    this.#active.add(controller);
    try {
      return await work(signal);
    } finally {
      this.#active.delete(controller);
    }
  }

  recordBrief(input: Brief): ForgeToolResult {
    const brief = Brief.parse(input);
    const result = this.#store.apply({ type: "record_brief", brief });
    if (!result.ok) return rejected(result);
    this.#emit({ type: "brief", brief });
    return ok({
      status: result.state.status,
      tier: this.#asset.tierId,
      budget: tierSummary(this.#asset.tier),
      buildsLeft: buildsLeft(result.state),
      next: `Tulis work/${BASE_SCRIPT}, lalu panggil build_base_mesh.`,
    });
  }

  /** Cek gerbang build tanpa mengubah apa pun (jatah baru dipakai setelah skripnya terbukti ada). */
  #buildGate(stage: BuildStage): ForgeToolResult | null {
    const result = transition(this.#store.read(), { type: "build_start", stage });
    return result.ok ? null : rejected(result, result.code === "BUILD_CAP_REACHED" ? { buildsLeft: 0 } : {});
  }

  async buildBaseMesh(extra?: unknown): Promise<ForgeToolResult> {
    const gate = this.#buildGate("base");
    if (gate !== null) return gate;
    return this.#runBuild("base", BASE_SCRIPT, extra, (request) => this.#builder.build(request));
  }

  /** Bentuk dasar yang disetujui pemilik: skrip versi itu + statistiknya untuk cek bentuk. */
  async #approvedBase(): Promise<ApprovedBase | null> {
    const version = this.#store.read().approvedBaseVersion;
    if (version === null) return null;
    const report = await this.#report(version);
    if (report === null || report.stage !== "base") return null;
    return {
      version,
      scriptPath: join(versionDir(this.#asset.assetDir, version), "script.py"),
      shape: shapeOf(report.stats),
    };
  }

  async buildTexturedAsset(extra?: unknown): Promise<ForgeToolResult> {
    const gate = this.#buildGate("textured");
    if (gate !== null) return gate;
    const base = await this.#approvedBase();
    if (base === null) {
      return fail(
        "BASE_NOT_APPROVED",
        "Versi bentuk dasar yang disetujui tidak ditemukan atau bukan bentuk dasar.",
      );
    }
    if ((await this.#library.catalog()) === null) {
      return fail(
        "LIBRARY_MISSING",
        "Pustaka material belum disinkronkan (bun run textures:sync). Pakai material.pbr saja.",
      );
    }
    return this.#runBuild("textured", MATERIAL_SCRIPT, extra, (request) =>
      this.#builder.buildTextured({ ...request, base }),
    );
  }

  async #runBuild(
    stage: BuildStage,
    scriptName: string,
    extra: unknown,
    run: (request: Parameters<AssetBuilder["build"]>[0]) => Promise<BuildOutcome>,
  ): Promise<ForgeToolResult> {
    const asset = this.#asset;
    const scriptPath = join(asset.assetDir, "work", scriptName);
    const script = await stat(scriptPath).catch(() => null);
    if (script === null || !script.isFile()) {
      return fail("SCRIPT_MISSING", `File work/${scriptName} belum ada.`);
    }
    if (script.size > SCRIPT_MAX_BYTES) {
      return fail("SCRIPT_ERROR", `Skrip terlalu besar (${script.size} byte, maks ${SCRIPT_MAX_BYTES}).`);
    }

    const started = this.#store.apply({ type: "build_start", stage });
    if (!started.ok) {
      return rejected(started, started.code === "BUILD_CAP_REACHED" ? { buildsLeft: 0 } : {});
    }
    const jobId = this.#newJobId();
    this.#emit({ type: "build_started", jobId, stage, buildNumber: started.state.buildsThisMessage });
    let outcome: BuildOutcome;
    try {
      outcome = await this.#withSignal(extra, (signal) =>
        run({
          asset,
          jobId,
          scriptPath,
          signal,
          onProgress: (progress: BuildProgress) => this.#emit({ type: "build_progress", ...progress }),
        }),
      );
    } catch (error) {
      const cancelled = error instanceof Error && "code" in error && error.code === "CANCELLED";
      this.#emit({ type: "build_finished", jobId, ok: false, code: cancelled ? "CANCELLED" : "INTERNAL" });
      if (cancelled) return fail("CANCELLED", "Build dibatalkan pemilik (Stop).");
      throw error;
    }

    if (!outcome.ok) {
      this.#emit({ type: "build_finished", jobId, ok: false, code: outcome.code });
      return fail(outcome.code, outcome.message, {
        ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        ...(outcome.validation === undefined ? {} : { validator: outcome.validation.messages }),
        ...(outcome.shape === undefined ? {} : { shape: outcome.shape.issues }),
        buildsLeft: this.buildsLeft,
      });
    }
    const version = outcome.manifest.version;
    this.#store.recordVersion({
      version,
      stage,
      stats: outcome.stats,
      budget: outcome.budget,
      manifest: outcome.manifest,
    });
    this.#store.apply({ type: "build_done", version });
    this.#emit({ type: "build_finished", jobId, ok: true, version });
    const image = new Uint8Array(await readFile(outcome.contactSheetPath));
    const textured = stage === "textured";
    return ok(
      {
        version,
        stats: {
          triangles: outcome.stats.triangles,
          vertices: outcome.stats.vertices,
          bboxSizeM: outcome.stats.bbox.size,
          ...(textured
            ? {
                materials: outcome.stats.materials,
                textures: outcome.stats.textures.map((texture) => `${texture.slot} ${texture.width}px`),
              }
            : {}),
        },
        dimensions: dimensionCheck(this.#store.read().brief, outcome.stats.bbox.size),
        ...(textured ? {} : detailField(outcome.stats.triangles, asset.tier)),
        budget: budgetSummary(outcome.budget),
        budgetOk: outcome.budget.ok,
        validator: validatorSummary(outcome.validation),
        buildsLeft: this.buildsLeft,
        image: textured
          ? "contact sheet 6 sudut bertekstur (Depan, Belakang, Kiri, Kanan, Atas, 3/4)"
          : "contact sheet 6 sudut (Depan, Belakang, Kiri, Kanan, Atas, 3/4), grid lantai berlabel ukuran kotak",
      },
      image,
    );
  }

  async listMaterials(input: {
    query?: string;
    category?: (typeof MATERIAL_CATEGORIES)[number];
    limit?: number;
  }): Promise<ForgeToolResult> {
    const catalog = await this.#library.catalog();
    if (catalog === null) {
      return fail(
        "LIBRARY_MISSING",
        "Pustaka material belum disinkronkan. Pakai material.pbr (warna polos).",
      );
    }
    const found = searchCatalog(catalog.materials, input);
    const sheet = await this.#library.swatches(found);
    return ok(
      {
        total: catalog.materials.length,
        materials: found.map((material) => ({
          id: material.id,
          name: material.name,
          category: material.category,
          tags: material.tags.slice(0, 8),
          maps: material.maps,
        })),
        ...(sheet === null ? {} : { image: "lembar contoh material sesuai urutan daftar (label = id)" }),
        usage: 'material.from_library("<id>", scale_m=<ukuran satu ulangan tekstur, meter>)',
      },
      sheet ?? undefined,
    );
  }

  async #report(version: number) {
    const raw = await readFile(join(versionDir(this.#asset.assetDir, version), "stats.json"), "utf8").catch(
      () => null,
    );
    if (raw === null) return null;
    return VersionReport.parse(JSON.parse(raw));
  }

  async inspectVersion(
    input: {
      version: number;
      mode: "clay" | "wireframe" | "texture";
      views?: Array<(typeof RENDER_VIEWS)[number]>;
    },
    extra?: unknown,
  ): Promise<ForgeToolResult> {
    const versions = await listVersions(this.#asset.assetDir);
    if (!versions.includes(input.version))
      return fail("VERSION_NOT_FOUND", `Versi v${input.version} tidak ada.`, { versions });
    const png = await this.#withSignal(extra, (signal) =>
      this.#builder.inspect({
        asset: this.#asset,
        version: input.version,
        mode: input.mode,
        views: input.views,
        signal,
      }),
    );
    return ok({ version: input.version, mode: input.mode, views: input.views ?? RENDER_VIEWS }, png);
  }

  async listVersions(): Promise<ForgeToolResult> {
    const versions = await listVersions(this.#asset.assetDir);
    const rows = await Promise.all(
      versions.map(async (version) => {
        const report = await this.#report(version);
        return report === null
          ? { version }
          : {
              version,
              stage: report.stage,
              triangles: report.stats.triangles,
              bboxSizeM: report.stats.bbox.size,
              budgetOk: report.budget.ok,
              validatorErrors: report.validation.errors,
            };
      }),
    );
    const state = this.#store.read();
    return ok({ status: state.status, buildsLeft: buildsLeft(state), versions: rows });
  }

  async submitForReview(input: { version: number; summary: string }): Promise<ForgeToolResult> {
    const expected = stageOf(this.#store.read().status);
    const gate = transition(this.#store.read(), { type: "submit", version: input.version, stage: expected });
    if (!gate.ok) return rejected(gate);
    const report = await this.#report(input.version);
    if (report === null) return fail("VERSION_NOT_FOUND", `Versi v${input.version} tidak ada.`);
    if (report.stage !== expected) {
      return fail(
        "VERSION_NOT_FOUND",
        expected === "textured"
          ? `Versi v${input.version} adalah bentuk dasar; kirim versi hasil build_textured_asset.`
          : `Versi v${input.version} bukan bentuk dasar.`,
      );
    }
    if (report.validation.errors > 0) {
      return fail(
        "VALIDATION_FAILED",
        `Versi v${input.version} punya ${report.validation.errors} error validator.`,
      );
    }
    if (!report.budget.ok)
      return fail("BUDGET_EXCEEDED", `Versi v${input.version} melewati batas maksimal tier.`);
    const submitted = this.#store.apply({ type: "submit", version: input.version, stage: report.stage });
    if (!submitted.ok) return rejected(submitted);
    this.#emit({ type: "submitted", version: input.version, summary: input.summary, stage: report.stage });
    return ok({
      status: submitted.state.status,
      version: input.version,
      next: "Build dikunci. Akhiri giliran dengan ringkasan singkat untuk pemilik, lalu tunggu review.",
    });
  }

  /** Server MCP in-process untuk opsi sesi. Dibuat ulang per sesi Claude. */
  mcpServer(): McpSdkServerConfigWithInstance {
    return createSdkMcpServer({
      name: FORGE_SERVER,
      version: "0.2.0",
      alwaysLoad: true,
      timeout: FORGE_TOOL_TIMEOUT_MS,
      tools: [
        tool(
          "record_brief",
          "Catat brief aset (ringkasan, kategori, gaya, ukuran target dalam meter). Wajib sebelum build pertama; boleh dipanggil ulang untuk memperbarui.",
          Brief.shape,
          async (args) => this.recordBrief(args),
        ),
        tool(
          "build_base_mesh",
          `Jalankan work/${BASE_SCRIPT} di Blender (sandbox), ekspor bentuk dasar tanpa material, optimasi dan validasi, lalu kembalikan statistik, budget, dan contact sheet 6 sudut. Maks ${BUILD_CAPS.base} build per pesan pemilik.`,
          { note: z.string().max(300).optional().describe("Apa yang diubah di build ini") },
          async (_args, extra) => this.buildBaseMesh(extra),
        ),
        tool(
          "build_textured_asset",
          `Tahap tekstur (setelah pemilik menyetujui bentuk dasar): jalankan work/${MATERIAL_SCRIPT} (geometri dari scene.run_base() + material), harness mem-bake semua material ke satu atlas sesuai tier, ekspor, optimasi, validasi, cek bentuk terhadap bentuk dasar, lalu kembalikan statistik, budget, dan contact sheet bertekstur. Maks ${BUILD_CAPS.textured} build per pesan pemilik.`,
          { note: z.string().max(300).optional().describe("Apa yang diubah di build ini") },
          async (_args, extra) => this.buildTexturedAsset(extra),
        ),
        tool(
          "list_materials",
          "Cari material CC0 di pustaka lokal (kayu, logam, batu, kain, kulit, plastik, tanah, lain-lain). Hasil: daftar id + lembar contoh gambar. Pakai id-nya di material.from_library.",
          {
            query: z
              .string()
              .trim()
              .max(100)
              .optional()
              .describe("Kata kunci bahasa Inggris, mis. 'rusty metal'"),
            category: z.enum(MATERIAL_CATEGORIES).optional(),
            limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
          },
          async (args) => this.listMaterials(args),
        ),
        tool(
          "inspect_version",
          "Render ulang versi yang sudah ada dengan mode atau sudut lain, tanpa build ulang.",
          {
            version: z.number().int().positive(),
            mode: z.enum(["clay", "wireframe", "texture"]).default("clay"),
            views: z.array(z.enum(RENDER_VIEWS)).min(1).max(6).optional(),
          },
          async (args, extra) => this.inspectVersion(args, extra),
        ),
        tool(
          "list_versions",
          "Daftar versi (bentuk dasar dan aset final) beserta statistik dan status budget.",
          {},
          async () => this.listVersions(),
        ),
        tool(
          "submit_for_review",
          "Kirim satu versi tahap saat ini (bentuk dasar, atau aset final di tahap tekstur) untuk direview pemilik. Syarat: 0 error validator dan tidak melewati batas maksimal tier. Setelah ini build dikunci dan giliran harus diakhiri.",
          { version: z.number().int().positive(), summary: z.string().trim().min(1).max(600) },
          async (args) => this.submitForReview(args),
        ),
      ],
    });
  }
}

/** Builder fixture untuk `RUNTIME_DRIVER=fixture` dan tes: tanpa Docker dan Chromium. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { THUMB_FILE, TURNTABLE_FILE } from "../../../shared/derived-files.ts";
import { JobCancelledError } from "../../jobs/heavy-lane.ts";
import { writeGlb } from "../../pipeline/io.ts";
import { processGlb } from "../../pipeline/process.ts";
import { gridDocument } from "../../pipeline/test-documents.ts";
import { BLEND_OUTPUT } from "../../runtime/job-dir.ts";
import {
  type BuildOutcome,
  buildSummary,
  CONTACT_SHEET_FILE,
  shapeGate,
} from "../../services/build-version.ts";
import { createVersion, writeDerived } from "../../services/versions.ts";
import type { AssetBuilder, BuildRequest, InspectRequest, TexturedBuildRequest } from "./builder.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/glb");
/** Contact sheet siap pakai untuk fixture GLB (dibuat `bun scripts/fixture-sheets.ts`, butuh Chromium). */
export const FIXTURE_SHEETS_DIR = join(import.meta.dir, "../../../tests/fixtures/contact-sheets");
/** Thumbnail dan turntable Gudang siap pakai (dibuat skrip yang sama). */
export const FIXTURE_TURNTABLES_DIR = join(import.meta.dir, "../../../tests/fixtures/turntables");

export type FixtureBuild =
  | Readonly<{ kind: "fixture"; name: string }>
  /** Grid bergelombang `cells × cells` (2 segitiga per sel), untuk melewati budget dengan sengaja. */
  | Readonly<{ kind: "grid"; cells: number }>
  | Readonly<{ kind: "fail"; code: "SCRIPT_ERROR" | "TIMEOUT" | "OOM"; message: string; detail?: string }>
  /** Menunggu sampai dibatalkan (untuk tes Stop). */
  | Readonly<{ kind: "hang" }>;

/** PNG kecil bermotif sebagai pengganti contact sheet. */
export async function placeholderSheet(): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: 16, height: 8, channels: 3, background: { r: 40, g: 40, b: 44 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Nama file contact sheet fixture: `textured/peti` → `textured-peti.png`. */
export function fixtureSheetPath(name: string): string {
  return join(FIXTURE_SHEETS_DIR, `${name.replaceAll("/", "-")}.png`);
}

/** Thumbnail dan turntable fixture: `textured/peti` → `turntables/textured-peti.{thumb,turntable}.webp`. */
export function fixtureTurntablePaths(name: string): Readonly<{ thumb: string; turntable: string }> {
  const base = join(FIXTURE_TURNTABLES_DIR, name.replaceAll("/", "-"));
  return { thumb: `${base}.thumb.webp`, turntable: `${base}.turntable.webp` };
}

/** Thumbnail dan turntable fixture disalin ke `derived/vN/`, seperti `ThumbnailService` setelah build asli. */
async function copyFixtureTurntable(assetDir: string, version: number, name: string): Promise<void> {
  const paths = fixtureTurntablePaths(name);
  const [thumb, turntable] = await Promise.all([
    readFile(paths.thumb).catch(() => null),
    readFile(paths.turntable).catch(() => null),
  ]);
  if (thumb === null || turntable === null) return;
  await writeDerived(assetDir, version, TURNTABLE_FILE, new Uint8Array(turntable));
  await writeDerived(assetDir, version, THUMB_FILE, new Uint8Array(thumb));
}

/** `.blend` fixture: `textured/peti` → `tests/fixtures/glb/textured/peti.blend` (tidak semua fixture punya). */
export function fixtureBlendPath(name: string): string {
  return join(FIXTURES, `${name}.blend`);
}

async function fixtureSheet(name: string): Promise<Uint8Array> {
  const file = await readFile(fixtureSheetPath(name)).catch(() => null);
  return file === null ? placeholderSheet() : new Uint8Array(file);
}

export type FixtureBuilderOptions = Readonly<{
  /** Antrean hasil build berikutnya; bila habis, fixture bawaan dipakai. */
  script?: FixtureBuild[];
  /** Fixture bawaan bentuk dasar. */
  base?: string;
  /** Fixture bawaan bertekstur; harus lolos cek bentuk terhadap `base`. */
  textured?: string;
}>;

/** Pasangan fixture yang lolos cek bentuk: dipakai `RUNTIME_DRIVER=fixture`. */
export const FIXTURE_PAIR = { base: "textured/peti-base", textured: "textured/peti" } as const;

/**
 * Builder tanpa Docker dan Chromium (`RUNTIME_DRIVER=fixture` dan tes): GLB fixture → pipeline sungguhan → versi
 * sungguhan. Contact sheet diambil dari `tests/fixtures/contact-sheets/` (atau PNG pengganti bila tidak ada).
 * Hasil tiap build bisa diatur lewat antrean `script`. Build bertekstur memakai gerbang bentuk yang sama dengan
 * builder sungguhan (`shapeGate`).
 */
export class FixtureAssetBuilder implements AssetBuilder {
  readonly script: FixtureBuild[];
  readonly requests: BuildRequest[] = [];
  readonly inspections: InspectRequest[] = [];
  readonly #base: string;
  readonly #textured: string;
  #waiters: Array<(request: BuildRequest) => void> = [];

  constructor(options: FixtureBuilderOptions = {}) {
    this.script = options.script ?? [];
    this.#base = options.base ?? "peti";
    this.#textured = options.textured ?? "textured/peti";
  }

  /** Selesai saat build berikutnya dimulai (tanpa sleep di tes). */
  nextRequest(): Promise<BuildRequest> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  build(request: BuildRequest): Promise<BuildOutcome> {
    return this.#run(request, "base", { kind: "fixture", name: this.#base });
  }

  buildTextured(request: TexturedBuildRequest): Promise<BuildOutcome> {
    return this.#run(request, "textured", { kind: "fixture", name: this.#textured }, request);
  }

  async #run(
    request: BuildRequest,
    stage: "base" | "textured",
    fallback: FixtureBuild,
    textured?: TexturedBuildRequest,
  ): Promise<BuildOutcome> {
    this.requests.push(request);
    for (const waiter of this.#waiters.splice(0)) waiter(request);
    const next = this.script.shift() ?? fallback;
    request.onProgress({ jobId: request.jobId, step: "menjalankan skrip", pct: 0 });
    if (next.kind === "hang") {
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new JobCancelledError(request.jobId);
    }
    if (next.kind === "fail") {
      return {
        ok: false,
        code: next.code,
        message: next.message,
        ...(next.detail === undefined ? {} : { detail: next.detail }),
      };
    }
    const glb =
      next.kind === "grid"
        ? await writeGlb(gridDocument(next.cells))
        : new Uint8Array(await readFile(join(FIXTURES, `${next.name}.glb`)));
    const processed = await processGlb(glb, {
      tierId: request.asset.tierId,
      tier: request.asset.tier,
      stage,
    });
    if (textured !== undefined) {
      const rejected = shapeGate(textured.base.shape, processed.stats);
      if (rejected !== null) return rejected;
    }
    const report = {
      stage,
      stats: processed.stats,
      budget: processed.budget,
      validation: processed.validation,
      optimize: processed.optimize,
    };
    // `.blend` fixture (dibuat `bun scripts/runtime.ts blend-fixtures`), seperti `scene.blend` dari harness.
    const blend =
      next.kind === "fixture" ? await readFile(fixtureBlendPath(next.name)).catch(() => null) : null;
    const manifest = await createVersion({
      assetDir: request.asset.assetDir,
      files: [
        { name: stage === "base" ? "base.glb" : "final.glb", data: processed.glb },
        // Sama dengan builder sungguhan: `web.glb` untuk viewer (meshopt), bila validator lolos.
        ...(processed.web === null ? [] : [{ name: "web.glb", data: processed.web }]),
        { name: "script.py", data: new Uint8Array(await readFile(request.scriptPath)) },
        ...(blend === null ? [] : [{ name: BLEND_OUTPUT, data: new Uint8Array(blend) }]),
        { name: "stats.json", data: JSON.stringify(report) },
      ],
      meta: { stage, ...buildSummary(processed) },
    });
    const contactSheetPath = await writeDerived(
      request.asset.assetDir,
      manifest.version,
      CONTACT_SHEET_FILE,
      next.kind === "fixture" ? await fixtureSheet(next.name) : await placeholderSheet(),
    );
    if (next.kind === "fixture")
      await copyFixtureTurntable(request.asset.assetDir, manifest.version, next.name);
    request.onProgress({ jobId: request.jobId, step: "selesai", pct: 100 });
    return {
      ok: true,
      manifest,
      stats: processed.stats,
      budget: processed.budget,
      validation: processed.validation,
      contactSheetPath,
      peakMemBytes: null,
      timings: { runtimeMs: 0, pipelineMs: 0, renderMs: 0, totalMs: 0 },
    };
  }

  /** Render ulang palsu: contact sheet versi itu (sudut dan mode diabaikan). */
  async inspect(request: InspectRequest): Promise<Uint8Array> {
    this.inspections.push(request);
    const sheet = join(request.asset.assetDir, "derived", `v${request.version}`, CONTACT_SHEET_FILE);
    const file = await readFile(sheet).catch(() => null);
    return file === null ? placeholderSheet() : new Uint8Array(file);
  }
}

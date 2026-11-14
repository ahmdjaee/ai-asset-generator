/**
 * `bun run eval:texture -- --confirm [--only peti,rubah] [--model <id>] [--session resume|fresh]`
 *
 * Evaluasi tahap tekstur dengan Claude SUNGGUHAN, mulai dari bentuk dasar `eval:base` (Tahap 3) yang dikirim untuk
 * review. **Memakai kuota pemilik**: hanya dijalankan dengan izin eksplisit (AGENTS.md §1). Tanpa `--confirm`
 * skrip hanya mencetak rencana.
 *
 * Per kasus: folder aset Tahap 3 dipakai lagi (cwd sama, jadi sesi bisa di-resume). Status aset disiapkan di SQLite
 * memori (BASE_REVIEW + versi yang dikirim), disetujui lewat `transition()` seperti aksi pemilik di app, lalu pesan
 * permintaan aset final dikirim (teks kasus, sama seperti Tahap 4, supaya hasil tetap sebanding).
 * - `--session resume` (bawaan): melanjutkan sesi Tahap 3; konteks bentuk dasar ikut. Catatan: sesi Tahap 3 ikut
 *   bertambah, jadi menjalankan ulang melanjutkan dari akhir run sebelumnya.
 * - `--session fresh`: sesi baru dengan ringkasan bentuk dasar di pesan pertama.
 * Diukur: build, waktu, biaya, token konteks terbesar, dan jumlah gambar yang dikirim ke Claude.
 *
 * Keluaran: `eval/runs/<waktu>-texture/<kasus>/` (transcript, raw, contact sheet versi baru, summary) dan
 * `eval/runs/<waktu>-texture/summary.md` dengan kolom skor pemilik.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createAssetSession } from "../server/agent/asset-session.ts";
import { DockerAssetBuilder } from "../server/agent/forge/builder.ts";
import { DEFAULT_MODEL } from "../server/agent/options.ts";
import type { AgentPort, SDKMessage } from "../server/agent/port.ts";
import { recordingPort } from "../server/agent/recording-port.ts";
import { type SanitizeContext, sanitize } from "../server/agent/sanitize.ts";
import { readAccountInfo, sdkAgentPort } from "../server/agent/sdk-adapter.ts";
import { loadConfig } from "../server/config.ts";
import { HeavyLane } from "../server/jobs/heavy-lane.ts";
import { MaterialLibrary } from "../server/library/materials.ts";
import { Renderer } from "../server/render/renderer.ts";
import { removeOrphanJobs } from "../server/runtime/docker.ts";
import { requireRuntimeImage } from "../server/runtime/image.ts";
import { openTestStore } from "../server/services/test-support.ts";
import { listVersions, versionDir } from "../server/services/versions.ts";
import type { AgentEvent } from "../shared/agent-events.ts";
import { DEFAULT_TIERS } from "../shared/limits.ts";
import { type FoundBaseRun, findBaseRun } from "./eval/base-run.ts";
import { asSubmission, TEXTURE_CASES, type TextureCase } from "./eval/cases.ts";
import {
  type RunSummary,
  summarizeRun,
  summaryTable,
  TEXTURE_LIMITS,
  type VersionReport,
} from "./eval/report.ts";
import { collectArtifacts, contextMeter, EVAL_OWNER, jsonlWriter, waitForResult } from "./eval/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const RUNS_DIR = join(ROOT, "eval", "runs");
const MATERIALS_DIR = join(loadConfig().dataDir, "library", "materials");
const STOP_WAIT_MS = 60_000;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    confirm: { type: "boolean", default: false },
    only: { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
    session: { type: "string", default: "resume" },
  },
});

const selected =
  values.only === undefined
    ? TEXTURE_CASES
    : TEXTURE_CASES.filter((item) => values.only?.split(",").includes(item.id));
const model = values.model ?? DEFAULT_MODEL;
const sessionMode = z.enum(["resume", "fresh"]).parse(values.session);

const StatsFile = z.object({
  stage: z.enum(["base", "textured"]).default("base"),
  stats: z.object({
    triangles: z.number(),
    materials: z.number(),
    textures: z.array(z.object({ slot: z.string(), width: z.number(), height: z.number() })),
  }),
  validation: z.object({ errors: z.number() }),
  budget: z.object({ ok: z.boolean(), items: z.array(z.object({ key: z.string(), value: z.number() })) }),
});
type StatsFile = z.infer<typeof StatsFile>;

async function readStats(assetDir: string, version: number): Promise<StatsFile | null> {
  const raw = await readFile(join(versionDir(assetDir, version), "stats.json"), "utf8").catch(() => null);
  return raw === null ? null : StatsFile.parse(JSON.parse(raw));
}

function versionReport(stats: StatsFile): VersionReport {
  return {
    triangles: stats.stats.triangles,
    validatorErrors: stats.validation.errors,
    budgetOk: stats.budget.ok,
  };
}

function freshPrompt(base: FoundBaseRun, prompt: string): string {
  const brief = base.brief === null ? "-" : JSON.stringify(base.brief);
  return [
    `Konteks: bentuk dasar aset ini (v${base.version}) sudah disetujui pemilik. Skripnya ada di work/base.py.`,
    `Ringkasan bentuk dasar: ${base.summary}`,
    `Brief: ${brief}`,
    "",
    prompt,
  ].join("\n");
}

type Shared = {
  port: AgentPort;
  builder: DockerAssetBuilder;
  sanitizeContext: SanitizeContext;
  runDir: string;
};

type TextureRow = Readonly<{
  summary: RunSummary;
  baseVersion: number;
  maxContextTokens: number;
  modelCalls: number;
  webBytes: number | null;
  textures: string;
}>;

async function runCase(shared: Shared, evalCase: TextureCase, base: FoundBaseRun): Promise<TextureRow> {
  console.log(`▶ ${evalCase.id} (bentuk dasar v${base.version}, sesi ${sessionMode})`);
  const caseDir = join(shared.runDir, evalCase.id);
  await mkdir(caseDir, { recursive: true });
  const writeTranscript = jsonlWriter(join(caseDir, "transcript.jsonl"));
  const writeRaw = jsonlWriter(join(caseDir, "raw.jsonl"));
  const meter = contextMeter();
  const events: AgentEvent[] = [];
  const port = recordingPort(shared.port, (message: SDKMessage) => {
    meter.observe(message);
    writeRaw(sanitize(message, shared.sanitizeContext));
  });

  const asset = {
    id: evalCase.id,
    assetDir: base.assetDir,
    tierId: "sedang" as const,
    tier: DEFAULT_TIERS.sedang,
  };
  const db = openTestStore({
    id: evalCase.id,
    tierId: "sedang",
    now: Date.now,
    state: {
      status: "BASE_REVIEW",
      runState: "idle",
      lastError: null,
      brief: base.brief,
      approvedBaseVersion: null,
      currentVersion: base.version,
      buildsThisMessage: 0,
    },
  });
  const firstNewVersion = Math.max(0, ...(await listVersions(base.assetDir))) + 1;

  const session = await createAssetSession({
    asset,
    store: db.store,
    port,
    builder: shared.builder,
    library: new MaterialLibrary(MATERIALS_DIR),
    model,
    ...(sessionMode === "resume" ? { sessionId: base.sessionId } : {}),
    emit: (event) => {
      events.push(event);
      if (event.type !== "delta")
        writeTranscript(sanitize({ at: new Date().toISOString(), ...event }, shared.sanitizeContext));
      if (event.type === "question") {
        const first = Object.fromEntries(
          event.questions.map((question) => [question.question, question.options[0]?.label ?? ""]),
        );
        console.log(`  [${evalCase.id}] pertanyaan dijawab pilihan pertama`);
        session.runner.answer(event.questionId, asSubmission(event.questions, first));
      }
      if (event.type === "build_finished")
        console.log(`  [${evalCase.id}] build ${event.ok ? `v${event.version}` : event.code}`);
    },
  });
  // Aksi pemilik: menyetujui bentuk dasar yang dikirim di Tahap 3.
  const approved = db.store.apply({ type: "approve" });
  if (!approved.ok) throw new Error(`persetujuan ditolak: ${approved.message}`);

  const started = Date.now();
  session.runner.send(sessionMode === "fresh" ? freshPrompt(base, evalCase.prompt) : evalCase.prompt);
  if ((await waitForResult(events, 0, TEXTURE_LIMITS.maxDurationMs)) === "timeout") {
    console.log(`  [${evalCase.id}] melewati batas waktu → Stop`);
    await session.runner.interrupt();
    await waitForResult(events, 0, STOP_WAIT_MS);
  }
  const durationMs = Date.now() - started;
  session.runner.close();
  await collectArtifacts(caseDir, asset.assetDir, firstNewVersion);

  // Status dibaca dari store: berubah di dalam tool `forge`, bukan di fungsi ini.
  const final = db.store.read();
  const stats =
    final.status === "TEXTURE_REVIEW" && final.currentVersion !== null
      ? await readStats(asset.assetDir, final.currentVersion)
      : null;
  db.handle.close();
  const summary = summarizeRun({
    id: evalCase.id,
    events,
    durationMs,
    version: stats === null ? null : versionReport(stats),
    limits: TEXTURE_LIMITS,
  });
  const usage = meter.read();
  const row: TextureRow = {
    summary,
    baseVersion: base.version,
    maxContextTokens: usage.maxContextTokens,
    modelCalls: usage.calls,
    webBytes: stats?.budget.items.find((item) => item.key === "webBytes")?.value ?? null,
    textures:
      stats === null
        ? "-"
        : stats.stats.textures.map((texture) => `${texture.slot} ${texture.width}`).join(", "),
  };
  const finalText = events.findLast((event) => event.type === "assistant");
  await writeFile(
    join(caseDir, "summary.md"),
    `# ${evalCase.id} (tekstur)\n\n**Prompt:** ${evalCase.prompt}\n\n${summaryTable([summary], "≥ 2 dari 3")}\n${contextTable([row])}\n## Pesan akhir Claude\n\n${finalText?.type === "assistant" ? finalText.text : "-"}\n`,
  );
  console.log(`  [${evalCase.id}] ${summary.pass ? "lolos" : `tidak lolos: ${summary.failures.join("; ")}`}`);
  return row;
}

function contextTable(rows: readonly TextureRow[]): string {
  const header =
    "| Kasus | Sesi | Dasar | Konteks terbesar (token) | Panggilan model | Gambar ke Claude | Tekstur | web.glb |\n|---|---|---|---|---|---|---|---|";
  const lines = rows.map((row) =>
    [
      row.summary.id,
      sessionMode,
      `v${row.baseVersion}`,
      row.maxContextTokens.toLocaleString("id-ID"),
      row.modelCalls,
      row.summary.images,
      row.textures,
      row.webBytes === null ? "-" : `${Math.round(row.webBytes / 1000)} KB`,
    ].join(" | "),
  );
  return `${header}\n${lines.map((line) => `| ${line} |`).join("\n")}\n`;
}

async function main(): Promise<number> {
  if (selected.length === 0) {
    console.error(`Kasus tidak dikenal. Pilihan: ${TEXTURE_CASES.map((item) => item.id).join(", ")}`);
    return 2;
  }
  const bases = new Map<string, FoundBaseRun>();
  for (const evalCase of selected) {
    const base = await findBaseRun(RUNS_DIR, evalCase.id);
    if (base === null) {
      console.error(
        `Hasil eval:base untuk ${evalCase.id} tidak ditemukan di eval/runs (butuh folder aset + submit).`,
      );
      return 2;
    }
    bases.set(evalCase.id, base);
  }
  console.log("Rencana eval:texture (memakai kuota Claude):");
  console.log(`  model: ${model}, tier: sedang, sesi: ${sessionMode}`);
  for (const [id, base] of bases) console.log(`  ${id}: bentuk dasar v${base.version} dari ${base.caseDir}`);
  if (!values.confirm) {
    console.log("Jalankan dengan --confirm setelah pemilik mengizinkan.");
    return 0;
  }

  const account = await readAccountInfo();
  if (account.apiKeySource !== undefined && account.apiKeySource !== "none") {
    console.error("✗ SDK memakai API key; eval hanya boleh memakai sesi login Claude Code.");
    return 1;
  }
  if ((await new MaterialLibrary(MATERIALS_DIR).catalog()) === null) {
    console.error("✗ Pustaka material belum ada: jalankan `bun run textures:sync` dulu.");
    return 1;
  }
  const image = await requireRuntimeImage();
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-texture`;
  const runDir = join(RUNS_DIR, stamp);
  await mkdir(runDir, { recursive: true });
  const renderer = new Renderer();
  const shared: Shared = {
    port: sdkAgentPort,
    builder: new DockerAssetBuilder({
      lane: new HeavyLane(),
      renderer,
      image,
      owner: EVAL_OWNER,
      jobsRoot: join(runDir, "jobs"),
      materialsDir: MATERIALS_DIR,
    }),
    sanitizeContext: {
      homeDir: homedir(),
      extraSecrets: [account.email, account.organization].filter(
        (value): value is string => typeof value === "string",
      ),
    },
    runDir,
  };
  try {
    const rows: TextureRow[] = [];
    for (const evalCase of selected) {
      const base = bases.get(evalCase.id);
      if (base !== undefined) rows.push(await runCase(shared, evalCase, base));
    }
    const scoring = rows.map((row) => `| ${row.summary.id} | | |`).join("\n");
    await writeFile(
      join(runDir, "summary.md"),
      `# eval:texture ${stamp}\n\nModel: ${model} · tier Sedang · sesi ${sessionMode}\n\n${summaryTable(
        rows.map((row) => row.summary),
        "≥ 2 dari 3",
      )}\n${contextTable(rows)}\n## Skor pemilik (1–5, layak bila ≥ 3)\n\n| Kasus | Skor | Catatan |\n|---|---|---|\n${scoring}\n`,
    );
    console.log(`\nRingkasan: ${join(runDir, "summary.md")}`);
    return 0;
  } finally {
    await renderer.close();
    await removeOrphanJobs(EVAL_OWNER);
  }
}

process.exitCode = await main();

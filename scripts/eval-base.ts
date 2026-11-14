/**
 * `bun run eval:base -- --confirm [--only peti,kursi] [--model <id>] [--stop-resume]`
 *
 * Evaluasi kualitas loop Claude tahap bentuk dasar dengan Claude SUNGGUHAN. **Memakai kuota pemilik** — hanya
 * dijalankan dengan izin eksplisit (AGENTS.md §1). Tanpa `--confirm` skrip hanya mencetak rencana.
 *
 * Keluaran: `eval/runs/<waktu>/<kasus>/` berisi `transcript.jsonl` (event app), `raw.jsonl` (stream SDK yang sudah
 * disanitasi, bahan fixture kontrak), `contact-sheet-vN.png`, `stats-vN.json`, dan `summary.md`; ditambah
 * `eval/runs/<waktu>/summary.md` dengan tabel hasil dan kolom skor pemilik.
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
import type { AssetRunner } from "../server/agent/runner.ts";
import { type SanitizeContext, sanitize } from "../server/agent/sanitize.ts";
import { readAccountInfo, sdkAgentPort } from "../server/agent/sdk-adapter.ts";
import { loadConfig } from "../server/config.ts";
import { HeavyLane } from "../server/jobs/heavy-lane.ts";
import { MaterialLibrary } from "../server/library/materials.ts";
import { Renderer } from "../server/render/renderer.ts";
import { removeOrphanJobs } from "../server/runtime/docker.ts";
import { requireRuntimeImage } from "../server/runtime/image.ts";
import { openTestStore } from "../server/services/test-support.ts";
import { versionDir } from "../server/services/versions.ts";
import type { AgentEvent } from "../shared/agent-events.ts";
import { DEFAULT_TIERS } from "../shared/limits.ts";
import { asSubmission, BASE_CASES, type EvalCase, pickAnswers } from "./eval/cases.ts";
import {
  EVAL_MAX_DURATION_MS,
  type RunSummary,
  summarizeRun,
  summaryTable,
  type VersionReport,
} from "./eval/report.ts";
import {
  collectArtifacts,
  EVAL_OWNER,
  jsonlWriter,
  leftoverEvalContainers,
  waitForResult,
} from "./eval/session.ts";

const ROOT = resolve(import.meta.dir, "..");
const MATERIALS_DIR = join(loadConfig().dataDir, "library", "materials");
/** Waktu tambahan setelah batas 10 menit untuk Stop dan result terakhir. */
const STOP_WAIT_MS = 60_000;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    confirm: { type: "boolean", default: false },
    only: { type: "string" },
    model: { type: "string", default: DEFAULT_MODEL },
    "stop-resume": { type: "boolean", default: false },
  },
});

const selected =
  values.only === undefined
    ? BASE_CASES
    : BASE_CASES.filter((item) => values.only?.split(",").includes(item.id));
const model = values.model ?? DEFAULT_MODEL;

function printPlan(): void {
  console.log("Rencana eval:base (memakai kuota Claude):");
  console.log(`  model: ${model}, tier: sedang, kasus: ${selected.map((item) => item.id).join(", ")}`);
  if (values["stop-resume"]) console.log("  + skenario Stop di tengah build lalu resume sesi");
  console.log("Jalankan dengan --confirm setelah pemilik mengizinkan.");
}

type Recorder = { events: AgentEvent[]; write: (event: AgentEvent) => void };

const StatsFile = z.object({
  stats: z.object({ triangles: z.number() }),
  validation: z.object({ errors: z.number() }),
  budget: z.object({ ok: z.boolean() }),
});

async function versionReport(assetDir: string, version: number): Promise<VersionReport | null> {
  const raw = await readFile(join(versionDir(assetDir, version), "stats.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  const report = StatsFile.parse(JSON.parse(raw));
  return {
    triangles: report.stats.triangles,
    validatorErrors: report.validation.errors,
    budgetOk: report.budget.ok,
  };
}

type Shared = {
  port: AgentPort;
  builder: DockerAssetBuilder;
  sanitizeContext: SanitizeContext;
  runDir: string;
};

async function openCase(
  shared: Shared,
  evalCase: EvalCase,
  rawPath: string,
  resume?: { sessionId: string | undefined; transcript: string },
) {
  const caseDir = join(shared.runDir, evalCase.id);
  await mkdir(caseDir, { recursive: true });
  const writeTranscript = jsonlWriter(join(caseDir, resume?.transcript ?? "transcript.jsonl"));
  const writeRaw = jsonlWriter(rawPath);
  const recorder: Recorder = {
    events: [],
    write: (event) => {
      recorder.events.push(event);
      if (event.type !== "delta")
        writeTranscript(sanitize({ at: new Date().toISOString(), ...event }, shared.sanitizeContext));
    },
  };
  const port = recordingPort(shared.port, (message: SDKMessage) =>
    writeRaw(sanitize(message, shared.sanitizeContext)),
  );
  const asset = {
    id: evalCase.id,
    assetDir: join(caseDir, "asset"),
    tierId: "sedang" as const,
    tier: DEFAULT_TIERS.sedang,
  };
  // Status aset di SQLite memori, lewat jalur yang sama dengan app (`AssetStore` + `transition()`).
  const db = openTestStore({ id: evalCase.id, tierId: "sedang", now: Date.now });
  let runner: AssetRunner | undefined;
  const session = await createAssetSession({
    asset,
    store: db.store,
    port,
    builder: shared.builder,
    library: new MaterialLibrary(MATERIALS_DIR),
    model,
    ...(resume?.sessionId === undefined ? {} : { sessionId: resume.sessionId }),
    emit: (event) => {
      recorder.write(event);
      if (event.type === "question") {
        const answers = pickAnswers(event.questions, evalCase.answers);
        console.log(`  [${evalCase.id}] pertanyaan dijawab otomatis: ${JSON.stringify(answers)}`);
        runner?.answer(event.questionId, asSubmission(event.questions, answers));
      }
      if (event.type === "build_finished")
        console.log(`  [${evalCase.id}] build ${event.ok ? `v${event.version}` : event.code}`);
    },
  });
  runner = session.runner;
  return { caseDir, recorder, asset, store: db.store, runner: session.runner };
}

async function runCase(shared: Shared, evalCase: EvalCase): Promise<RunSummary> {
  console.log(`▶ ${evalCase.id}`);
  const { caseDir, recorder, asset, store, runner } = await openCase(
    shared,
    evalCase,
    join(shared.runDir, evalCase.id, "raw.jsonl"),
  );
  const started = Date.now();
  runner.send(evalCase.prompt);
  if ((await waitForResult(recorder.events, 0, EVAL_MAX_DURATION_MS)) === "timeout") {
    console.log(`  [${evalCase.id}] melewati 10 menit → Stop`);
    await runner.interrupt();
    await waitForResult(recorder.events, 0, STOP_WAIT_MS);
  }
  const durationMs = Date.now() - started;
  runner.close();
  await collectArtifacts(caseDir, asset.assetDir);
  const final = store.read();
  const version =
    final.status === "BASE_REVIEW" && final.currentVersion !== null
      ? await versionReport(asset.assetDir, final.currentVersion)
      : null;
  const summary = summarizeRun({ id: evalCase.id, events: recorder.events, durationMs, version });
  const finalText = recorder.events.findLast((event) => event.type === "assistant");
  await writeFile(
    join(caseDir, "summary.md"),
    `# ${evalCase.id}\n\n**Prompt:** ${evalCase.prompt}\n\n${summaryTable([summary])}\n## Pesan akhir Claude\n\n${finalText?.type === "assistant" ? finalText.text : "-"}\n`,
  );
  console.log(`  [${evalCase.id}] ${summary.pass ? "lolos" : `tidak lolos: ${summary.failures.join("; ")}`}`);
  return summary;
}

/** DoD: Stop di tengah build (interrupt + docker kill), lalu resume sesi setelah proses ditutup. */
async function runStopResume(shared: Shared): Promise<string> {
  const evalCase = BASE_CASES.find((item) => item.id === "kursi") ?? BASE_CASES[0];
  if (evalCase === undefined) throw new Error("kasus tidak ada");
  const stopCase: EvalCase = { ...evalCase, id: "stop-resume" };
  const raw = join(shared.runDir, stopCase.id, "raw.jsonl");
  const first = await openCase(shared, stopCase, raw);
  first.runner.send(stopCase.prompt);
  const lines: string[] = ["# Stop dan resume", ""];
  const started = Date.now();
  while (
    !first.recorder.events.some((event) => event.type === "build_started") &&
    Date.now() - started < EVAL_MAX_DURATION_MS
  ) {
    await new Promise((done) => setTimeout(done, 200));
  }
  const buildStarted = first.recorder.events.some((event) => event.type === "build_started");
  lines.push(`- Build pertama dimulai: ${buildStarted ? "ya" : "tidak (batas waktu)"}`);
  await first.runner.interrupt();
  await waitForResult(first.recorder.events, 0, STOP_WAIT_MS);
  const cancelled = first.recorder.events.some(
    (event) => event.type === "build_finished" && event.code === "CANCELLED",
  );
  const leftovers = await leftoverEvalContainers();
  lines.push(`- Build dibatalkan (CANCELLED): ${cancelled ? "ya" : "tidak"}`);
  lines.push(`- Container job tersisa setelah Stop: ${leftovers.length}`);
  const interrupted = first.recorder.events.findLast((event) => event.type === "result");
  lines.push(
    `- Result giliran ditandai interrupted: ${interrupted?.type === "result" && interrupted.interrupted ? "ya" : "tidak"}`,
  );
  const sessionId = first.runner.sessionId;
  first.runner.close();
  lines.push(`- Proses Claude ditutup; session id: ${sessionId === undefined ? "-" : "ada"}`);

  // Folder aset yang sama (cwd stabil per aset, seperti di app), transcript terpisah.
  const second = await openCase(shared, stopCase, raw, { sessionId, transcript: "transcript-lanjut.jsonl" });
  second.runner.send(
    "Build tadi saya hentikan. Lanjutkan dari skrip yang sudah ada: satu build, periksa, lalu submit.",
  );
  await waitForResult(second.recorder.events, 0, EVAL_MAX_DURATION_MS);
  const init = second.recorder.events.find((event) => event.type === "init");
  lines.push(
    `- Resume memakai session id yang sama: ${init?.type === "init" && init.sessionId === sessionId ? "ya" : "tidak"}`,
  );
  const reply = second.recorder.events.findLast((event) => event.type === "assistant");
  lines.push(
    `- Balasan setelah resume: ${reply?.type === "assistant" ? reply.text.slice(0, 300).replace(/\n/g, " ") : "-"}`,
  );
  second.runner.close();
  const text = `${lines.join("\n")}\n`;
  await writeFile(join(shared.runDir, "stop-resume.md"), text);
  return text;
}

async function main(): Promise<number> {
  if (selected.length === 0) {
    console.error(`Kasus tidak dikenal. Pilihan: ${BASE_CASES.map((item) => item.id).join(", ")}`);
    return 2;
  }
  printPlan();
  if (!values.confirm) return 0;

  const account = await readAccountInfo();
  if (account.apiKeySource !== undefined && account.apiKeySource !== "none") {
    console.error("✗ SDK memakai API key; eval hanya boleh memakai sesi login Claude Code.");
    return 1;
  }
  const image = await requireRuntimeImage();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(ROOT, "eval", "runs", stamp);
  await mkdir(runDir, { recursive: true });
  const renderer = new Renderer();
  const lane = new HeavyLane();
  const shared: Shared = {
    port: sdkAgentPort,
    builder: new DockerAssetBuilder({
      lane,
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
    const summaries: RunSummary[] = [];
    for (const evalCase of selected) summaries.push(await runCase(shared, evalCase));
    const stopResume = values["stop-resume"] ? await runStopResume(shared) : "";
    const scoring = summaries.map((row) => `| ${row.id} | | |`).join("\n");
    await writeFile(
      join(runDir, "summary.md"),
      `# eval:base ${stamp}\n\nModel: ${model} · tier Sedang\n\n${summaryTable(summaries)}\n## Skor pemilik (1–5, layak bila ≥ 3)\n\n| Kasus | Skor | Catatan |\n|---|---|---|\n${scoring}\n\n${stopResume}`,
    );
    console.log(`\nRingkasan: ${join(runDir, "summary.md")}`);
    return 0;
  } finally {
    await renderer.close();
    await removeOrphanJobs(EVAL_OWNER);
  }
}

process.exitCode = await main();

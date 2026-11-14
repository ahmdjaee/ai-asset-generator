/** Ringkasan hasil satu kasus eval dari event sesi (murni, tanpa I/O). */
import type { AgentEvent } from "../../shared/agent-events.ts";

/** Syarat DoD Tahap 3 per prompt. */
export const EVAL_MAX_BUILDS = 6;
export const EVAL_MAX_DURATION_MS = 10 * 60_000;

export type EvalLimits = Readonly<{ stage: "base" | "textured"; maxBuilds: number; maxDurationMs: number }>;
export const BASE_LIMITS: EvalLimits = {
  stage: "base",
  maxBuilds: EVAL_MAX_BUILDS,
  maxDurationMs: EVAL_MAX_DURATION_MS,
};
/** Syarat DoD Tahap 4: lolos gerbang dalam ≤ 4 build; bake lebih lama, jadi batas waktu 15 menit. */
export const TEXTURE_LIMITS: EvalLimits = { stage: "textured", maxBuilds: 4, maxDurationMs: 15 * 60_000 };

/**
 * Rujukan ke contact sheet setelah build. Ringkasan berpikir umumnya berbahasa Inggris, balasan ke pemilik berbahasa
 * Indonesia, jadi kedua bahasa dikenali.
 */
const SHEET_REFERENCE =
  /\b(depan|belakang|kiri|kanan|atas|3\/4|contact sheet|sudut|siluet|front|back|side|top|view|render|silhouette)\b/i;

export type VersionReport = Readonly<{ triangles: number; validatorErrors: number; budgetOk: boolean }>;

export type RunSummary = Readonly<{
  id: string;
  submitted: boolean;
  submittedVersion: number | null;
  builds: number;
  failedBuilds: number;
  version: VersionReport | null;
  durationMs: number;
  costUsd: number | null;
  thinkingBlocks: number;
  thinkingChars: number;
  referencesSheet: boolean;
  questions: number;
  /** Gambar yang dikirim ke Claude lewat hasil tool. */
  images: number;
  errors: readonly string[];
  pass: boolean;
  failures: readonly string[];
}>;

export function summarizeRun(input: {
  id: string;
  events: readonly AgentEvent[];
  durationMs: number;
  version: VersionReport | null;
  limits?: EvalLimits;
}): RunSummary {
  const { events } = input;
  const limits = input.limits ?? BASE_LIMITS;
  const finished = events.filter((event) => event.type === "build_finished");
  const submittedEvent = events.findLast(
    (event) => event.type === "submitted" && event.stage === limits.stage,
  );
  const firstBuild = events.findIndex((event) => event.type === "build_finished");
  const thinking = events.filter((event) => event.type === "thinking");
  const referencesSheet =
    firstBuild >= 0 &&
    events
      .slice(firstBuild)
      .some(
        (event) =>
          (event.type === "assistant" || event.type === "thinking") && SHEET_REFERENCE.test(event.text),
      );
  const costs = events.flatMap((event) =>
    event.type === "result" && event.costUsd !== undefined ? [event.costUsd] : [],
  );
  const errors = events.flatMap((event) =>
    event.type === "error" ? [`${event.code}: ${event.message}`] : [],
  );

  const failures: string[] = [];
  if (submittedEvent === undefined) failures.push("tidak sampai submit_for_review");
  if (input.version !== null && input.version.validatorErrors > 0) failures.push("ada error validator");
  if (input.version !== null && !input.version.budgetOk) failures.push("melewati batas maksimal tier");
  if (finished.length > limits.maxBuilds) failures.push(`build > ${limits.maxBuilds}`);
  if (input.durationMs > limits.maxDurationMs)
    failures.push(`lebih dari ${Math.round(limits.maxDurationMs / 60_000)} menit`);

  return {
    id: input.id,
    submitted: submittedEvent !== undefined,
    submittedVersion: submittedEvent?.type === "submitted" ? submittedEvent.version : null,
    builds: finished.length,
    failedBuilds: finished.filter((event) => event.type === "build_finished" && !event.ok).length,
    version: input.version,
    durationMs: input.durationMs,
    // total_cost_usd adalah total berjalan sesi; nilai terakhir = total kasus ini.
    costUsd: costs.at(-1) ?? null,
    thinkingBlocks: thinking.length,
    thinkingChars: thinking.reduce(
      (sum, event) => sum + (event.type === "thinking" ? event.text.length : 0),
      0,
    ),
    referencesSheet,
    questions: events.filter((event) => event.type === "question").length,
    images: events.reduce((sum, event) => sum + (event.type === "tool_result" ? event.images : 0), 0),
    errors,
    pass: failures.length === 0,
    failures,
  };
}

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} mnt`;
}

export function summaryTable(rows: readonly RunSummary[], dod = "≥ 4 dari 5"): string {
  const header =
    "| Kasus | Lolos | Submit | Build (gagal) | Segitiga | Validator | Waktu | Berpikir | Rujuk contact sheet | Pertanyaan | Biaya (perkiraan) |\n|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((row) =>
    [
      row.id,
      row.pass ? "ya" : `tidak (${row.failures.join("; ")})`,
      row.submitted ? `v${row.submittedVersion}` : "-",
      `${row.builds} (${row.failedBuilds})`,
      row.version?.triangles ?? "-",
      row.version === null ? "-" : `${row.version.validatorErrors} error`,
      minutes(row.durationMs),
      `${row.thinkingBlocks} blok`,
      row.referencesSheet ? "ya" : "tidak",
      row.questions,
      row.costUsd === null ? "-" : `$${row.costUsd.toFixed(2)}`,
    ].join(" | "),
  );
  const passed = rows.filter((row) => row.pass).length;
  return `${header}\n${lines.map((line) => `| ${line} |`).join("\n")}\n\n**Lolos syarat otomatis: ${passed} dari ${rows.length}** (DoD: ${dod}).\n`;
}

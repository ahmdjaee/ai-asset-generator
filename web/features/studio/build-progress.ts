/**
 * Kartu progres build (FigCraft ringkasan #1095 + "Langkah progres (terbuka)" #3175): kartu build dari thread +
 * progres live + ringkasan versi → judul, keterangan, dan langkah `ProgressSteps`. Fungsi murni.
 *
 * Langkah urut pipeline: Menulis skrip → Build di sandbox → Optimasi & cek budget → Render contact sheet.
 * - Menulis skrip: sejak tool Write/Edit pertama ke skrip build sampai build dimulai.
 * - Selama berjalan, bagian aktif dibaca dari langkah live (`phaseOfStep`); lama bagian yang sudah lewat dari waktu
 *   bagian itu pertama terlihat.
 * - Setelah selesai, lama tiap bagian dari `timings` versi.
 * - Build gagal atau dihentikan berakhir dengan satu baris status; bagian sesudahnya tidak ditampilkan.
 */
import type { ProgressStep } from "@/components/ProgressSteps.tsx";
import { t } from "@/i18n/id.ts";
import { BUILD_PHASES, type BuildPhase, phaseOfStep } from "../../../shared/build-steps.ts";
import { formatDuration, formatNumber } from "../../../shared/format.ts";
import type { BuildTimings } from "../../../shared/version-report.ts";
import type { BuildBlock } from "./thread-items.ts";
import type { LiveBuild } from "./thread-store.ts";

export type BuildProgressInput = Readonly<{
  block: BuildBlock;
  /** Progres live build ini (hanya selama berjalan dan bila terlihat sejak tab ini terbuka). */
  live: LiveBuild | undefined;
  /** Lama tiap bagian dari ringkasan versi hasil build (build selesai). */
  timings: BuildTimings | null;
  /** Nomor versi yang sedang dibuat (build berjalan); `null` bila belum diketahui. */
  nextVersion: number | null;
  now: number;
}>;

export type BuildProgressView = Readonly<{ title: string; meta: string; steps: readonly ProgressStep[] }>;

type Phase = Exclude<BuildPhase, "script">;

/** Bagian tempat build gagal menurut kodenya; kode lain (mis. INTERNAL) dianggap gagal di sandbox. */
const FAILURE_PHASE: Readonly<Record<string, Phase>> = {
  VALIDATION_FAILED: "optimize",
  SHAPE_DRIFT: "optimize",
};

function failureReason(code: string | null): string {
  const failures: Readonly<Record<string, string>> = t.build.failures;
  return (code === null ? undefined : failures[code]) ?? t.build.unknownFailure;
}

function label(phase: BuildPhase): string {
  return t.build.steps[phase];
}

function duration(ms: number | null | undefined): string | undefined {
  return ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0 ? undefined : formatDuration(ms);
}

function step(phase: BuildPhase, status: ProgressStep["status"], ms?: number | null): ProgressStep {
  const text = duration(ms);
  return { id: phase, label: label(phase), status, ...(text === undefined ? {} : { duration: text }) };
}

function scriptStep(block: BuildBlock): ProgressStep {
  return step(
    "script",
    "done",
    block.scriptStartedAt === null ? null : block.startedAt - block.scriptStartedAt,
  );
}

const PHASES: readonly Phase[] = BUILD_PHASES.filter((phase): phase is Phase => phase !== "script");

/** Awal tiap bagian selama berjalan: sandbox mulai saat build dimulai, bagian lain saat pertama terlihat live. */
function phaseStart(phase: Phase, block: BuildBlock, live: LiveBuild | undefined): number | null {
  if (phase === "sandbox") return block.startedAt;
  return live?.phases[phase] ?? null;
}

function runningSteps(block: BuildBlock, live: LiveBuild | undefined): ProgressStep[] {
  const current = live === undefined ? "sandbox" : phaseOfStep(live.step);
  const currentIndex = PHASES.indexOf(current);
  return [
    scriptStep(block),
    ...PHASES.map((phase, index) => {
      if (index > currentIndex) return step(phase, "pending");
      if (index === currentIndex) return step(phase, "running");
      const start = phaseStart(phase, block, live);
      const nextPhase = PHASES[index + 1];
      const end = nextPhase === undefined ? null : phaseStart(nextPhase, block, live);
      return step(phase, "done", start === null || end === null ? null : end - start);
    }),
  ];
}

function doneSteps(block: BuildBlock, timings: BuildTimings | null): ProgressStep[] {
  return [
    scriptStep(block),
    step("sandbox", "done", timings?.runtimeMs),
    step("optimize", "done", timings?.pipelineMs),
    step("render", "done", timings?.renderMs),
  ];
}

/** Build berakhir tanpa versi: bagian yang pasti sudah lewat, lalu satu baris gagal/dihentikan. */
function endedSteps(block: BuildBlock): ProgressStep[] {
  const steps = [scriptStep(block)];
  if (block.status === "failed" && FAILURE_PHASE[block.code ?? ""] === "optimize") {
    steps.push(step("sandbox", "done"));
  }
  steps.push(
    block.status === "failed"
      ? { id: "ended", label: t.build.failedStep(failureReason(block.code)), status: "failed" }
      : { id: "ended", label: t.build.stoppedStep, status: "stopped" },
  );
  return steps;
}

function versionLabel(version: number | null): string | null {
  return version === null ? null : `v${version}`;
}

export function buildProgress({
  block,
  live,
  timings,
  nextVersion,
  now,
}: BuildProgressInput): BuildProgressView {
  const stage = t.build.stage[block.stage];
  const start = block.scriptStartedAt ?? block.startedAt;
  switch (block.status) {
    case "running":
      return {
        title: t.build.running(stage, versionLabel(nextVersion)),
        meta: formatDuration(now - start),
        steps: runningSteps(block, live),
      };
    case "done": {
      const steps = doneSteps(block, timings);
      return {
        title: t.build.done(t.build.stageTitle[block.stage], versionLabel(block.version)),
        meta: t.build.meta(formatNumber(steps.length), formatDuration((block.endedAt ?? now) - start)),
        steps,
      };
    }
    case "failed":
    case "stopped":
      return {
        title: block.status === "failed" ? t.build.failed(stage) : t.build.stopped(stage),
        meta: formatDuration((block.endedAt ?? now) - start),
        steps: endedSteps(block),
      };
  }
}

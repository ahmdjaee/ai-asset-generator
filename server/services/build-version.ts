/**
 * Build satu versi dari skrip Blender: runtime (Docker) → pipeline (optimasi, validasi, budget) → render contact
 * sheet → versi write-once. Semua langkah berjalan di jalur job berat.
 * - Bentuk dasar (`buildBaseVersion`): `work/base.py`, ekspor tanpa material, render clay.
 * - Aset final (`buildTexturedVersion`): `work/material.py` + salinan skrip bentuk dasar yang disetujui, bake atlas
 *   per tier, render bertekstur. Bentuk yang menyimpang dari bentuk dasar yang disetujui ditolak (`SHAPE_DRIFT`)
 *   sebelum versi dibuat.
 * Kegagalan yang disebabkan skrip dikembalikan sebagai hasil ber-`code` (untuk Claude), bukan dilempar.
 */
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStats } from "../../shared/asset-stats.ts";
import { PIPELINE_STEPS } from "../../shared/build-steps.ts";
import {
  BASE_JOB_LIMITS,
  BASE_OUTPUT_MAX_BYTES,
  type BudgetCheck,
  bakeSizes,
  DEFAULT_TIERS,
  type JobLimits,
  TEXTURED_OUTPUT_MAX_BYTES,
  type TierBudget,
  type TierId,
  texturedJobLimits,
} from "../../shared/limits.ts";
import type { BuildTimings, OptimizeSummary, ValidationSummary } from "../../shared/version-report.ts";
import { checkShape, type ShapeCheck, type ShapeStats } from "../domain/shape.ts";
import type { HeavyLane } from "../jobs/heavy-lane.ts";
import type { OptimizeReport } from "../pipeline/optimize.ts";
import { type ProcessResult, processGlb } from "../pipeline/process.ts";
import type { ValidationResult } from "../pipeline/validate.ts";
import type { RenderMode } from "../render/protocol.ts";
import type { Renderer } from "../render/renderer.ts";
import { runJob } from "../runtime/docker.ts";
import { ASSETKIT_DIR } from "../runtime/image.ts";
import {
  BASE_JOB_COMMAND,
  BLEND_OUTPUT,
  createJobDir,
  removeJobDir,
  texturedJobCommand,
} from "../runtime/job-dir.ts";
import { collectOutputs } from "../runtime/outputs.ts";
import { createVersion, type VersionManifest, writeDerived } from "./versions.ts";

/** Ekor stderr yang dikembalikan saat skrip gagal (cukup untuk traceback Python). */
const ERROR_TAIL_CHARS = 2000;
export const CONTACT_SHEET_FILE = "contact-sheet.png";

export type BuildFailureCode = "SCRIPT_ERROR" | "TIMEOUT" | "OOM" | "VALIDATION_FAILED" | "SHAPE_DRIFT";

export type { BuildTimings };

/**
 * Ringkasan untuk `meta` manifest versi (dibaca Studio lewat `shared/version-report.ts`): jumlah error dan peringatan
 * validator, serta langkah optimasi.
 */
export function buildSummary(
  processed: Readonly<{ validation: ValidationResult; optimize: OptimizeReport }>,
): { validation: ValidationSummary; optimize: OptimizeSummary } {
  return {
    validation: { errors: processed.validation.errors, warnings: processed.validation.warnings },
    optimize: { steps: [...processed.optimize.steps], simplified: processed.optimize.simplified },
  };
}

export type BuildOutcome =
  | Readonly<{
      ok: true;
      manifest: VersionManifest;
      stats: AssetStats;
      budget: BudgetCheck;
      validation: ValidationResult;
      contactSheetPath: string;
      peakMemBytes: number | null;
      timings: BuildTimings;
    }>
  | Readonly<{
      ok: false;
      code: BuildFailureCode;
      message: string;
      detail?: string;
      validation?: ValidationResult;
      shape?: ShapeCheck;
    }>;

export type BuildVersionOptions = Readonly<{
  jobId: string;
  scriptPath: string;
  /** `data/assets/<id>`. */
  assetDir: string;
  /** Root folder kerja job sementara. */
  jobsRoot: string;
  image: string;
  owner: string;
  tierId: TierId;
  /** Snapshot budget milik aset. */
  tier?: TierBudget;
  lane: HeavyLane;
  renderer: Renderer;
  signal?: AbortSignal;
  now?: () => number;
}>;

export type TexturedBuildOptions = BuildVersionOptions &
  Readonly<{
    /** Skrip bentuk dasar yang disetujui (`versions/vN/script.py`); disalin ke job sebagai `base.py`. */
    baseScriptPath: string;
    baseVersion: number;
    /** Statistik bentuk dasar yang disetujui, untuk cek bentuk. */
    baseShape: ShapeStats;
    /** Pustaka material CC0 (dipasang read-only di `/materials`). */
    materialsDir: string;
  }>;

function tail(text: string): string {
  return text.length > ERROR_TAIL_CHARS ? text.slice(-ERROR_TAIL_CHARS) : text;
}

/** Statistik pipeline → bentuk untuk cek konsistensi. */
export function shapeOf(stats: AssetStats): ShapeStats {
  return { triangles: stats.triangles, size: stats.bbox.size };
}

/**
 * Gerbang aset final: bentuk harus cocok dengan bentuk dasar yang disetujui. `null` = lolos.
 * Dipakai builder sungguhan dan builder palsu tes, supaya aturannya satu.
 */
export function shapeGate(baseShape: ShapeStats, stats: AssetStats): BuildOutcome | null {
  const shape = checkShape(baseShape, shapeOf(stats));
  if (shape.ok) return null;
  const keys = shape.issues.map((issue) => issue.key).join(", ");
  return {
    ok: false,
    code: "SHAPE_DRIFT",
    message: `Bentuk menyimpang dari bentuk dasar yang disetujui (${keys}). Geometri tahap tekstur harus sama; pakai scene.run_base().`,
    shape,
  };
}

type StageConfig = Readonly<{
  stage: "base" | "textured";
  kind: "build_base" | "build_textured";
  limits: JobLimits;
  command: readonly string[];
  glbName: "base.glb" | "final.glb";
  outputs: Readonly<Record<string, number>>;
  renderMode: RenderMode;
  extras: Readonly<Record<string, string>>;
  materialsDir?: string;
  /** Gerbang tambahan setelah pipeline lolos validasi; `null` = lanjut. */
  gate: (processed: ProcessResult) => BuildOutcome | null;
  versionFiles: (processed: ProcessResult) => Promise<Array<{ name: string; data: Uint8Array | string }>>;
  /** Output container tambahan yang ikut disalin ke versi bila ada (mis. `.blend`). */
  optionalOutputs: readonly string[];
  meta: Record<string, unknown>;
}>;

/**
 * Lampiran pemilik (`refs/`) dipasang read-only di `/refs`, supaya skrip bisa mengimpor model referensi dan memakai
 * gambar sebagai decal. Hanya folder sungguhan (bukan symlink); aset tanpa lampiran tidak memasang apa pun.
 */
async function refsMount(assetDir: string): Promise<string | null> {
  const path = join(assetDir, "refs");
  const info = await lstat(path).catch(() => null);
  return info?.isDirectory() === true ? path : null;
}

function buildVersion(options: BuildVersionOptions, config: StageConfig): Promise<BuildOutcome> {
  const now = options.now ?? (() => performance.now());
  const tier = options.tier ?? DEFAULT_TIERS[options.tierId];
  return options.lane.run(
    { jobId: options.jobId, kind: config.kind, signal: options.signal },
    async (job) => {
      const startedAt = now();
      const dir = await createJobDir(options.jobsRoot, options.scriptPath, config.extras);
      const refsDir = await refsMount(options.assetDir);
      try {
        const result = await runJob({
          jobId: options.jobId,
          image: options.image,
          mounts: {
            jobDir: dir.path,
            assetkitDir: ASSETKIT_DIR,
            ...(refsDir === null ? {} : { refsDir }),
            ...(config.materialsDir === undefined ? {} : { materialsDir: config.materialsDir }),
          },
          limits: config.limits,
          owner: options.owner,
          command: config.command,
          signal: job.signal,
          onProgress: (event) => job.progress(event.step, event.pct * 0.6),
        });
        const runtimeDone = now();
        if (result.cancelled) return { ok: false, code: "SCRIPT_ERROR", message: "Build dibatalkan" };
        if (result.timedOut) {
          return {
            ok: false,
            code: "TIMEOUT",
            message: `Skrip melewati batas ${config.limits.timeoutMs / 1000} dtk`,
          };
        }
        if (result.oom) return { ok: false, code: "OOM", message: "Skrip kehabisan memori" };
        const outputs = await collectOutputs(dir.outputDir, config.outputs);
        const glbFile = outputs.accepted.find((file) => file.name === config.glbName);
        if (result.exitCode !== 0 || glbFile === undefined) {
          return {
            ok: false,
            code: "SCRIPT_ERROR",
            message:
              result.exitCode === 0
                ? "Skrip tidak menghasilkan mesh"
                : `Skrip gagal (kode ${result.exitCode})`,
            detail: tail(result.stderrTail),
          };
        }

        job.progress(PIPELINE_STEPS.optimize, 65);
        const processed = await processGlb(new Uint8Array(await readFile(glbFile.path)), {
          tierId: options.tierId,
          tier,
          stage: config.stage,
          signal: job.signal,
        });
        const pipelineDone = now();
        if (!processed.validation.ok || processed.web === null) {
          return {
            ok: false,
            code: "VALIDATION_FAILED",
            message: `gltf-validator menemukan ${processed.validation.errors} error`,
            validation: processed.validation,
          };
        }

        const rejected = config.gate(processed);
        if (rejected !== null) return rejected;

        job.progress(PIPELINE_STEPS.render, 80);
        const rendered = await options.renderer.render(processed.glb, {
          mode: config.renderMode,
          signal: job.signal,
        });
        const renderDone = now();

        job.progress(PIPELINE_STEPS.save, 95);
        const report = {
          stage: config.stage,
          stats: processed.stats,
          webBytes: processed.web.byteLength,
          budget: processed.budget,
          validation: processed.validation,
          optimize: processed.optimize,
        };
        const timings: BuildTimings = {
          runtimeMs: Math.round(runtimeDone - startedAt),
          pipelineMs: Math.round(pipelineDone - runtimeDone),
          renderMs: Math.round(renderDone - pipelineDone),
          totalMs: Math.round(now() - startedAt),
        };
        const extras = await Promise.all(
          outputs.accepted
            .filter((file) => config.optionalOutputs.includes(file.name))
            .map(async (file) => ({ name: file.name, data: new Uint8Array(await readFile(file.path)) })),
        );
        const manifest = await createVersion({
          assetDir: options.assetDir,
          files: [
            ...(await config.versionFiles(processed)),
            ...extras,
            { name: "stats.json", data: `${JSON.stringify(report, null, 2)}\n` },
          ],
          meta: {
            ...config.meta,
            stage: config.stage,
            tierId: options.tierId,
            jobId: options.jobId,
            peakMemBytes: result.peakMemBytes,
            timings,
            ...buildSummary(processed),
          },
        });
        const contactSheetPath = await writeDerived(
          options.assetDir,
          manifest.version,
          CONTACT_SHEET_FILE,
          rendered.sheet.png,
        );
        return {
          ok: true,
          manifest,
          stats: processed.stats,
          budget: processed.budget,
          validation: processed.validation,
          contactSheetPath,
          peakMemBytes: result.peakMemBytes,
          timings,
        };
      } finally {
        await removeJobDir(options.jobsRoot, dir);
      }
    },
  );
}

export function buildBaseVersion(options: BuildVersionOptions): Promise<BuildOutcome> {
  return buildVersion(options, {
    stage: "base",
    kind: "build_base",
    limits: BASE_JOB_LIMITS,
    command: BASE_JOB_COMMAND,
    glbName: "base.glb",
    outputs: BASE_OUTPUT_MAX_BYTES,
    renderMode: "clay",
    extras: {},
    gate: () => null,
    optionalOutputs: [BLEND_OUTPUT],
    versionFiles: async (processed) => [
      { name: "base.glb", data: processed.glb },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: new Uint8Array(await readFile(options.scriptPath)) },
    ],
    meta: {},
  });
}

export function buildTexturedVersion(options: TexturedBuildOptions): Promise<BuildOutcome> {
  const tier = options.tier ?? DEFAULT_TIERS[options.tierId];
  return buildVersion(options, {
    stage: "textured",
    kind: "build_textured",
    limits: texturedJobLimits(tier),
    command: texturedJobCommand(bakeSizes(tier)),
    glbName: "final.glb",
    outputs: TEXTURED_OUTPUT_MAX_BYTES,
    renderMode: "texture",
    extras: { "base.py": options.baseScriptPath },
    materialsDir: options.materialsDir,
    gate: (processed) => shapeGate(options.baseShape, processed.stats),
    optionalOutputs: [BLEND_OUTPUT],
    versionFiles: async (processed) => [
      { name: "final.glb", data: processed.glb },
      { name: "web.glb", data: processed.web ?? new Uint8Array() },
      { name: "script.py", data: new Uint8Array(await readFile(options.scriptPath)) },
      { name: "base.py", data: new Uint8Array(await readFile(options.baseScriptPath)) },
    ],
    meta: { baseVersion: options.baseVersion },
  });
}

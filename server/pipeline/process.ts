/**
 * Pipeline inspeksi satu GLB: baca → optimasi → tulis → validasi (sebelum kompresi) → kompresi Web → statistik
 * dan budget. GLB yang gagal validasi tidak dikompresi; pemanggil menolak build dengan `VALIDATION_FAILED`.
 */
import type { AssetStats } from "../../shared/asset-stats.ts";
import {
  type BudgetCheck,
  checkBudget,
  DEFAULT_TIERS,
  type TierBudget,
  type TierId,
} from "../../shared/limits.ts";
import { readGlb, writeGlb } from "./io.ts";
import { type AssetStage, compressForWeb, type OptimizeReport, optimizeDocument } from "./optimize.ts";
import { documentStats } from "./stats.ts";
import { type ValidationResult, validateGlb } from "./validate.ts";

export type ProcessOptions = Readonly<{
  tierId: TierId;
  /** Snapshot budget milik aset; bawaan budget tier saat ini. */
  tier?: TierBudget;
  stage: AssetStage;
  signal?: AbortSignal;
  onProgress?: (step: string, pct: number) => void;
}>;

export type ProcessResult = Readonly<{
  /** GLB teroptimasi tanpa ekstensi kompresi (yang divalidasi). */
  glb: Uint8Array;
  /** Preset Web (meshopt + WebP); `null` bila validasi gagal. */
  web: Uint8Array | null;
  stats: AssetStats;
  validation: ValidationResult;
  budget: BudgetCheck;
  optimize: OptimizeReport;
}>;

export async function processGlb(input: Uint8Array, options: ProcessOptions): Promise<ProcessResult> {
  const tier = options.tier ?? DEFAULT_TIERS[options.tierId];
  const progress = options.onProgress ?? (() => undefined);

  progress("optimasi", 10);
  const document = await readGlb(input);
  const optimize = await optimizeDocument(document, {
    tierId: options.tierId,
    tier,
    stage: options.stage,
    signal: options.signal,
  });
  const glb = await writeGlb(document);
  const stats = documentStats(document, glb.byteLength);

  progress("validasi", 50);
  options.signal?.throwIfAborted();
  const validation = await validateGlb(glb);
  if (!validation.ok) {
    return { glb, web: null, stats, validation, budget: checkBudget(stats, tier), optimize };
  }

  progress("kompresi web", 70);
  const web = await writeGlb(await compressForWeb(document, options.signal));
  // Budget ukuran web.glb hanya berlaku untuk aset final; bentuk dasar belum bertekstur.
  const budget = checkBudget(stats, tier, options.stage === "textured" ? web.byteLength : undefined);
  progress("selesai", 100);
  return { glb, web, stats, validation, budget, optimize };
}

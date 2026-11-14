/**
 * Ringkasan build sebuah versi, disimpan di `meta` manifest versi (sejak Tahap 9) dan ditampilkan Studio: hasil
 * validator glTF, lama tiap bagian build, dan langkah optimasi. Versi lama tanpa ringkasan dibaca sebagai `null`.
 */
import { z } from "zod";

const Count = z.number().int().nonnegative();
const Ms = z.number().nonnegative();

export const ValidationSummary = z.object({ errors: Count, warnings: Count });
export type ValidationSummary = z.infer<typeof ValidationSummary>;

/** Lama build per bagian: container (skrip + ekspor), pipeline (optimasi + validasi), render contact sheet. */
export const BuildTimings = z.object({ runtimeMs: Ms, pipelineMs: Ms, renderMs: Ms, totalMs: Ms });
export type BuildTimings = z.infer<typeof BuildTimings>;

export const OptimizeSummary = z.object({
  steps: z.array(z.string()),
  /** Diisi bila simplify otomatis dijalankan: jumlah segitiga sebelum dan sesudah. */
  simplified: z.object({ from: Count, to: Count }).nullable(),
});
export type OptimizeSummary = z.infer<typeof OptimizeSummary>;

export type VersionReport = Readonly<{
  validation: ValidationSummary | null;
  timings: BuildTimings | null;
  optimize: OptimizeSummary | null;
}>;

/** Membaca ringkasan dari `meta` manifest; field yang tidak ada atau rusak menjadi `null`. */
export function versionReport(meta: unknown): VersionReport {
  const record = z.record(z.string(), z.unknown()).safeParse(meta);
  const get = (key: string): unknown => (record.success ? record.data[key] : undefined);
  const validation = ValidationSummary.safeParse(get("validation"));
  const timings = BuildTimings.safeParse(get("timings"));
  const optimize = OptimizeSummary.safeParse(get("optimize"));
  return {
    validation: validation.success ? validation.data : null,
    timings: timings.success ? timings.data : null,
    optimize: optimize.success ? optimize.data : null,
  };
}

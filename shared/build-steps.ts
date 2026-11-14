/**
 * Nama langkah progres build yang dikirim harness setelah container selesai (`server/services/build-version.ts`).
 * Langkah dari container (`assetkit`) bebas namanya dan semuanya termasuk bagian "Build di sandbox". Studio memetakan
 * nama-nama ini ke baris progres (Tahap 9), jadi server dan web memakai konstanta yang sama.
 */
export const PIPELINE_STEPS = {
  optimize: "optimasi dan validasi",
  render: "render contact sheet",
  save: "menyimpan versi",
} as const;

/** Bagian build seperti yang ditampilkan Studio, urut sesuai pipeline. */
export const BUILD_PHASES = ["script", "sandbox", "optimize", "render"] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];

/** Langkah live → bagian build. Menyimpan versi masih termasuk render (langkah terakhir yang tampil). */
export function phaseOfStep(step: string): Exclude<BuildPhase, "script"> {
  if (step === PIPELINE_STEPS.optimize) return "optimize";
  if (step === PIPELINE_STEPS.render || step === PIPELINE_STEPS.save) return "render";
  return "sandbox";
}

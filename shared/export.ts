/**
 * Ekspor aset (PLAN Tahap 10): preset satu versi, ZIP banyak aset dari Gudang, dan nama file yang aman.
 * Dipakai server (rute, service) dan web (dialog ekspor, bilah pilih).
 */
import { z } from "zod";
import { EXPORT_NAME_MAX_CHARS, EXPORT_ZIP_MAX_ASSETS } from "./limits.ts";
import { truncate } from "./text.ts";

/**
 * - `web`: `web.glb` versi (meshopt + WebP), untuk browser/three.js.
 * - `unity`: GLB tanpa ekstensi kompresi, tekstur PNG/JPEG (glTFast tanpa paket tambahan), 0 error validator.
 * - `source`: ZIP berisi `.blend`, skrip, tekstur PNG, statistik, dan README.
 */
export const EXPORT_PRESETS = ["web", "unity", "source"] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number];

/** Preset untuk ZIP banyak aset (satu GLB per aset). */
export const ZIP_PRESETS = ["web", "unity"] as const;
export type ZipPreset = (typeof ZIP_PRESETS)[number];

/** Bagian nama file per preset (`peti-v2-unity.glb`, `peti-v2-sumber.zip`). */
export const PRESET_FILE_SUFFIX: Readonly<Record<ExportPreset, string>> = {
  web: "web.glb",
  unity: "unity.glb",
  source: "sumber.zip",
};

const AssetId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ExportQuery = z.object({
  version: z.coerce.number().int().min(1),
  preset: z.enum(EXPORT_PRESETS),
});
export type ExportQuery = z.infer<typeof ExportQuery>;

export const ExportEstimateQuery = z.object({ version: z.coerce.number().int().min(1) });

/** `ids` dipisah koma (urutan dipertahankan, duplikat dibuang). */
export const ExportZipQuery = z.object({
  ids: z
    .string()
    .transform((value) => [...new Set(value.split(","))])
    .pipe(z.array(AssetId).min(1).max(EXPORT_ZIP_MAX_ASSETS)),
  preset: z.enum(ZIP_PRESETS),
});

/** Body `POST /api/assets/export-zip/prepare`: aset yang sama dengan tautan unduhan ZIP (duplikat dibuang). */
export const ExportZipBody = z.object({
  ids: z
    .array(AssetId)
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(AssetId).min(1).max(EXPORT_ZIP_MAX_ASSETS)),
  preset: z.enum(ZIP_PRESETS),
});

/** Hasil pemeriksaan ZIP: jumlah aset dan total ukuran GLB (sebelum dikemas). */
export type ZipSummary = Readonly<{ assets: number; bytes: number }>;

export type PresetEstimate = Readonly<{
  preset: ExportPreset;
  /** Nama file unduhan. */
  fileName: string;
  bytes: number;
  /** `false`: perkiraan (file belum pernah dibuat); `true`: ukuran file yang sudah ada. */
  exact: boolean;
}>;

export type ExportEstimate = Readonly<{ version: number; presets: readonly PresetEstimate[] }>;

/**
 * Nama aset → bagian nama file yang aman di semua sistem dan di dalam ZIP: hanya huruf dan angka (Unicode), dipisah
 * `-`, huruf kecil. Pemisah path, titik, dan karakter kendali tidak pernah lolos, jadi tidak bisa keluar dari folder
 * tujuan (zip-slip). Nama yang kosong setelah dibersihkan memakai `fallback`.
 */
export function safeFileStem(name: string, fallback = "aset"): string {
  const stem = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const cut = truncate(stem, EXPORT_NAME_MAX_CHARS).replace(/-+$/, "");
  return cut === "" ? fallback : cut;
}

export function exportFileName(assetName: string, version: number, preset: ExportPreset): string {
  return `${safeFileStem(assetName)}-v${version}-${PRESET_FILE_SUFFIX[preset]}`;
}

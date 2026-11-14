/**
 * Cari, filter, dan urut daftar aset (Gudang, PLAN Tahap 10). Skema query dipakai server (validasi `GET /api/assets`)
 * dan web (key cache), jadi keduanya selalu sepakat.
 */
import { z } from "zod";
import type { AssetStatus } from "./asset.ts";
import { ASSET_SEARCH_MAX_CHARS, TIER_IDS } from "./limits.ts";

/** Filter "Tahap": tahap 1 (bentuk dasar), tahap 2 (aset final), atau selesai. */
export const STAGE_FILTERS = ["base", "textured", "done"] as const;
export type StageFilter = (typeof STAGE_FILTERS)[number];

export const STAGE_FILTER_STATUSES: Readonly<Record<StageFilter, readonly AssetStatus[]>> = {
  base: ["BRIEFING", "BASE_WORKING", "BASE_REVIEW"],
  textured: ["TEXTURE_WORKING", "TEXTURE_REVIEW"],
  done: ["DONE"],
};

/** Urutan: terakhir diubah dulu, terlama dulu, atau nama A–Z. */
export const ASSET_SORTS = ["updated", "oldest", "name"] as const;
export type AssetSort = (typeof ASSET_SORTS)[number];

export const AssetListQuery = z.object({
  /** Kata kunci: nama, prompt, atau kategori/ringkasan brief. Kosong = tanpa pencarian. */
  q: z.string().trim().max(ASSET_SEARCH_MAX_CHARS).optional(),
  tier: z.enum(TIER_IDS).optional(),
  stage: z.enum(STAGE_FILTERS).optional(),
  /** Hanya aset yang diubah sejak waktu ini (ms epoch). Dihitung klien dari pilihan "Tanggal" (zona waktunya sendiri). */
  since: z.coerce.number().int().min(0).optional(),
  sort: z.enum(ASSET_SORTS).optional(),
});
export type AssetListQuery = z.infer<typeof AssetListQuery>;

export type BuildStage = "base" | "textured";

/** Progres build yang sedang berjalan (kartu "Membuat…"): tahap dan persen 0–100. */
export type BuildProgressView = Readonly<{ stage: BuildStage; pct: number }>;

/** Ada filter atau kata kunci yang aktif (state "Tidak ada hasil" vs "Belum ada aset"). */
export function hasListFilter(query: AssetListQuery): boolean {
  return (
    (query.q !== undefined && query.q !== "") ||
    query.tier !== undefined ||
    query.stage !== undefined ||
    query.since !== undefined
  );
}

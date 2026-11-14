/**
 * State cari/filter/urut/tampilan Gudang di URL (`/gudang?q=peti&tier=sedang&view=list`), supaya bertahan saat kembali
 * dari Detail aset dan bisa dibagikan. Nilai yang tidak dikenal dibuang (kembali ke bawaan), bukan error.
 */
import { z } from "zod";
import {
  ASSET_SORTS,
  type AssetListQuery,
  type AssetSort,
  STAGE_FILTERS,
  type StageFilter,
} from "../../../shared/asset-list.ts";
import { ASSET_SEARCH_MAX_CHARS, TIER_IDS, type TierId } from "../../../shared/limits.ts";

/** Pilihan "Tanggal": diubah dalam 24 jam, 7 hari, atau 30 hari terakhir. */
export const DATE_FILTERS = ["day", "week", "month"] as const;
export type DateFilter = (typeof DATE_FILTERS)[number];

const HOUR_MS = 60 * 60 * 1000;
const DATE_FILTER_MS: Readonly<Record<DateFilter, number>> = {
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
  month: 30 * 24 * HOUR_MS,
};

export const VIEWS = ["grid", "list"] as const;
export type GudangView = (typeof VIEWS)[number];

export type GudangParams = Readonly<{
  /** Teks kolom cari apa adanya (belum di-trim). */
  q: string;
  tier: TierId | undefined;
  stage: StageFilter | undefined;
  date: DateFilter | undefined;
  sort: AssetSort;
  view: GudangView;
}>;

function pick<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return values.find((value) => value === raw);
}

const SearchText = z.string().max(ASSET_SEARCH_MAX_CHARS);

export function parseGudangParams(search: URLSearchParams): GudangParams {
  const q = SearchText.safeParse(search.get("q") ?? "");
  return {
    q: q.success ? q.data : "",
    tier: pick(TIER_IDS, search.get("tier")),
    stage: pick(STAGE_FILTERS, search.get("stage")),
    date: pick(DATE_FILTERS, search.get("date")),
    sort: pick(ASSET_SORTS, search.get("sort")) ?? "updated",
    view: pick(VIEWS, search.get("view")) ?? "grid",
  };
}

/** Parameter URL dari state: nilai bawaan dan kata kunci kosong tidak ditulis. */
export function gudangSearch(params: GudangParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.q.trim() !== "") search.set("q", params.q);
  if (params.tier !== undefined) search.set("tier", params.tier);
  if (params.stage !== undefined) search.set("stage", params.stage);
  if (params.date !== undefined) search.set("date", params.date);
  if (params.sort !== "updated") search.set("sort", params.sort);
  if (params.view !== "grid") search.set("view", params.view);
  return search;
}

/** Batas bawah "Tanggal" (ms epoch) dihitung dari `now`; tanpa pilihan tanggal → tanpa batas. */
export function dateSince(date: DateFilter | undefined, now: number): number | undefined {
  return date === undefined ? undefined : Math.max(0, now - DATE_FILTER_MS[date]);
}

/** Query daftar untuk server; `since` dihitung pemanggil sekali per pilihan tanggal, supaya kunci cache stabil. */
export function listQuery(params: GudangParams, since: number | undefined): AssetListQuery {
  const q = params.q.trim();
  return {
    ...(q === "" ? {} : { q }),
    ...(params.tier === undefined ? {} : { tier: params.tier }),
    ...(params.stage === undefined ? {} : { stage: params.stage }),
    ...(since === undefined ? {} : { since }),
    ...(params.sort === "updated" ? {} : { sort: params.sort }),
  };
}

/** "Hapus filter": kata kunci, tier, tahap, dan tanggal dikosongkan; urutan dan tampilan tetap. */
export function clearFilters(params: GudangParams): GudangParams {
  return { ...params, q: "", tier: undefined, stage: undefined, date: undefined };
}

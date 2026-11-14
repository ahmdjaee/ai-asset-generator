import { keepPreviousData, type QueryClient, useQuery } from "@tanstack/react-query";
import type { AssetListQuery, BuildProgressView } from "../../shared/asset-list.ts";
import { api, toApiError } from "./api.ts";

/** Awalan kunci cache semua daftar aset; diinvalidasi penyimak global (`useAssetWatcher`) dan mutasi aset. */
export const assetsKey = ["assets"] as const;

/** Parameter query yang dikirim: nilai kosong dan bawaan dibuang, supaya query yang sama memakai satu cache. */
export function listSearchParams(query: AssetListQuery) {
  const q = query.q?.trim() ?? "";
  return {
    ...(q === "" ? {} : { q }),
    ...(query.tier === undefined ? {} : { tier: query.tier }),
    ...(query.stage === undefined ? {} : { stage: query.stage }),
    ...(query.since === undefined ? {} : { since: String(query.since) }),
    ...(query.sort === undefined || query.sort === "updated" ? {} : { sort: query.sort }),
  };
}

export const assetListKey = (query: AssetListQuery) => ["assets", "list", listSearchParams(query)] as const;

async function fetchAssetList(query: AssetListQuery) {
  const response = await api.assets.$get({ query: listSearchParams(query) });
  if (!response.ok) throw await toApiError(response);
  return response.json();
}

export type AssetListData = Awaited<ReturnType<typeof fetchAssetList>>;
export type AssetListItemData = AssetListData["assets"][number];

const ALL: AssetListQuery = {};
const NO_ASSETS: AssetListData = { assets: [], total: 0 };

function listItems(list: AssetListData): AssetListData["assets"] {
  return list.assets;
}

/** Semua aset, terakhir diubah dulu (`GET /api/assets`); diperbarui lewat event WebSocket topik `global`. */
export function useAssets() {
  return useQuery({ queryKey: assetListKey(ALL), queryFn: () => fetchAssetList(ALL), select: listItems });
}

/**
 * Daftar Gudang sesuai cari/filter/urut. Selama query baru dimuat, hasil sebelumnya tetap tampil (`isPlaceholderData`),
 * supaya grid tidak berkedip ke kerangka setiap kali filter diubah.
 */
export function useAssetList(query: AssetListQuery) {
  return useQuery({
    queryKey: assetListKey(query),
    queryFn: () => fetchAssetList(query),
    placeholderData: keepPreviousData,
  });
}

function anyRunning(list: AssetListData): boolean {
  return list.assets.some((asset) => asset.runState === "running");
}

/**
 * Ada aset yang sedang dikerjakan Claude (titik proses di rel Studio). Lewat `select` (dan daftar kosong selama
 * memuat), pemakainya hanya dirender ulang bila nilai ini berubah, bukan setiap daftar aset berubah.
 */
export function useStudioBusy(): boolean {
  return (
    useQuery({
      queryKey: assetListKey(ALL),
      queryFn: () => fetchAssetList(ALL),
      select: anyRunning,
      placeholderData: NO_ASSETS,
    }).data ?? false
  );
}

/**
 * Progres build dari topik `global` digabung ke semua daftar aset di cache, tanpa mengambil ulang. Selesainya build
 * datang sebagai perubahan aset biasa (daftar diambil ulang, progres kembali `null`).
 */
export function mergeBuildProgress(client: QueryClient, assetId: string, progress: BuildProgressView): void {
  client.setQueriesData<AssetListData>({ queryKey: assetsKey }, (list) => {
    if (list === undefined || !list.assets.some((asset) => asset.id === assetId)) return list;
    return {
      ...list,
      assets: list.assets.map((asset) => (asset.id === assetId ? { ...asset, progress } : asset)),
    };
  });
}

/** Aset yang baru dihapus langsung dibuang dari semua daftar di cache; refetch berikutnya mengonfirmasinya. */
export function removeFromAssetLists(client: QueryClient, assetId: string): void {
  client.setQueriesData<AssetListData>({ queryKey: assetsKey }, (list) => {
    if (list === undefined || !list.assets.some((asset) => asset.id === assetId)) return list;
    return {
      assets: list.assets.filter((asset) => asset.id !== assetId),
      total: Math.max(0, list.total - 1),
    };
  });
}

/**
 * Aksi aset dari Gudang, Detail aset, dan topbar Studio: ganti nama, duplikat, hapus, estimasi ukuran ekspor, dan
 * pemeriksaan ZIP.
 * Hasilnya langsung ditulis ke cache (detail dan daftar); event WebSocket topik `global` menyusul menyegarkan semua tab.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, toApiError } from "@/lib/api.ts";
import { assetsKey, removeFromAssetLists } from "@/lib/assets.ts";
import type { ZipPreset } from "../../../shared/export.ts";
import { type AssetDetailData, assetKey, markAssetDeleted } from "../studio/queries.ts";

export function useRenameAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, name }: Readonly<{ assetId: string; name: string }>) => {
      const response = await api.assets[":id"].$patch({ param: { id: assetId }, json: { name } });
      if (!response.ok) throw await toApiError(response);
      return (await response.json()).asset;
    },
    onSuccess: (asset) => {
      client.setQueryData<AssetDetailData>(assetKey(asset.id), (current) =>
        current === undefined ? current : { ...current, asset: { ...current.asset, name: asset.name } },
      );
      void client.invalidateQueries({ queryKey: assetsKey });
    },
  });
}

export function useDuplicateAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      const response = await api.assets[":id"].duplicate.$post({ param: { id: assetId } });
      if (!response.ok) throw await toApiError(response);
      return (await response.json()).asset;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: assetsKey }),
  });
}

export function useDeleteAsset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (assetId: string) => {
      const response = await api.assets[":id"].$delete({ param: { id: assetId } });
      if (!response.ok) throw await toApiError(response);
      return assetId;
    },
    // Detail aset yang dihapus tidak dibuang dari cache: halaman yang masih menampilkannya (di balik dialog) tetap
    // memakai data terakhir sampai pindah halaman. Aset ditandai dihapus, jadi detailnya tidak diambil lagi (404).
    onSuccess: (assetId) => {
      markAssetDeleted(client, assetId);
      removeFromAssetLists(client, assetId);
      void client.invalidateQueries({ queryKey: assetsKey });
    },
  });
}

/**
 * Pemeriksaan sebelum unduhan ZIP Gudang: server mengecek semua aset dan membuat GLB Unity yang belum ada, jadi
 * kesalahannya bisa ditampilkan sebelum tautan unduhan diikuti.
 */
export function usePrepareZip() {
  return useMutation({
    mutationFn: async ({ ids, preset }: Readonly<{ ids: readonly string[]; preset: ZipPreset }>) => {
      const response = await api.assets["export-zip"].prepare.$post({ json: { ids: [...ids], preset } });
      if (!response.ok) throw await toApiError(response);
      return response.json();
    },
  });
}

export const exportEstimateKey = (assetId: string, version: number) =>
  ["asset", assetId, "export-estimate", version] as const;

/** Ukuran file tiap preset ekspor satu versi; diambil saat dialog ekspor terbuka. */
export function useExportEstimate(assetId: string, version: number | null) {
  return useQuery({
    queryKey: exportEstimateKey(assetId, version ?? 0),
    enabled: version !== null,
    queryFn: async () => {
      const response = await api.assets[":id"].export.estimate.$get({
        param: { id: assetId },
        query: { version: String(version ?? 0) },
      });
      if (!response.ok) throw await toApiError(response);
      return response.json();
    },
  });
}

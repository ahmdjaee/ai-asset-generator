/** Teks ringkas aset di kartu dan baris daftar Gudang. */
import { t } from "@/i18n/id.ts";
import type { AssetListItemData } from "@/lib/assets.ts";
import { formatBytes, formatCompact, formatPercent } from "../../../shared/format.ts";

const STAGE_NUMBER = { base: 1, textured: 2 } as const;

/**
 * Info kartu dan kolom "Ukuran" (FigCraft AssetCard #2641, daftar #4886): "3,4k segitiga · 612 KB" (versi terkini),
 * "Tahap 2 · 62%" (build sedang berjalan), atau "Belum ada versi".
 */
export function assetInfo(asset: Pick<AssetListItemData, "current" | "progress">): string {
  const { info } = t.gudang;
  if (asset.progress !== null) {
    return info.progress(STAGE_NUMBER[asset.progress.stage], formatPercent(asset.progress.pct / 100));
  }
  if (asset.current === null) return info.noVersion;
  const triangles = info.triangles(formatCompact(asset.current.triangles));
  return asset.current.webBytes === null
    ? triangles
    : info.join(triangles, formatBytes(asset.current.webBytes));
}

/** Progres build untuk bar kartu (0..1), atau tanpa bar. */
export function assetProgress(asset: Pick<AssetListItemData, "progress">): number | undefined {
  return asset.progress === null ? undefined : asset.progress.pct / 100;
}

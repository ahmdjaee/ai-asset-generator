/** Isi panel detail viewer (budget, statistik, versi, validasi, optimasi), sama di sesi Studio dan Detail aset. */
import { thumbUrl } from "@/lib/asset-urls.ts";
import type { DetailPanelData } from "../viewer/DetailPanel.tsx";
import { budgetMeters, fileBytes, optimizationSummary, statRows, versionItems } from "./detail.ts";
import type { AssetData, VersionData } from "./queries.ts";

/** File yang dibuka viewer dan diunduh tombol Unduh (meshopt + WebP). */
export const WEB_FILE = "web.glb";

export function detailPanelData(
  asset: AssetData,
  versions: readonly VersionData[],
  version: VersionData,
  now: number,
  onVersionChange: (version: number) => void,
): DetailPanelData {
  return {
    tier: asset.tierId,
    meters: budgetMeters(version.stats, fileBytes(version, WEB_FILE), asset.tier),
    rows: statRows(version),
    versions: versionItems(versions, now, (item) =>
      item.thumbnail ? thumbUrl(asset.id, item.n) : undefined,
    ),
    version: version.n,
    onVersionChange,
    validation: version.validation,
    optimization: optimizationSummary(version),
  };
}

/**
 * URL file aset di server (`server/http/routes/assets.ts`), satu tempat untuk semua fitur web: file versi, thumbnail
 * dan turntable Gudang, lampiran, serta unduhan ekspor. URL ekspor dibuat lewat client `hc`, jadi parameter query
 * dicek compiler terhadap validator rute.
 */
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import type { ExportPreset, ZipPreset } from "../../shared/export.ts";
import { api } from "./api.ts";

/** Path + query saja: client `hc` memberi URL absolut dengan origin halaman. */
function relative(url: URL): string {
  return `${url.pathname}${url.search}`;
}

const assetPath = (assetId: string) => `/api/assets/${encodeURIComponent(assetId)}`;

export const versionFileUrl = (assetId: string, version: number, file: string) =>
  `${assetPath(assetId)}/versions/${version}/${encodeURIComponent(file)}`;

export const attachmentUrl = (assetId: string, attachmentId: string) =>
  `${assetPath(assetId)}/attachments/${encodeURIComponent(attachmentId)}`;

/** Thumbnail versi (frame pertama turntable). */
export const thumbUrl = (assetId: string, version: number) => versionFileUrl(assetId, version, THUMB_FILE);

/** Strip turntable versi (semua frame berjajar mendatar). */
export const turntableUrl = (assetId: string, version: number) =>
  versionFileUrl(assetId, version, TURNTABLE_FILE);

/** Unduhan satu preset ekspor satu versi (dibuat dan di-cache server di `derived/` saat pertama diminta). */
export function exportUrl(assetId: string, version: number, preset: ExportPreset): string {
  return relative(
    api.assets[":id"].export.$url({ param: { id: assetId }, query: { version: String(version), preset } }),
  );
}

/** ZIP banyak aset (satu GLB per aset, versi terkini), di-stream server. */
export function exportZipUrl(assetIds: readonly string[], preset: ZipPreset): string {
  return relative(api.assets["export-zip"].$url({ query: { ids: assetIds.join(","), preset } }));
}

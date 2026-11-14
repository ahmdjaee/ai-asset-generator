/**
 * Bagian murni `textures:sync`: daftar material, respons API ambientCG v3, ekstraksi ZIP, lock checksum, katalog.
 * Isi ZIP dan respons API tidak dipercaya: hanya entri dengan nama persis yang diharapkan yang dibaca, ukurannya
 * dibatasi, dan isinya harus JPEG.
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { z } from "zod";
import {
  type CatalogMaterial,
  MATERIAL_CATEGORIES,
  MATERIAL_ID,
  type MaterialCategory,
  type MaterialMap,
  type MaterialResolution,
} from "../../shared/material-catalog.ts";

export const API_BASE = "https://ambientcg.com/api/v3/assets";
/** Host yang boleh dihubungi, termasuk tujuan redirect unduhan. */
export const ALLOWED_HOSTS = new Set(["ambientcg.com", "acg-download.struffelproductions.com"]);
/** User-Agent generik (tanpa data pemilik). */
export const USER_AGENT = "ai-asset-generate-texture-sync/1.0";
/** Batas ukuran ZIP yang diunduh dan satu file hasil ekstraksi. */
export const MAX_ZIP_BYTES = 120 * 1024 * 1024;
export const MAX_MAP_BYTES = 48 * 1024 * 1024;

export class LibraryError extends Error {
  readonly code:
    | "INVALID_LIST"
    | "INVALID_RESPONSE"
    | "CHECKSUM_MISMATCH"
    | "INVALID_ARCHIVE"
    | "HOST_NOT_ALLOWED";

  constructor(code: LibraryError["code"], message: string) {
    super(message);
    this.name = "LibraryError";
    this.code = code;
  }
}

export type ListEntry = Readonly<{ id: string; category: MaterialCategory }>;

/** `runtime/materials.txt`: satu `<id> <kategori>` per baris; `#` komentar. */
export function parseMaterialList(text: string): ListEntry[] {
  const entries: ListEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.replace(/#.*/, "").trim();
    if (line === "") continue;
    const [id, category, ...rest] = line.split(/\s+/);
    const where = `materials.txt baris ${index + 1}`;
    if (id === undefined || category === undefined || rest.length > 0) {
      throw new LibraryError("INVALID_LIST", `${where}: format harus '<id> <kategori>'`);
    }
    if (!MATERIAL_ID.test(id)) throw new LibraryError("INVALID_LIST", `${where}: id tidak valid (${id})`);
    const parsed = z.enum(MATERIAL_CATEGORIES).safeParse(category);
    if (!parsed.success)
      throw new LibraryError("INVALID_LIST", `${where}: kategori tidak dikenal (${category})`);
    if (seen.has(id.toLowerCase())) throw new LibraryError("INVALID_LIST", `${where}: id ganda (${id})`);
    seen.add(id.toLowerCase());
    entries.push({ id, category: parsed.data });
  }
  return entries;
}

const AcgDownload = z.object({ attributes: z.string(), url: z.url(), size: z.number().int().positive() });
const AcgAsset = z.object({
  id: z.string(),
  title: z.string().max(200),
  tags: z.array(z.string()).default([]),
  maps: z.array(z.string()).default([]),
  downloads: z.array(AcgDownload),
});
export type AcgAsset = z.infer<typeof AcgAsset>;
const AcgResponse = z.object({ assets: z.array(AcgAsset) });

export function assetUrl(id: string): string {
  return `${API_BASE}?id=${encodeURIComponent(id)}&include=title,tags,maps,downloads`;
}

/** Aset dengan id persis `id` dari respons API (pencarian API tidak peka huruf besar-kecil). */
export function parseAssetResponse(json: unknown, id: string): AcgAsset {
  const parsed = AcgResponse.safeParse(json);
  if (!parsed.success)
    throw new LibraryError("INVALID_RESPONSE", `Respons API untuk ${id} tidak sesuai skema`);
  const asset = parsed.data.assets.find((candidate) => candidate.id === id);
  if (asset === undefined)
    throw new LibraryError("INVALID_RESPONSE", `Material ${id} tidak ditemukan di ambientCG`);
  return asset;
}

export type Download = Readonly<{ url: string; size: number }>;

const RESOLUTION_ATTRIBUTE: Readonly<Record<MaterialResolution, string>> = { "1k": "1K-JPG", "2k": "2K-JPG" };

export function pickDownload(asset: AcgAsset, resolution: MaterialResolution): Download {
  const download = asset.downloads.find((entry) => entry.attributes === RESOLUTION_ATTRIBUTE[resolution]);
  if (download === undefined) {
    throw new LibraryError(
      "INVALID_RESPONSE",
      `${asset.id} tidak punya unduhan ${RESOLUTION_ATTRIBUTE[resolution]}`,
    );
  }
  assertAllowedUrl(download.url);
  if (download.size > MAX_ZIP_BYTES) {
    throw new LibraryError(
      "INVALID_RESPONSE",
      `${asset.id} ${resolution}: ZIP terlalu besar (${download.size} byte)`,
    );
  }
  return download;
}

export function assertAllowedUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new LibraryError("HOST_NOT_ALLOWED", `Host tidak diizinkan: ${parsed.hostname}`);
  }
}

/** Akhiran nama file ambientCG per map. NormalDX, Displacement, dan Opacity tidak dipakai. */
const MAP_SUFFIX: Readonly<Record<MaterialMap, string>> = {
  color: "Color",
  normal: "NormalGL",
  roughness: "Roughness",
  ao: "AmbientOcclusion",
  metalness: "Metalness",
};

function isJpeg(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/** Map yang dikenal dari ZIP ambientCG. Wajib ada `color` dan `normal`. */
export function extractMaps(
  zip: Uint8Array,
  id: string,
  resolution: MaterialResolution,
): Map<MaterialMap, Uint8Array> {
  const prefix = `${id}_${RESOLUTION_ATTRIBUTE[resolution]}_`;
  const wanted = new Map<string, MaterialMap>(
    Object.entries(MAP_SUFFIX).map(([map, suffix]) => [`${prefix}${suffix}.jpg`, map as MaterialMap]),
  );
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (file) => wanted.has(file.name) && file.originalSize <= MAX_MAP_BYTES,
    });
  } catch {
    throw new LibraryError("INVALID_ARCHIVE", `ZIP ${id} ${resolution} rusak`);
  }
  const maps = new Map<MaterialMap, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const map = wanted.get(name);
    if (map === undefined) continue;
    if (data.byteLength > MAX_MAP_BYTES || !isJpeg(data)) {
      throw new LibraryError("INVALID_ARCHIVE", `${name} bukan JPEG yang valid`);
    }
    maps.set(map, data);
  }
  for (const required of ["color", "normal"] as const) {
    if (!maps.has(required)) {
      throw new LibraryError("INVALID_ARCHIVE", `ZIP ${id} ${resolution} tidak berisi map ${required}`);
    }
  }
  return maps;
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const LockFile = z.object({ size: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
export const MaterialsLock = z.object({
  version: z.literal(1),
  materials: z.record(z.string(), z.object({ "1k": LockFile.optional(), "2k": LockFile.optional() })),
});
export type MaterialsLock = z.infer<typeof MaterialsLock>;

/**
 * Cek ZIP terhadap ukuran dari API dan lock. ZIP yang belum tercatat di lock dicatat (lock di-commit, jadi
 * unduhan berikutnya di mesin lain harus identik).
 */
export function verifyArchive(
  lock: MaterialsLock,
  id: string,
  resolution: MaterialResolution,
  expectedSize: number,
  zip: Uint8Array,
): MaterialsLock {
  if (zip.byteLength !== expectedSize) {
    throw new LibraryError(
      "CHECKSUM_MISMATCH",
      `${id} ${resolution}: ukuran ${zip.byteLength} byte, API menyebut ${expectedSize}`,
    );
  }
  const digest = sha256(zip);
  const recorded = lock.materials[id]?.[resolution];
  if (recorded !== undefined && (recorded.sha256 !== digest || recorded.size !== zip.byteLength)) {
    throw new LibraryError(
      "CHECKSUM_MISMATCH",
      `${id} ${resolution}: sha256 tidak sama dengan materials.lock.json`,
    );
  }
  return {
    ...lock,
    materials: {
      ...lock.materials,
      [id]: { ...lock.materials[id], [resolution]: { size: zip.byteLength, sha256: digest } },
    },
  };
}

/** Tag dari API dibersihkan: huruf kecil, tanpa angka-saja dan tanpa id material sendiri. */
export function cleanTags(asset: AcgAsset): string[] {
  const own = asset.id.toLowerCase();
  const tags = asset.tags
    .map((tag) => tag.toLowerCase().trim())
    .filter((tag) => /^[a-z][a-z0-9 -]{1,38}$/.test(tag) && tag !== own);
  return [...new Set(tags)].sort().slice(0, 40);
}

export function catalogEntry(
  entry: ListEntry,
  asset: AcgAsset,
  maps: readonly MaterialMap[],
  resolutions: readonly MaterialResolution[],
): CatalogMaterial {
  return {
    id: entry.id,
    name: asset.title,
    category: entry.category,
    tags: cleanTags(asset),
    maps: [...maps],
    resolutions: [...resolutions],
    license: "CC0-1.0",
    sourceUrl: `https://ambientcg.com/view?id=${encodeURIComponent(entry.id)}`,
  };
}

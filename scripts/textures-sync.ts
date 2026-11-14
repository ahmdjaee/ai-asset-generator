/**
 * `bun run textures:sync`: unduh pustaka material CC0 terkurasi dari ambientCG (butuh jaringan).
 * - Daftar: `runtime/materials.txt`; checksum ZIP: `runtime/materials.lock.json` (dicatat saat unduhan pertama).
 * - Hasil: `<DATA_DIR>/library/materials/<id>/{1k,2k}/<map>.jpg`, `preview.jpg`, dan `catalog.json`.
 * - Material yang sudah lengkap dilewati; `--force` mengunduh ulang semuanya.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { loadConfig } from "../server/config.ts";
import { RUNTIME_DIR } from "../server/runtime/image.ts";
import {
  type CatalogMaterial,
  MATERIAL_RESOLUTIONS,
  MaterialCatalog,
  type MaterialMap,
  type MaterialResolution,
} from "../shared/material-catalog.ts";
import {
  assertAllowedUrl,
  assetUrl,
  catalogEntry,
  extractMaps,
  type ListEntry,
  MAX_ZIP_BYTES,
  MaterialsLock,
  parseAssetResponse,
  parseMaterialList,
  pickDownload,
  USER_AGENT,
  verifyArchive,
} from "./textures/library.ts";

const FETCH_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 3;
const PREVIEW_PX = 256;
const LIST_PATH = join(RUNTIME_DIR, "materials.txt");
const LOCK_PATH = join(RUNTIME_DIR, "materials.lock.json");

async function fetchChecked(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertAllowedUrl(current);
    const response = await fetch(current, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} untuk ${current}`);
    return response;
  }
  throw new Error(`Terlalu banyak redirect: ${url}`);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetchChecked(url);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_ZIP_BYTES) throw new Error(`Unduhan terlalu besar: ${declared} byte`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAX_ZIP_BYTES) throw new Error(`Unduhan terlalu besar: ${data.byteLength} byte`);
  return data;
}

async function readLock(): Promise<MaterialsLock> {
  try {
    return MaterialsLock.parse(JSON.parse(await readFile(LOCK_PATH, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { version: 1, materials: {} };
    throw error;
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temp, path);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function readCatalog(path: string): Promise<Map<string, CatalogMaterial>> {
  try {
    const catalog = MaterialCatalog.parse(JSON.parse(await readFile(path, "utf8")));
    return new Map(catalog.materials.map((material) => [material.id, material]));
  } catch {
    return new Map();
  }
}

/** Material sudah lengkap bila semua map katalog ada di semua resolusi. */
async function isComplete(dir: string, material: CatalogMaterial | undefined): Promise<boolean> {
  if (material === undefined) return false;
  for (const resolution of material.resolutions) {
    for (const map of material.maps) {
      if (!(await exists(join(dir, resolution, `${map}.jpg`)))) return false;
    }
  }
  return exists(join(dir, "preview.jpg"));
}

async function syncOne(
  entry: ListEntry,
  root: string,
  lock: MaterialsLock,
): Promise<{ material: CatalogMaterial; lock: MaterialsLock }> {
  const asset = parseAssetResponse(await (await fetchChecked(assetUrl(entry.id))).json(), entry.id);
  const staging = join(root, `.staging-${entry.id}-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  let nextLock = lock;
  let maps: MaterialMap[] = [];
  try {
    for (const resolution of MATERIAL_RESOLUTIONS) {
      const target = pickDownload(asset, resolution);
      const zip = await download(target.url);
      nextLock = verifyArchive(nextLock, entry.id, resolution, target.size, zip);
      const extracted = extractMaps(zip, entry.id, resolution);
      await mkdir(join(staging, resolution), { recursive: true });
      for (const [map, data] of extracted) {
        // sharp memastikan file benar-benar bisa didekode sebelum dipakai Blender.
        const meta = await sharp(data).metadata();
        if ((meta.width ?? 0) < 256 || (meta.height ?? 0) < 256)
          throw new Error(`${entry.id} ${map}: ukuran aneh`);
        await writeFile(join(staging, resolution, `${map}.jpg`), data);
      }
      const names = [...extracted.keys()].sort();
      maps = maps.length === 0 ? names : maps.filter((map) => names.includes(map));
    }
    const color1k = await readFile(join(staging, "1k", "color.jpg"));
    await sharp(color1k)
      .resize(PREVIEW_PX, PREVIEW_PX)
      .jpeg({ quality: 82 })
      .toFile(join(staging, "preview.jpg"));
    const dir = join(root, entry.id);
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const resolutions: MaterialResolution[] = [...MATERIAL_RESOLUTIONS];
  return { material: catalogEntry(entry, asset, maps, resolutions), lock: nextLock };
}

async function main(): Promise<number> {
  const force = process.argv.includes("--force");
  const config = loadConfig();
  const root = join(config.dataDir, "library", "materials");
  await mkdir(root, { recursive: true });
  const entries = parseMaterialList(await readFile(LIST_PATH, "utf8"));
  const catalogPath = join(root, "catalog.json");
  const known = await readCatalog(catalogPath);
  let lock = await readLock();
  const materials: CatalogMaterial[] = [];
  const failures: string[] = [];

  for (const [index, entry] of entries.entries()) {
    const label = `[${index + 1}/${entries.length}] ${entry.id}`;
    const existing = known.get(entry.id);
    if (
      !force &&
      existing !== undefined &&
      existing.category === entry.category &&
      (await isComplete(join(root, entry.id), existing))
    ) {
      materials.push(existing);
      console.log(`${label}: sudah ada`);
      continue;
    }
    try {
      const result = await syncOne(entry, root, lock);
      lock = result.lock;
      materials.push(result.material);
      await writeJsonAtomic(LOCK_PATH, lock);
      console.log(`${label}: ${result.material.maps.join(", ")}`);
    } catch (error) {
      failures.push(entry.id);
      console.error(`${label}: GAGAL — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const catalog: MaterialCatalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "ambientCG",
    materials,
  };
  await writeJsonAtomic(catalogPath, MaterialCatalog.parse(catalog));
  console.log(`\nKatalog: ${materials.length} material → ${catalogPath}`);
  if (failures.length > 0) {
    console.error(`Gagal: ${failures.join(", ")}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await main());

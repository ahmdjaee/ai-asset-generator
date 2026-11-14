/** Perangkat tes tool `forge`: pustaka material kecil. Builder fixture ada di `fixture-builder.ts`. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { CatalogMaterial, MaterialCatalog } from "../../../shared/material-catalog.ts";
import { MaterialLibrary } from "../../library/materials.ts";

/** Pustaka material kecil untuk tes: tiga material + preview, di `dir`. */
export async function createTestLibrary(dir: string): Promise<MaterialLibrary> {
  const materials: CatalogMaterial[] = [
    ["Planks040", "wood", ["planks", "boards"]],
    ["Metal063", "metal", ["rust", "metal"]],
    ["Fabric086", "fabric", ["cloth"]],
  ].map(([id, category, tags]) => ({
    id: String(id),
    name: String(id),
    category: category as CatalogMaterial["category"],
    tags: tags as string[],
    maps: ["color", "normal", "roughness"],
    resolutions: ["1k", "2k"],
    license: "CC0-1.0",
    sourceUrl: `https://ambientcg.com/view?id=${String(id)}`,
  }));
  await mkdir(dir, { recursive: true });
  for (const material of materials) {
    await mkdir(join(dir, material.id), { recursive: true });
    await sharp({ create: { width: 32, height: 32, channels: 3, background: "#7a5230" } })
      .jpeg()
      .toFile(join(dir, material.id, "preview.jpg"));
  }
  const catalog: MaterialCatalog = {
    version: 1,
    generatedAt: "2026-11-13T00:00:00.000Z",
    source: "ambientCG",
    materials,
  };
  await writeFile(join(dir, "catalog.json"), JSON.stringify(catalog));
  return new MaterialLibrary(dir);
}

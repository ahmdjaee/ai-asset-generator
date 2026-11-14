import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { CatalogMaterial, MaterialCatalog } from "../../shared/material-catalog.ts";
import { MaterialLibrary, searchCatalog } from "./materials.ts";

function material(id: string, category: CatalogMaterial["category"], tags: string[]): CatalogMaterial {
  return {
    id,
    name: id.replace(/(\d+)/, " $1"),
    category,
    tags,
    maps: ["color", "normal"],
    resolutions: ["1k", "2k"],
    license: "CC0-1.0",
    sourceUrl: `https://ambientcg.com/view?id=${id}`,
  };
}

const MATERIALS = [
  material("Planks040", "wood", ["boards", "floor", "planks"]),
  material("Wood051", "wood", ["natural", "wood"]),
  material("Metal063", "metal", ["rust", "metal"]),
  material("Metal048A", "metal", ["gold", "shiny"]),
  material("Fabric086", "fabric", ["cloth", "red"]),
];

describe("searchCatalog", () => {
  test("kata kueri dicocokkan ke tag, nama, dan kategori; skor tertinggi dulu", () => {
    expect(searchCatalog(MATERIALS, { query: "rusty metal" }).map((m) => m.id)).toEqual([
      "Metal063",
      "Metal048A",
    ]);
    expect(searchCatalog(MATERIALS, { query: "wood planks" }).map((m) => m.id)).toEqual([
      "Planks040",
      "Wood051",
    ]);
  });

  test("filter kategori dan kueri kosong = semua dalam kategori", () => {
    expect(searchCatalog(MATERIALS, { category: "metal" }).map((m) => m.id)).toEqual([
      "Metal048A",
      "Metal063",
    ]);
  });

  test("tanpa kecocokan → kosong; limit dibatasi 1..12", () => {
    expect(searchCatalog(MATERIALS, { query: "marmer" })).toEqual([]);
    expect(searchCatalog(MATERIALS, { limit: 2 })).toHaveLength(2);
    expect(searchCatalog(MATERIALS, { limit: 999 })).toHaveLength(5);
  });
});

describe("MaterialLibrary", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "aag-lib-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("tanpa catalog.json → null", async () => {
    expect(await new MaterialLibrary(join(dir, "kosong")).catalog()).toBeNull();
  });

  test("katalog dibaca + lembar contoh 4 kolom berlabel", async () => {
    const catalog: MaterialCatalog = {
      version: 1,
      generatedAt: "2026-11-13T00:00:00.000Z",
      source: "ambientCG",
      materials: MATERIALS,
    };
    await writeFile(join(dir, "catalog.json"), JSON.stringify(catalog));
    await mkdir(join(dir, "Planks040"));
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "#a0522d" } })
      .jpeg()
      .toFile(join(dir, "Planks040", "preview.jpg"));
    const library = new MaterialLibrary(dir);
    expect((await library.catalog())?.materials).toHaveLength(5);
    const png = await library.swatches(MATERIALS);
    const meta = await sharp(png ?? new Uint8Array()).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(2 * 182);
    expect(await library.swatches([])).toBeNull();
  });

  test("katalog rusak → error zod", async () => {
    const bad = await mkdtemp(join(tmpdir(), "aag-lib-bad-"));
    await writeFile(join(bad, "catalog.json"), JSON.stringify({ version: 2 }));
    await expect(new MaterialLibrary(bad).catalog()).rejects.toThrow();
    await rm(bad, { recursive: true, force: true });
  });
});

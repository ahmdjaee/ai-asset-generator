import { describe, expect, test } from "bun:test";
import type { AssetStats } from "../../../shared/asset-stats.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { budgetMeters, optimizationSummary, statRows, versionItems } from "./detail.ts";

const MINUTE = 60_000;

function stats(patch: Partial<AssetStats> = {}): AssetStats {
  return {
    triangles: 3388,
    vertices: 1954,
    materials: 0,
    drawCalls: 1,
    textures: [],
    bbox: { min: [-0.325, 0, -0.22], max: [0.325, 0.53, 0.22], size: [0.65, 0.53, 0.44] },
    bytes: 200_000,
    ...patch,
  };
}

const base = {
  n: 1,
  stage: "base" as const,
  stats: stats(),
  files: [
    { name: "base.glb", bytes: 1_900_000 },
    { name: "web.glb", bytes: 412_000 },
  ],
  createdAt: 0,
  optimize: {
    steps: ["dedup", "flatten+join+weld", "simplify", "prune"],
    simplified: { from: 13_840, to: 11_402 },
  },
};

describe("panel Detail dari versi", () => {
  test("meter seperti desain layar 02: segitiga / target, ukuran web.glb / maks", () => {
    expect(budgetMeters(stats(), 164_000, DEFAULT_TIERS.sedang)).toEqual([
      { label: "Segitiga", valueText: "3.388 / 8.000", ratio: 3388 / 8000 },
      { label: "Ukuran web.glb", valueText: "164 KB / 1,5 MB", ratio: 164_000 / 1_500_000 },
    ]);
  });

  test("lewat target = warning, lewat maks = danger (… / … maks)", () => {
    const [triangles, size] = budgetMeters(stats({ triangles: 10_900 }), 1_700_000, DEFAULT_TIERS.sedang);
    expect(triangles).toEqual({
      label: "Segitiga",
      valueText: "10.900 / 12.000 maks",
      ratio: 10_900 / 12_000,
      tone: "warning",
    });
    expect(size).toEqual({
      label: "Ukuran web.glb",
      valueText: "1,7 MB / 1,5 MB maks",
      ratio: 1_700_000 / 1_500_000,
      tone: "danger",
    });
    expect(budgetMeters(stats(), null, DEFAULT_TIERS.sedang)).toHaveLength(1);
  });

  test("baris statistik: material baru ada di aset final; dimensi lebar × dalam × tinggi", () => {
    expect(statRows(base)).toEqual([
      { label: "Vertex", value: "1.954" },
      { label: "Material", value: "Belum ada (tahap 2)" },
      { label: "Dimensi", value: "0,65 × 0,44 × 0,53 m" },
    ]);
    expect(statRows({ ...base, stage: "textured", stats: stats({ materials: 2 }) })[1]).toEqual({
      label: "Material",
      value: "2 material",
    });
  });

  test("daftar versi: judul per tahap, waktu relatif + segitiga", () => {
    const final = {
      ...base,
      n: 2,
      stage: "textured" as const,
      createdAt: 3 * MINUTE,
      stats: stats({ triangles: 7940 }),
    };
    expect(versionItems([base, final], 5 * MINUTE)).toEqual([
      { version: 1, title: "v1 · Bentuk dasar", meta: "5 mnt lalu · 3.388 segitiga" },
      { version: 2, title: "v2 · Aset final", meta: "2 mnt lalu · 7.940 segitiga" },
    ]);
  });

  test("daftar versi dengan thumbnail: URL thumbnail per versi; tanpa URL selama gambarnya belum dibuat", () => {
    const final = { ...base, n: 2, stage: "textured" as const };
    const items = versionItems([base, final], 5 * MINUTE, (version) =>
      version.n === 1 ? `/thumb/${version.n}` : undefined,
    );
    expect(items.map((item) => item.thumbnail)).toEqual(["/thumb/1", undefined]);
    expect(items[0]).toEqual({
      version: 1,
      title: "v1 · Bentuk dasar",
      meta: "5 mnt lalu · 3.388 segitiga",
      thumbnail: "/thumb/1",
    });
    expect("thumbnail" in (items[1] ?? {})).toBe(false);
  });

  test("Optimasi hanya untuk aset final: review bentuk dasar tanpa Optimasi (layar 02)", () => {
    expect(optimizationSummary(base)).toBeNull();
  });

  test("Optimasi seperti komponen FigCraft #4112: sebelum → sesudah, langkah + kompres meshopt", () => {
    const final = {
      ...base,
      stage: "textured" as const,
      files: [
        { name: "final.glb", bytes: 1_900_000 },
        { name: "web.glb", bytes: 412_000 },
      ],
    };
    expect(optimizationSummary(final)).toEqual({
      size: "1,9 MB → 412 KB",
      triangles: "13.840 → 11.402",
      steps: "Hapus duplikat · gabung mesh · sederhanakan · bersihkan · kompres meshopt",
    });
  });

  test("aset final: perkecil tekstur ditulis sekali, tekstur WebP; tanpa simplify satu angka", () => {
    const textured = {
      ...base,
      stage: "textured" as const,
      stats: stats({
        triangles: 7940,
        textures: [{ slot: "baseColor" as const, width: 1024, height: 1024, mimeType: "image/png" }],
      }),
      files: [
        { name: "final.glb", bytes: 5_200_000 },
        { name: "web.glb", bytes: 780_000 },
      ],
      optimize: {
        steps: ["dedup", "flatten+join+weld", "prune", "resize.baseColor", "resize.normal", "langkah-baru"],
        simplified: null,
      },
    };
    expect(optimizationSummary(textured)).toEqual({
      size: "5,2 MB → 780 KB",
      triangles: "7.940",
      steps:
        "Hapus duplikat · gabung mesh · bersihkan · perkecil tekstur · langkah-baru · tekstur WebP · kompres meshopt",
    });
    expect(optimizationSummary({ ...textured, optimize: null })).toBeNull();
  });
});

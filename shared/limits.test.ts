import { describe, expect, test } from "bun:test";
import type { AssetStats } from "./asset-stats.ts";
import { bakeSizes, checkBudget, DEFAULT_TIERS, texturedJobLimits } from "./limits.ts";

function stats(overrides: Partial<AssetStats> = {}): AssetStats {
  return {
    triangles: 1000,
    vertices: 600,
    materials: 1,
    drawCalls: 1,
    textures: [],
    bbox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
    bytes: 10_000,
    ...overrides,
  };
}

describe("checkBudget", () => {
  test("di bawah target → ok", () => {
    const result = checkBudget(stats(), DEFAULT_TIERS.ringan);
    expect(result.ok).toBe(true);
    expect(result.items.map((entry) => entry.status)).toEqual(["ok", "ok"]);
  });

  test.each([
    [2000, "ok", 0],
    [2001, "over_target", 0],
    [3000, "over_target", 0],
    [3001, "over_max", 1],
    [4500, "over_max", 1500],
  ])("segitiga %i di Ringan → %s, lewat %i", (triangles, status, overMax) => {
    const result = checkBudget(stats({ triangles }), DEFAULT_TIERS.ringan);
    expect(result.items[0]).toMatchObject({ key: "triangles", status, overMax, max: 3000, target: 2000 });
    expect(result.ok).toBe(status !== "over_max");
  });

  test("material lebih dari batas", () => {
    const result = checkBudget(stats({ materials: 3 }), DEFAULT_TIERS.sedang);
    expect(result.items[1]).toMatchObject({ key: "materials", status: "over_max", overMax: 1 });
    expect(result.ok).toBe(false);
  });

  test("tekstur diukur dari sisi terpanjang per slot", () => {
    const result = checkBudget(
      stats({
        textures: [
          { slot: "baseColor", width: 1024, height: 512, mimeType: "image/webp" },
          { slot: "orm", width: 1024, height: 1024, mimeType: "image/webp" },
        ],
      }),
      DEFAULT_TIERS.sedang,
    );
    expect(result.items.slice(2)).toEqual([
      { key: "texture.baseColor", value: 1024, target: null, max: 1024, status: "ok", overMax: 0 },
      { key: "texture.orm", value: 1024, target: null, max: 512, status: "over_max", overMax: 512 },
    ]);
  });

  test("slot yang tidak diizinkan tier selalu lewat", () => {
    const result = checkBudget(
      stats({ textures: [{ slot: "normal", width: 256, height: 256, mimeType: "image/webp" }] }),
      DEFAULT_TIERS.ringan,
    );
    expect(result.items[2]).toMatchObject({ key: "texture.normal", max: 0, status: "over_max" });
  });

  test("ukuran web.glb hanya diperiksa bila diberikan", () => {
    expect(checkBudget(stats(), DEFAULT_TIERS.ringan).items.some((entry) => entry.key === "webBytes")).toBe(
      false,
    );
    const result = checkBudget(stats(), DEFAULT_TIERS.ringan, 200_000);
    expect(result.items.at(-1)).toMatchObject({ key: "webBytes", status: "over_target", target: 150_000 });
  });

  test("angka tier sesuai Lampiran D", () => {
    expect(DEFAULT_TIERS.sedang.triangles).toEqual({ target: 8000, max: 12_000 });
    expect(DEFAULT_TIERS.maksimal.webBytes).toEqual({ target: 3_000_000, max: 5_000_000 });
    expect(DEFAULT_TIERS.maksimal.textures).toEqual({
      baseColor: 2048,
      normal: 2048,
      orm: 1024,
      emissive: 1024,
    });
  });
});

describe("bakeSizes & texturedJobLimits", () => {
  test("ukuran bake = slot tekstur tier; pustaka 2K hanya untuk Maksimal", () => {
    expect(bakeSizes(DEFAULT_TIERS.ringan)).toEqual({ baseColor: 512, library: "1k" });
    expect(bakeSizes(DEFAULT_TIERS.sedang)).toEqual({
      baseColor: 1024,
      normal: 1024,
      orm: 512,
      library: "1k",
    });
    expect(bakeSizes(DEFAULT_TIERS.maksimal)).toEqual({
      baseColor: 2048,
      normal: 2048,
      orm: 1024,
      library: "2k",
    });
  });

  test("Maksimal 600 dtk, tier lain 300 dtk, RAM 2,5 GB", () => {
    expect(texturedJobLimits(DEFAULT_TIERS.maksimal).timeoutMs).toBe(600_000);
    expect(texturedJobLimits(DEFAULT_TIERS.sedang).timeoutMs).toBe(300_000);
    expect(texturedJobLimits(DEFAULT_TIERS.ringan).memoryBytes).toBe(2560 * 1024 * 1024);
    // Budget yang diubah di Pengaturan: batas job mengikuti isi budget, bukan nama tier.
    const ringanBesar = { ...DEFAULT_TIERS.ringan, textures: { baseColor: 2048 } };
    expect(texturedJobLimits(ringanBesar).timeoutMs).toBe(600_000);
    const sedangPadat = { ...DEFAULT_TIERS.sedang, triangles: { target: 20_000, max: 30_000 } };
    expect(texturedJobLimits(sedangPadat).timeoutMs).toBe(600_000);
  });
});

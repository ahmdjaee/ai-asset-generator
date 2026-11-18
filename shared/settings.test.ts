import { describe, expect, test } from "bun:test";
import { DEFAULT_TIERS } from "./limits.ts";
import { AppSettings, DEFAULT_SETTINGS, EditableTierBudget } from "./settings.ts";

describe("EditableTierBudget", () => {
  test("semua tier bawaan lolos", () => {
    for (const tier of Object.values(DEFAULT_TIERS))
      expect(EditableTierBudget.safeParse(tier).success).toBe(true);
    expect(AppSettings.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  test.each([
    ["target di atas maks", { triangles: { target: 3000, max: 2000 } }],
    ["segitiga di atas batas aman", { triangles: { target: 2000, max: 60_000 } }],
    ["segitiga terlalu sedikit", { triangles: { target: 50, max: 80 } }],
    ["material nol", { materials: 0 }],
    ["material di atas batas", { materials: 4 }],
    ["ukuran tekstur aneh", { textures: { baseColor: 700 } }],
    ["tekstur 4K", { textures: { baseColor: 4096 } }],
    ["tanpa atlas warna", { textures: { normal: 512 } }],
    ["slot tak dikenal", { textures: { baseColor: 512, other: 512 } }],
    ["web.glb di atas batas", { webBytes: { target: 1_000_000, max: 6_000_000 } }],
    ["angka pecahan", { materials: 1.5 }],
  ])("ditolak: %s", (_label, patch) => {
    expect(EditableTierBudget.safeParse({ ...DEFAULT_TIERS.ringan, ...patch }).success).toBe(false);
  });

  test("model: id dan alias dari supportedModels() lolos, teks bebas ditolak", () => {
    for (const model of ["claude-opus-5-5", "opus", "sonnet[1m]"])
      expect(AppSettings.safeParse({ ...DEFAULT_SETTINGS, model }).success).toBe(true);
    for (const model of ["", "model dengan spasi", "x".repeat(65)])
      expect(AppSettings.safeParse({ ...DEFAULT_SETTINGS, model }).success).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_TIERS, TIER_IDS } from "../../shared/limits.ts";
import { readGlb, writeGlb } from "./io.ts";
import { processGlb } from "./process.ts";
import { documentStats } from "./stats.ts";
import { gridDocument, invalidDocument, multiMaterialDocument, texturedDocument } from "./test-documents.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/glb");
const BlenderStats = z.object({
  triangles: z.number(),
  bbox: z.object({ size: z.tuple([z.number(), z.number(), z.number()]) }),
});

async function fixture(name: string) {
  const glb = new Uint8Array(await readFile(join(FIXTURES, `${name}.glb`)));
  const blender = BlenderStats.parse(
    JSON.parse(await readFile(join(FIXTURES, `${name}.stats.json`), "utf8")),
  );
  return { glb, blender };
}

function extensionsUsed(json: Awaited<ReturnType<typeof readGlb>>): string[] {
  return json
    .getRoot()
    .listExtensionsUsed()
    .map((extension) => extension.extensionName);
}

describe("processGlb pada fixture Tahap 1", () => {
  for (const name of ["peti", "kursi", "laras"]) {
    for (const tierId of TIER_IDS) {
      test(`${name} / ${tierId}: 0 error validator, statistik cocok dengan Blender, meshopt bisa dibaca ulang`, async () => {
        const { glb, blender } = await fixture(name);
        const result = await processGlb(glb, { tierId, stage: "base" });

        expect(result.validation.errors).toBe(0);
        expect(result.stats.triangles).toBe(blender.triangles);
        expect(result.stats.materials).toBe(0);
        expect(result.stats.textures).toEqual([]);
        // Blender Z-up (x, y, z) → glTF Y-up (x, z, y); origin di dasar.
        const [x, y, z] = blender.bbox.size;
        expect(result.stats.bbox.size[0]).toBeCloseTo(x, 4);
        expect(result.stats.bbox.size[1]).toBeCloseTo(z, 4);
        expect(result.stats.bbox.size[2]).toBeCloseTo(y, 4);
        expect(result.stats.bbox.min[1]).toBeCloseTo(0, 5);
        expect(result.stats.drawCalls).toBe(1);

        expect(result.web).not.toBeNull();
        const web = await readGlb(result.web ?? new Uint8Array());
        expect(extensionsUsed(web)).toContain("EXT_meshopt_compression");
        const decoded = documentStats(web, result.web?.byteLength ?? 0);
        expect(decoded.triangles).toBe(result.stats.triangles);
        for (const axis of [0, 1, 2]) {
          expect(decoded.bbox.size[axis]).toBeCloseTo(result.stats.bbox.size[axis] ?? 0, 2);
        }
        expect(result.web?.byteLength ?? 0).toBeLessThan(result.glb.byteLength);

        expect(result.budget.ok).toBe(true);
        expect(result.budget.items[0]).toMatchObject({ key: "triangles", value: blender.triangles });
        expect(extensionsUsed(await readGlb(result.glb))).toEqual([]);
      });
    }
  }
});

describe("simplify bentuk dasar", () => {
  test("sedikit lewat batas (3.528 > 3.000 Ringan) → disederhanakan ke bawah batas", async () => {
    const input = await writeGlb(gridDocument(42));
    const result = await processGlb(input, { tierId: "ringan", stage: "base" });
    expect(result.optimize.simplified?.from).toBe(3528);
    expect(result.stats.triangles).toBeLessThanOrEqual(3000);
    expect(result.budget.ok).toBe(true);
    expect(result.validation.errors).toBe(0);
  });

  test("jauh lewat batas → tidak disederhanakan, budget melaporkan kelebihan", async () => {
    const input = await writeGlb(gridDocument(50));
    const result = await processGlb(input, { tierId: "ringan", stage: "base" });
    expect(result.optimize.simplified).toBeNull();
    expect(result.budget.ok).toBe(false);
    expect(result.budget.items[0]).toMatchObject({
      key: "triangles",
      value: 5000,
      status: "over_max",
      overMax: 2000,
    });
  });

  test("aset final tidak pernah disederhanakan otomatis", async () => {
    const input = await writeGlb(gridDocument(42));
    const result = await processGlb(input, { tierId: "ringan", stage: "textured" });
    expect(result.optimize.simplified).toBeNull();
    expect(result.stats.triangles).toBe(3528);
  });
});

describe("tekstur dan material", () => {
  test("Sedang: tekstur diperkecil per slot, Web memakai WebP, ukuran web.glb masuk budget", async () => {
    const input = await writeGlb(await texturedDocument(2048));
    const result = await processGlb(input, { tierId: "sedang", stage: "textured" });
    expect(result.validation.errors).toBe(0);
    const bySlot = Object.fromEntries(result.stats.textures.map((texture) => [texture.slot, texture]));
    expect(bySlot.baseColor).toMatchObject({ width: 1024, height: 1024, mimeType: "image/png" });
    expect(bySlot.normal).toMatchObject({ width: 1024, height: 1024 });
    expect(bySlot.orm).toMatchObject({ width: 512, height: 512 });
    expect(result.budget.ok).toBe(true);
    expect(result.budget.items.some((item) => item.key === "webBytes")).toBe(true);

    const web = await readGlb(result.web ?? new Uint8Array());
    expect(
      web
        .getRoot()
        .listTextures()
        .map((texture) => texture.getMimeType()),
    ).toEqual(["image/webp", "image/webp", "image/webp"]);
    expect(extensionsUsed(web)).toEqual(
      expect.arrayContaining(["EXT_meshopt_compression", "EXT_texture_webp", "KHR_mesh_quantization"]),
    );
  });

  test("Ringan: tekstur normal dan ORM dibuang (slot tidak diizinkan), baseColor 512", async () => {
    const input = await writeGlb(await texturedDocument(1024));
    const result = await processGlb(input, { tierId: "ringan", stage: "textured" });
    expect(result.optimize.steps).toContain("drop-slots");
    expect(result.stats.textures).toEqual([
      { slot: "baseColor", width: 512, height: 512, mimeType: "image/png" },
    ]);
    expect(result.budget.ok).toBe(true);
  });

  test("tekstur yang sudah kecil tidak diperbesar", async () => {
    const input = await writeGlb(await texturedDocument(256));
    const result = await processGlb(input, { tierId: "maksimal", stage: "textured" });
    expect(result.stats.textures.every((texture) => texture.width === 256)).toBe(true);
  });

  test("Ringan: material warna polos digabung jadi satu material berpalet", async () => {
    const input = await writeGlb(multiMaterialDocument());
    const result = await processGlb(input, { tierId: "ringan", stage: "textured" });
    expect(result.optimize.steps).toContain("palette");
    expect(result.stats.materials).toBe(1);
    expect(result.stats.drawCalls).toBe(1);
    expect(result.validation.errors).toBe(0);
  });

  test("Sedang: palet tidak dijalankan", async () => {
    const input = await writeGlb(multiMaterialDocument());
    const result = await processGlb(input, { tierId: "sedang", stage: "textured" });
    expect(result.optimize.steps).not.toContain("palette");
    expect(result.stats.materials).toBe(3);
    expect(result.budget.items[1]).toMatchObject({ key: "materials", status: "over_max", overMax: 1 });
  });
});

describe("validasi dan pembatalan", () => {
  test("GLB rusak: error validator dilaporkan dan tidak dikompresi", async () => {
    const input = await writeGlb(invalidDocument());
    const result = await processGlb(input, { tierId: "sedang", stage: "base" });
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors).toBeGreaterThan(0);
    expect(result.validation.messages[0]?.severity).toBe(0);
    expect(result.web).toBeNull();
  });

  test("signal yang sudah dibatalkan menghentikan pipeline", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = await writeGlb(gridDocument(4));
    await expect(
      processGlb(input, { tierId: "sedang", stage: "base", signal: controller.signal }),
    ).rejects.toThrow();
  });

  test("snapshot budget aset dipakai, bukan budget tier saat ini", async () => {
    const input = await writeGlb(gridDocument(4));
    const tight = { ...DEFAULT_TIERS.sedang, triangles: { target: 10, max: 20 } };
    const result = await processGlb(input, { tierId: "sedang", tier: tight, stage: "textured" });
    expect(result.budget.items[0]).toMatchObject({ value: 32, max: 20, status: "over_max" });
  });
});

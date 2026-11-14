import { describe, expect, test } from "bun:test";
import { documentStats } from "./stats.ts";
import { emptyDocument, gridDocument } from "./test-documents.ts";

/** Kode mode glTF untuk LINES (`Primitive.Mode.LINES` bertipe opsional di gltf-transform). */
const LINES = 1;

describe("documentStats", () => {
  test("grid 2×2: 8 segitiga, 9 vertex, bbox Y-up", () => {
    const stats = documentStats(gridDocument(2), 123);
    expect(stats).toMatchObject({
      triangles: 8,
      vertices: 9,
      materials: 0,
      drawCalls: 1,
      textures: [],
      bytes: 123,
    });
    expect(stats.bbox.size[0]).toBeCloseTo(1, 6);
    expect(stats.bbox.size[2]).toBeCloseTo(1, 6);
  });

  test("mesh yang dipakai dua node dihitung dua kali", () => {
    const document = gridDocument(1);
    const mesh = document.getRoot().listMeshes()[0] ?? null;
    document
      .getRoot()
      .listScenes()[0]
      ?.addChild(document.createNode("salinan").setMesh(mesh).setTranslation([2, 0, 0]));
    const stats = documentStats(document, 0);
    expect(stats).toMatchObject({ triangles: 4, drawCalls: 2 });
    expect(stats.bbox.size[0]).toBeCloseTo(3, 6);
  });

  test("primitive garis tidak dihitung sebagai segitiga", () => {
    const document = gridDocument(1);
    document.getRoot().listMeshes()[0]?.listPrimitives()[0]?.setMode(LINES);
    expect(documentStats(document, 0).triangles).toBe(0);
  });

  test("scene kosong: semua nol", () => {
    const document = emptyDocument();
    document.createScene("kosong");
    expect(documentStats(document, 0)).toMatchObject({
      triangles: 0,
      drawCalls: 0,
      bbox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
    });
  });
});

import { describe, expect, test } from "bun:test";
import { readGlb, writeGlb } from "./io.ts";
import { processGlb } from "./process.ts";
import { documentStats } from "./stats.ts";
import { gridDocument, texturedDocument } from "./test-documents.ts";
import { toUnityGlb, UNITY_BLOCKED_EXTENSIONS, UnityExportError } from "./unity.ts";

async function extensionsOf(glb: Uint8Array): Promise<string[]> {
  return (await readGlb(glb))
    .getRoot()
    .listExtensionsUsed()
    .map((extension) => extension.extensionName);
}

async function mimeTypesOf(glb: Uint8Array): Promise<string[]> {
  return (await readGlb(glb))
    .getRoot()
    .listTextures()
    .map((texture) => texture.getMimeType());
}

describe("toUnityGlb", () => {
  test("GLB versi (belum dikompresi) lolos apa adanya: 0 error, tekstur PNG, tanpa ekstensi kompresi", async () => {
    const processed = await processGlb(await writeGlb(await texturedDocument(256)), {
      tierId: "sedang",
      stage: "textured",
    });
    const unity = await toUnityGlb(processed.glb);
    expect(unity.validation.errors).toBe(0);
    expect(await mimeTypesOf(unity.glb)).toEqual(["image/png", "image/png", "image/png"]);
    expect((await extensionsOf(unity.glb)).filter((name) => UNITY_BLOCKED_EXTENSIONS.has(name))).toEqual([]);
    expect(documentStats(await readGlb(unity.glb), 0).triangles).toBe(processed.stats.triangles);
  });

  test("web.glb (meshopt + kuantisasi + WebP) dibuka: tanpa ekstensi kompresi, tekstur PNG, segitiga sama", async () => {
    const processed = await processGlb(await writeGlb(await texturedDocument(256)), {
      tierId: "sedang",
      stage: "textured",
    });
    const web = processed.web ?? new Uint8Array();
    expect(await extensionsOf(web)).toEqual(
      expect.arrayContaining(["EXT_meshopt_compression", "KHR_mesh_quantization", "EXT_texture_webp"]),
    );
    const unity = await toUnityGlb(web);
    expect(unity.validation.errors).toBe(0);
    expect((await extensionsOf(unity.glb)).filter((name) => UNITY_BLOCKED_EXTENSIONS.has(name))).toEqual([]);
    expect(await mimeTypesOf(unity.glb)).toEqual(["image/png", "image/png", "image/png"]);
    const stats = documentStats(await readGlb(unity.glb), 0);
    expect(stats.triangles).toBe(processed.stats.triangles);
    const size = (values: readonly number[]) => values.map((value) => Number(value.toFixed(3)));
    expect(size(stats.bbox.size)).toEqual(size(processed.stats.bbox.size));
  });

  test("bentuk dasar tanpa material dan tekstur tetap valid", async () => {
    const unity = await toUnityGlb(await writeGlb(gridDocument(3)));
    expect([unity.validation.errors, await mimeTypesOf(unity.glb)]).toEqual([0, []]);
  });

  test("tekstur KTX2 ditolak dengan error bertipe", async () => {
    const document = gridDocument(2, (doc) =>
      doc.createMaterial("ktx").setBaseColorTexture(
        doc
          .createTexture("ktx")
          .setImage(new Uint8Array([1, 2, 3]))
          .setMimeType("image/ktx2"),
      ),
    );
    await expect(toUnityGlb(await writeGlb(document))).rejects.toBeInstanceOf(UnityExportError);
  });
});

/**
 * Statistik dokumen glTF. Segitiga dan vertex dihitung per instance node (mesh yang dipakai dua node = dua kali
 * draw), karena itulah yang dirender engine.
 */
import { type Document, Primitive } from "@gltf-transform/core";
import { getBounds, getGLPrimitiveCount, listTextureSlots } from "@gltf-transform/functions";
import type { AssetStats, TextureSlot } from "../../shared/asset-stats.ts";

const SLOT_BY_NAME: Readonly<Record<string, TextureSlot>> = {
  baseColorTexture: "baseColor",
  normalTexture: "normal",
  occlusionTexture: "orm",
  metallicRoughnessTexture: "orm",
  emissiveTexture: "emissive",
};

function triangleCount(primitive: Primitive): number {
  const mode = primitive.getMode();
  const isTriangles =
    mode === Primitive.Mode.TRIANGLES ||
    mode === Primitive.Mode.TRIANGLE_STRIP ||
    mode === Primitive.Mode.TRIANGLE_FAN;
  return isTriangles ? getGLPrimitiveCount(primitive) : 0;
}

function textureSlot(slots: readonly string[]): TextureSlot {
  const mapped = new Set(slots.map((slot) => SLOT_BY_NAME[slot] ?? "other"));
  const [only] = mapped;
  return mapped.size === 1 && only !== undefined ? only : "other";
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function documentStats(document: Document, bytes: number): AssetStats {
  const root = document.getRoot();
  let triangles = 0;
  let vertices = 0;
  let drawCalls = 0;
  const materials = new Set<unknown>();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  scene?.traverse((node) => {
    const mesh = node.getMesh();
    if (mesh === null) return;
    for (const primitive of mesh.listPrimitives()) {
      drawCalls += 1;
      triangles += triangleCount(primitive);
      vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const material = primitive.getMaterial();
      if (material !== null) materials.add(material);
    }
  });

  const textures = root.listTextures().map((texture) => {
    const [width, height] = texture.getSize() ?? [0, 0];
    return { slot: textureSlot(listTextureSlots(texture)), width, height, mimeType: texture.getMimeType() };
  });

  const bounds = scene === undefined || drawCalls === 0 ? null : getBounds(scene);
  const min = bounds ? bounds.min.map(round) : [0, 0, 0];
  const max = bounds ? bounds.max.map(round) : [0, 0, 0];
  const size = min.map((value, axis) => round((max[axis] ?? 0) - value));

  return {
    triangles,
    vertices,
    materials: materials.size,
    drawCalls,
    textures,
    bbox: {
      min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0],
      max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0],
      size: [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0],
    },
    bytes,
  };
}

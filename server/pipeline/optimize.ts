/**
 * Optimasi GLB per tier (PLAN Lampiran E). Urutan:
 * 1. dedup; 2. palet (khusus Ringan); 3. flatten, join, weld; 4. simplify (khusus bentuk dasar, bila sedikit lewat);
 * 5. buang tekstur di slot yang tidak diizinkan tier (mis. normal/ORM di Ringan); 6. prune;
 * 7. resize tekstur per slot sesuai tier.
 * Kompresi untuk preset Web (meshopt + WebP) ada di `compressForWeb` dan dijalankan SETELAH validasi.
 */
import type { Document } from "@gltf-transform/core";
import {
  cloneDocument,
  dedup,
  flatten,
  join,
  meshopt,
  palette,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import type { TextureSlot } from "../../shared/asset-stats.ts";
import {
  SIMPLIFY_MAX_ERROR,
  SIMPLIFY_MAX_OVERSHOOT,
  type TierBudget,
  type TierId,
} from "../../shared/limits.ts";
import { documentStats } from "./stats.ts";

export type AssetStage = "base" | "textured";

export type OptimizeOptions = Readonly<{
  tierId: TierId;
  tier: TierBudget;
  stage: AssetStage;
  signal?: AbortSignal;
}>;

export type OptimizeReport = Readonly<{
  /** Langkah yang benar-benar dijalankan, untuk log dan laporan. */
  steps: readonly string[];
  /** Diisi bila simplify otomatis dijalankan. */
  simplified: Readonly<{ from: number; to: number }> | null;
}>;

/** Pola nama slot gltf-transform per slot budget. */
const SLOT_PATTERNS: ReadonlyArray<readonly [Exclude<TextureSlot, "other">, RegExp]> = [
  ["baseColor", /^baseColorTexture$/],
  ["normal", /^normalTexture$/],
  ["orm", /^(occlusionTexture|metallicRoughnessTexture)$/],
  ["emissive", /^emissiveTexture$/],
];

function triangles(document: Document): number {
  return documentStats(document, 0).triangles;
}

/** Mengoptimasi dokumen di tempat (dokumen diubah). */
export async function optimizeDocument(
  document: Document,
  options: OptimizeOptions,
): Promise<OptimizeReport> {
  const steps: string[] = [];
  const step = async (name: string, ...transforms: Parameters<Document["transform"]>): Promise<void> => {
    options.signal?.throwIfAborted();
    await document.transform(...transforms);
    steps.push(name);
  };

  await step("dedup", dedup());
  if (options.tierId === "ringan" && document.getRoot().listMaterials().length > 1) {
    // Material warna polos digabung menjadi satu material + tekstur palet → 1 draw call.
    await step("palette", palette({ min: 2 }));
  }
  await step("flatten+join+weld", flatten(), join(), weld());

  let simplified: OptimizeReport["simplified"] = null;
  const before = triangles(document);
  const { max } = options.tier.triangles;
  if (options.stage === "base" && before > max && before <= max * SIMPLIFY_MAX_OVERSHOOT) {
    await MeshoptSimplifier.ready;
    // Target sedikit di bawah maks karena rasio simplify berlaku untuk vertex, bukan segitiga.
    const ratio = (max * 0.95) / before;
    await step("simplify", simplify({ simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_MAX_ERROR }));
    simplified = { from: before, to: triangles(document) };
  }

  if (dropDisallowedSlots(document, options.tier) > 0) steps.push("drop-slots");
  await step("prune", prune());

  if (document.getRoot().listTextures().length > 0) {
    for (const [slot, pattern] of SLOT_PATTERNS) {
      const limit = options.tier.textures[slot];
      if (limit === undefined) continue;
      await step(
        `resize.${slot}`,
        textureCompress({ encoder: sharp, resize: [limit, limit], slots: pattern }),
      );
    }
  }
  return { steps, simplified };
}

/** Melepas tekstur di slot yang tidak punya batas di tier. Hasil: jumlah tautan yang dilepas (prune membuang sisanya). */
function dropDisallowedSlots(document: Document, tier: TierBudget): number {
  let dropped = 0;
  for (const material of document.getRoot().listMaterials()) {
    if (tier.textures.normal === undefined && material.getNormalTexture() !== null) {
      material.setNormalTexture(null);
      dropped += 1;
    }
    if (tier.textures.orm === undefined) {
      if (material.getOcclusionTexture() !== null) {
        material.setOcclusionTexture(null);
        dropped += 1;
      }
      if (material.getMetallicRoughnessTexture() !== null) {
        material.setMetallicRoughnessTexture(null);
        dropped += 1;
      }
    }
    if (tier.textures.emissive === undefined && material.getEmissiveTexture() !== null) {
      material.setEmissiveTexture(null);
      dropped += 1;
    }
  }
  return dropped;
}

/** Preset Web: salinan dokumen → tekstur WebP → meshopt (dengan quantization). Dokumen asli tidak diubah. */
export async function compressForWeb(document: Document, signal?: AbortSignal): Promise<Document> {
  const web = cloneDocument(document);
  signal?.throwIfAborted();
  if (web.getRoot().listTextures().length > 0) {
    await web.transform(textureCompress({ encoder: sharp, targetFormat: "webp" }));
  }
  signal?.throwIfAborted();
  await MeshoptEncoder.ready;
  await web.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  return web;
}

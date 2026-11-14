/**
 * Preset ekspor Unity (glTFast tanpa paket tambahan): GLB tanpa ekstensi kompresi dan tekstur PNG/JPEG.
 * Sumbernya GLB versi yang sudah lolos validator (`base.glb`/`final.glb`, belum dikompresi), jadi biasanya tidak ada
 * yang berubah. Aturannya tetap berlaku untuk GLB apa pun: tekstur WebP/AVIF diubah ke PNG, geometri meshopt dan
 * terkuantisasi dibuka. Hasilnya divalidasi ulang dan wajib 0 error.
 */
import { dequantize, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";
import { readGlb, writeGlb } from "./io.ts";
import { type ValidationResult, validateGlb } from "./validate.ts";

/** Ekstensi yang butuh dekoder tambahan di Unity (meshopt, Draco, KTX2, WebP/AVIF) atau kuantisasi. */
export const UNITY_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "EXT_meshopt_compression",
  "KHR_draco_mesh_compression",
  "KHR_mesh_quantization",
  "KHR_texture_basisu",
  "EXT_texture_webp",
  "EXT_texture_avif",
]);

const UNITY_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg"]);

export class UnityExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnityExportError";
  }
}

export type UnityExport = Readonly<{ glb: Uint8Array; validation: ValidationResult }>;

export async function toUnityGlb(input: Uint8Array): Promise<UnityExport> {
  const document = await readGlb(input);
  const root = document.getRoot();
  if (root.listTextures().some((texture) => texture.getMimeType() === "image/ktx2")) {
    throw new UnityExportError("Tekstur KTX2 tidak bisa diubah ke PNG.");
  }
  if (root.listTextures().some((texture) => !UNITY_IMAGE_TYPES.has(texture.getMimeType()))) {
    await document.transform(
      textureCompress({ encoder: sharp, targetFormat: "png", formats: /^image\/(webp|avif)$/ }),
    );
  }
  const used = () => root.listExtensionsUsed().map((extension) => extension.extensionName);
  if (used().includes("KHR_mesh_quantization")) await document.transform(dequantize());
  for (const extension of root.listExtensionsUsed()) {
    if (UNITY_BLOCKED_EXTENSIONS.has(extension.extensionName)) extension.dispose();
  }

  const glb = await writeGlb(document);
  const validation = await validateGlb(glb);
  if (!validation.ok) {
    throw new UnityExportError(`GLB Unity tidak lolos validator (${validation.errors} error).`);
  }
  const written = (await readGlb(glb)).getRoot();
  const leftover = written
    .listExtensionsUsed()
    .filter((extension) => UNITY_BLOCKED_EXTENSIONS.has(extension.extensionName));
  const images = written.listTextures().filter((texture) => !UNITY_IMAGE_TYPES.has(texture.getMimeType()));
  if (leftover.length > 0 || images.length > 0) {
    throw new UnityExportError("GLB Unity masih memakai ekstensi kompresi atau tekstur selain PNG/JPEG.");
  }
  return { glb, validation };
}

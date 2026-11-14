/**
 * Tag image runtime = hash isi file yang membentuk image. `assetkit` tidak ikut di-hash karena dipasang read-only
 * saat job berjalan, jadi mengubah helper tidak perlu build ulang image.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { imageExists, RuntimeError } from "./docker.ts";

export const RUNTIME_DIR = join(import.meta.dir, "../../runtime");
export const ASSETKIT_DIR = join(RUNTIME_DIR, "assetkit");
export const IMAGE_NAME = "asset-forge";
const IMAGE_INPUTS = ["Dockerfile", "requirements.txt"] as const;

export async function runtimeImageTag(runtimeDir: string = RUNTIME_DIR): Promise<string> {
  const hash = createHash("sha256");
  for (const file of IMAGE_INPUTS) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(runtimeDir, file)));
    hash.update("\0");
  }
  return `${IMAGE_NAME}:${hash.digest("hex").slice(0, 12)}`;
}

/** Tag image runtime yang sudah dibangun; gagal dengan pesan jelas bila belum ada. */
export async function requireRuntimeImage(): Promise<string> {
  const tag = await runtimeImageTag();
  if (!(await imageExists(tag))) {
    throw new RuntimeError(
      "DOCKER_FAILED",
      `Image ${tag} belum ada. Jalankan \`bun run runtime:build\` dulu.`,
    );
  }
  return tag;
}

/** Referensi assetkit dan cookbook untuk Claude (dibaca lewat Read, hanya baca). */
export const KNOWLEDGE_DIR = join(RUNTIME_DIR, "knowledge");

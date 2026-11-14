/**
 * Pembanding golden image: pixelmatch threshold 0,1, maksimal 1% piksel berbeda.
 * Golden hanya ditulis bila `UPDATE_GOLDENS=1`. Saat gagal, gambar aktual dan diff disimpan di
 * `.tmp/goldens-diff/<suite>/`. Dipakai dari Bun (`test:pipeline`) dan Node (Playwright), jadi path memakai
 * `import.meta.url`, bukan `import.meta.dir` yang hanya ada di Bun.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import sharp from "sharp";

const GOLDENS_ROOT = fileURLToPath(new URL("../goldens/", import.meta.url));
const DIFF_ROOT = fileURLToPath(new URL("../../.tmp/goldens-diff/", import.meta.url));
export const GOLDEN_THRESHOLD = 0.1;
export const GOLDEN_MAX_DIFF_RATIO = 0.01;

export type Raw = { data: Uint8Array; width: number; height: number };

export async function decodePng(png: Uint8Array): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** Rasio piksel berbeda antara dua gambar mentah berukuran sama. */
export function diffRatio(a: Raw, b: Raw, diff?: Uint8Array): number {
  const changed = pixelmatch(a.data, b.data, diff, a.width, a.height, { threshold: GOLDEN_THRESHOLD });
  return changed / (a.width * a.height);
}

export type GoldenResult = { updated: boolean; ratio: number };

export type GoldenSuite = Readonly<{
  /** Subfolder di `tests/goldens/`. */
  dir: string;
  /** Perintah yang menulis ulang golden suite ini (untuk pesan error). */
  updateCommand: string;
}>;

export const RENDER_GOLDENS: GoldenSuite = { dir: "render", updateCommand: "bun run test:pipeline" };

export async function compareGolden(
  name: string,
  png: Uint8Array,
  suite: GoldenSuite = RENDER_GOLDENS,
): Promise<GoldenResult> {
  const goldenDir = join(GOLDENS_ROOT, suite.dir);
  const diffDir = join(DIFF_ROOT, suite.dir);
  const goldenPath = join(goldenDir, `${name}.png`);
  if (process.env.UPDATE_GOLDENS === "1") {
    await mkdir(goldenDir, { recursive: true });
    await writeFile(goldenPath, png);
    return { updated: true, ratio: 0 };
  }
  let golden: Uint8Array;
  try {
    golden = new Uint8Array(await readFile(goldenPath));
  } catch {
    throw new Error(`Golden ${name}.png belum ada; buat dengan UPDATE_GOLDENS=1 ${suite.updateCommand}`);
  }
  const [actual, expected] = await Promise.all([decodePng(png), decodePng(golden)]);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `Ukuran ${name} berbeda: ${actual.width}×${actual.height} vs golden ${expected.width}×${expected.height}`,
    );
  }
  const diff = new Uint8Array(actual.data.length);
  const ratio = diffRatio(actual, expected, diff);
  if (ratio > GOLDEN_MAX_DIFF_RATIO) {
    await mkdir(diffDir, { recursive: true });
    await writeFile(join(diffDir, `${name}.actual.png`), png);
    await sharp(diff, { raw: { width: actual.width, height: actual.height, channels: 4 } })
      .png()
      .toFile(join(diffDir, `${name}.diff.png`));
  }
  return { updated: false, ratio };
}

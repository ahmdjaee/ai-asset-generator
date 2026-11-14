/** Folder kerja job di host (dipasang ke `/job`). Isinya dihapus setelah output dibaca. */
import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";

export const JOB_OUTPUT_DIR = "out";

export type JobDir = { path: string; outputDir: string };

/** Nama file tambahan yang boleh disalin ke folder job (mis. skrip bentuk dasar untuk build bertekstur). */
const EXTRA_FILE = /^[a-z][a-z0-9_-]{0,31}\.py$/;

/**
 * Membuat folder job unik di bawah `root`, berisi `out/`, (bila ada) salinan skrip sebagai `script.py`, dan
 * salinan file tambahan `extras` (`{ "base.py": path }`).
 */
export async function createJobDir(
  root: string,
  scriptPath?: string,
  extras: Readonly<Record<string, string>> = {},
): Promise<JobDir> {
  for (const name of Object.keys(extras)) {
    if (!EXTRA_FILE.test(name) || name === "script.py") throw new Error(`Nama file job tidak valid: ${name}`);
  }
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(await realpath(root), "job-"));
  const outputDir = join(path, JOB_OUTPUT_DIR);
  await mkdir(outputDir);
  if (scriptPath !== undefined) await copyFile(scriptPath, join(path, "script.py"));
  for (const [name, source] of Object.entries(extras)) await copyFile(source, join(path, name));
  return { path, outputDir };
}

/** Menghapus folder job. Menolak path di luar `root` supaya salah panggil tidak menghapus apa pun yang lain. */
export async function removeJobDir(root: string, dir: JobDir): Promise<void> {
  const base = await realpath(root);
  if (!dir.path.startsWith(`${base}${sep}job-`)) {
    throw new Error(`Menolak menghapus folder di luar ${base}: ${dir.path}`);
  }
  await rm(dir.path, { recursive: true, force: true });
}

/** File `.blend` hasil job (preset ekspor Sumber); disimpan harness setelah GLB, tidak wajib ada. */
export const BLEND_OUTPUT = "scene.blend";

/** Perintah job bentuk dasar: skrip → finalize → GLB tanpa material + statistik + `.blend` (tugas harness). */
export const BASE_JOB_COMMAND = [
  "python",
  "-m",
  "assetkit.run",
  "/job/script.py",
  "--export",
  `/job/${JOB_OUTPUT_DIR}/base.glb`,
  "--stats",
  `/job/${JOB_OUTPUT_DIR}/stats.json`,
  "--blend",
  `/job/${JOB_OUTPUT_DIR}/${BLEND_OUTPUT}`,
] as const;

/** Ukuran bake atlas per tier: dari slot tekstur budget. Tier tanpa normal/ORM tidak mem-bake map itu. */
export type TextureSizes = Readonly<{
  baseColor: number;
  normal?: number;
  orm?: number;
  /** Resolusi tekstur pustaka material yang dimuat skrip. */
  library: "1k" | "2k";
}>;

/**
 * Perintah job bertekstur: skrip → finalize → bake atlas (warna, normal, ORM sesuai tier) → GLB dengan material
 * → `.blend`.
 * Resolusi pustaka ditentukan harness (`--library-res`), bukan oleh skrip.
 */
export function texturedJobCommand(sizes: TextureSizes): string[] {
  return [
    "python",
    "-m",
    "assetkit.run",
    "/job/script.py",
    "--textured",
    "--base-color",
    String(sizes.baseColor),
    ...(sizes.normal === undefined ? [] : ["--normal", String(sizes.normal)]),
    ...(sizes.orm === undefined ? [] : ["--orm", String(sizes.orm)]),
    "--library-res",
    sizes.library,
    "--export",
    `/job/${JOB_OUTPUT_DIR}/final.glb`,
    "--stats",
    `/job/${JOB_OUTPUT_DIR}/stats.json`,
    "--blend",
    `/job/${JOB_OUTPUT_DIR}/${BLEND_OUTPUT}`,
  ];
}

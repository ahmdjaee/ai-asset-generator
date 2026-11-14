/**
 * Versi aset write-once (AGENTS.md §3):
 * 1. semua file ditulis ke folder staging `versions/.staging-*`;
 * 2. tiap file dibuat read-only, `manifest.json` mencatat sha256 per file;
 * 3. staging di-rename atomik menjadi `versions/vN`, lalu foldernya dibuat read-only.
 * Hasil turunan (render ulang, ekspor) ditulis ke `derived/vN/`, tidak pernah ke `versions/`.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_DIR = /^v([1-9][0-9]{0,5})$/;
const MANIFEST = "manifest.json";
const READ_ONLY_FILE = 0o444;
const READ_ONLY_DIR = 0o555;
/** Percobaan ulang bila nomor versi direbut proses lain di antara baca dan rename. */
const MAX_RENAME_ATTEMPTS = 5;

export class VersionError extends Error {
  readonly code:
    | "INVALID_FILE_NAME"
    | "DUPLICATE_FILE"
    | "NO_FILES"
    | "VERSION_NOT_FOUND"
    | "VERSION_CONFLICT";

  constructor(code: VersionError["code"], message: string) {
    super(message);
    this.name = "VersionError";
    this.code = code;
  }
}

export const VersionManifest = z.object({
  version: z.number().int().positive(),
  createdAt: z.string(),
  files: z.array(z.object({ name: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string() })),
  meta: z.record(z.string(), z.unknown()),
});
export type VersionManifest = z.infer<typeof VersionManifest>;

export type VersionFile = Readonly<{ name: string; data: Uint8Array | string }>;

export type CreateVersionOptions = Readonly<{
  /** Folder aset: `data/assets/<id>`. */
  assetDir: string;
  files: readonly VersionFile[];
  meta?: Record<string, unknown>;
  now?: () => Date;
}>;

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function assertFileName(name: string): void {
  if (!FILE_NAME.test(name) || name === MANIFEST || name.includes("..")) {
    throw new VersionError("INVALID_FILE_NAME", `Nama file versi tidak valid: ${name}`);
  }
}

function versionsDir(assetDir: string): string {
  return join(assetDir, "versions");
}

/** Nomor versi yang sudah ada, urut naik. */
export async function listVersions(assetDir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(versionsDir(assetDir));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => VERSION_DIR.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

export function versionDir(assetDir: string, version: number): string {
  return join(versionsDir(assetDir), `v${version}`);
}

function isTakenError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOTEMPTY" || error.code === "EEXIST");
}

export async function createVersion(options: CreateVersionOptions): Promise<VersionManifest> {
  if (options.files.length === 0) throw new VersionError("NO_FILES", "Versi harus berisi minimal satu file");
  const names = new Set<string>();
  for (const file of options.files) {
    assertFileName(file.name);
    if (names.has(file.name)) throw new VersionError("DUPLICATE_FILE", `File ganda di versi: ${file.name}`);
    names.add(file.name);
  }

  const root = versionsDir(options.assetDir);
  await mkdir(root, { recursive: true });
  const staging = join(root, `.staging-${randomBytes(6).toString("hex")}`);
  await mkdir(staging);
  try {
    for (const file of options.files) {
      const path = join(staging, file.name);
      await writeFile(path, file.data, { flag: "wx" });
      await chmod(path, READ_ONLY_FILE);
    }
    const createdAt = (options.now ?? (() => new Date()))().toISOString();
    const files = options.files.map((file) => ({
      name: file.name,
      bytes: typeof file.data === "string" ? Buffer.byteLength(file.data) : file.data.byteLength,
      sha256: sha256(file.data),
    }));

    for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt++) {
      const version = ((await listVersions(options.assetDir)).at(-1) ?? 0) + 1;
      const manifest: VersionManifest = { version, createdAt, files, meta: options.meta ?? {} };
      const manifestPath = join(staging, MANIFEST);
      await chmod(manifestPath, 0o644).catch(() => undefined);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await chmod(manifestPath, READ_ONLY_FILE);
      const target = versionDir(options.assetDir, version);
      try {
        // rename(2) gagal bila `vN` sudah ada dan berisi (manifest selalu ada), jadi versi lama tidak tertimpa.
        await rename(staging, target);
      } catch (error) {
        if (isTakenError(error)) continue;
        throw error;
      }
      await chmod(target, READ_ONLY_DIR);
      return manifest;
    }
    throw new VersionError("VERSION_CONFLICT", "Nomor versi terus direbut proses lain");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function readManifest(assetDir: string, version: number): Promise<VersionManifest> {
  let raw: string;
  try {
    raw = await readFile(join(versionDir(assetDir, version), MANIFEST), "utf8");
  } catch {
    throw new VersionError("VERSION_NOT_FOUND", `Versi v${version} tidak ditemukan`);
  }
  return VersionManifest.parse(JSON.parse(raw));
}

/** Membandingkan isi file dengan sha256 di manifest. */
export async function verifyVersion(
  assetDir: string,
  version: number,
): Promise<{ ok: boolean; mismatched: string[] }> {
  const manifest = await readManifest(assetDir, version);
  const mismatched: string[] = [];
  for (const file of manifest.files) {
    const data = await readFile(join(versionDir(assetDir, version), file.name)).catch(() => null);
    if (data === null || sha256(data) !== file.sha256) mismatched.push(file.name);
  }
  return { ok: mismatched.length === 0, mismatched };
}

/**
 * Menulis file turunan versi secara atomik (file sementara di folder yang sama → rename). `data` boleh berupa
 * potongan async (mis. ZIP yang di-stream); bila gagal di tengah, file sementara dibuang.
 */
export async function writeDerived(
  assetDir: string,
  version: number,
  name: string,
  data: Uint8Array | string | AsyncIterable<Uint8Array>,
): Promise<string> {
  assertFileName(name);
  if (!(await listVersions(assetDir)).includes(version)) {
    throw new VersionError("VERSION_NOT_FOUND", `Versi v${version} tidak ditemukan`);
  }
  const dir = join(assetDir, "derived", `v${version}`);
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const temp = join(dir, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(temp, data, { flag: "wx" });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return target;
}

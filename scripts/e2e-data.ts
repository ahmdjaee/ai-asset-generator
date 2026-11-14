/**
 * Menyiapkan folder data server E2E Playwright (dipanggil `webServer` di `playwright.config.ts`):
 * 1. folder lama dihapus. Folder versi aset read-only (write-once, 0555), jadi izin tulis folder dikembalikan dulu;
 * 2. pustaka material uji dipasang (sama dengan `e2e:api`), supaya tahap tekstur skenario palsu bisa berjalan.
 *
 * Pemakaian: `bun scripts/e2e-data.ts <folder data>`
 */
import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createTestLibrary } from "../server/agent/forge/test-builder.ts";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Izin tulis untuk semua folder di bawah `path` (symlink tidak diikuti; file cukup foldernya yang bisa ditulis). */
async function makeWritable(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory()) return;
  await chmod(path, 0o755);
  for (const name of await readdir(path)) await makeWritable(join(path, name));
}

const dataDir = process.argv[2];
if (dataDir === undefined || dataDir === "") {
  console.error("Pemakaian: bun scripts/e2e-data.ts <folder data>");
  process.exit(1);
}
try {
  await makeWritable(dataDir);
} catch (error) {
  if (!isMissing(error)) throw error;
}
await rm(dataDir, { recursive: true, force: true });
await createTestLibrary(join(dataDir, "library", "materials"));

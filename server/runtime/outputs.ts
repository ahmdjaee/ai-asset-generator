/**
 * Membaca output container yang tidak dipercaya (AGENTS.md §7):
 * `lstat` (symlink tidak diikuti), hanya file biasa, nama di-allowlist, ukuran dibatasi, tanpa hardlink.
 */
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export type AcceptedOutput = { name: string; path: string; bytes: number };
export type RejectedOutput = {
  name: string;
  reason: "symlink" | "not_file" | "not_allowed" | "too_large" | "hardlink";
};
export type OutputScan = { accepted: AcceptedOutput[]; rejected: RejectedOutput[] };

/** `allowed`: nama file → ukuran maksimum (byte). Folder yang tidak ada dianggap kosong. */
export async function collectOutputs(
  dir: string,
  allowed: Readonly<Record<string, number>>,
): Promise<OutputScan> {
  const accepted: AcceptedOutput[] = [];
  const rejected: RejectedOutput[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { accepted, rejected };
    throw error;
  }
  for (const name of names.sort()) {
    const path = join(dir, name);
    const info = await lstat(path);
    const limit = Object.hasOwn(allowed, name) ? allowed[name] : undefined;
    if (info.isSymbolicLink()) rejected.push({ name, reason: "symlink" });
    else if (!info.isFile()) rejected.push({ name, reason: "not_file" });
    else if (limit === undefined) rejected.push({ name, reason: "not_allowed" });
    else if (info.nlink > 1) rejected.push({ name, reason: "hardlink" });
    else if (info.size > limit) rejected.push({ name, reason: "too_large" });
    else accepted.push({ name, path, bytes: info.size });
  }
  return { accepted, rejected };
}

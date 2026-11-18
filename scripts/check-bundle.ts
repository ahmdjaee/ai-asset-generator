/**
 * Pemeriksaan build produksi (Tahap 12), dijalankan otomatis setelah `bun run build`:
 * - halaman uji (`/_smoke`, `/_komponen`, `/_viewer`) dan test hook viewer tidak ikut ke build produksi;
 * - three.js hanya ada di chunk viewer yang di-lazy-load, bukan di chunk awal;
 * - chunk awal (script di `index.html`) di bawah anggaran gzip.
 * Pemakaian: `bun scripts/check-bundle.ts [folder dist]`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** Anggaran gzip chunk awal. Sekarang ±231 kB; batas memberi ruang tumbuh tanpa membiarkan viewer ikut masuk. */
export const ENTRY_GZIP_BUDGET_BYTES = 300 * 1024;

/** Penanda kode yang hanya boleh ada di mode dev/tes. */
const TEST_ONLY_MARKERS = ["/_smoke", "_komponen", "/_viewer", "__viewer", "SmokePage"] as const;
/** Kelas inti three.js: bila muncul di chunk awal, viewer tidak lagi di-lazy-load. */
const THREE_MARKER = "WebGLRenderer";

export type BundleFile = Readonly<{ name: string; text: string }>;

export function entryScript(indexHtml: string): string | null {
  return /<script[^>]*type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(indexHtml)?.[1] ?? null;
}

/** Daftar masalah build; kosong = lolos. */
export function bundleProblems(indexHtml: string, files: readonly BundleFile[]): string[] {
  const problems: string[] = [];
  for (const file of [{ name: "index.html", text: indexHtml }, ...files]) {
    for (const marker of TEST_ONLY_MARKERS) {
      if (file.text.includes(marker)) problems.push(`${file.name} memuat kode khusus tes (${marker})`);
    }
  }
  const entryName = entryScript(indexHtml);
  const entry = files.find((file) => file.name === entryName);
  if (entry === undefined) return [...problems, "script awal di index.html tidak ditemukan"];
  if (entry.text.includes(THREE_MARKER))
    problems.push(`${entry.name} memuat three.js (viewer tidak di-lazy-load)`);
  if (!files.some((file) => file.name !== entry.name && file.text.includes(THREE_MARKER))) {
    problems.push("chunk viewer (three.js) tidak ditemukan");
  }
  const gzipBytes = gzipSync(entry.text).byteLength;
  if (gzipBytes > ENTRY_GZIP_BUDGET_BYTES) {
    problems.push(
      `${entry.name} ${Math.round(gzipBytes / 1024)} kB gzip, melewati anggaran ${ENTRY_GZIP_BUDGET_BYTES / 1024} kB`,
    );
  }
  return problems;
}

async function main(dist: string): Promise<void> {
  const assets = join(dist, "assets");
  const names = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  const files = await Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(assets, name), "utf8") })),
  );
  const problems = bundleProblems(await readFile(join(dist, "index.html"), "utf8"), files);
  if (problems.length > 0) {
    console.error(`Build produksi tidak lolos pemeriksaan:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    "✓ Build produksi: tanpa kode khusus tes, viewer di chunk terpisah, chunk awal dalam anggaran.",
  );
}

if (import.meta.main) await main(process.argv[2] ?? "dist");

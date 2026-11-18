import { describe, expect, test } from "bun:test";
import { bundleProblems, ENTRY_GZIP_BUDGET_BYTES, entryScript } from "./check-bundle.ts";

/** mulberry32: deret acak deterministik. */
function noiseText(length: number, seed: number): string {
  let state = seed;
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    chars.push(String.fromCharCode(33 + (((value ^ (value >>> 14)) >>> 0) % 90)));
  }
  return chars.join("");
}

const html = '<script type="module" crossorigin src="/assets/index-a1.js"></script>';
const viewer = { name: "Viewer-b2.js", text: "class WebGLRenderer{}" };

describe("pemeriksaan build produksi", () => {
  test("build bersih lolos", () => {
    expect(entryScript(html)).toBe("index-a1.js");
    expect(bundleProblems(html, [{ name: "index-a1.js", text: "app" }, viewer])).toEqual([]);
  });

  test("kode khusus tes, three.js di chunk awal, dan chunk awal kebesaran ditolak", () => {
    const leaked = bundleProblems(html, [{ name: "index-a1.js", text: 'path:"/_smoke" WebGLRenderer' }]);
    expect(leaked).toContain("index-a1.js memuat kode khusus tes (/_smoke)");
    expect(leaked).toContain("index-a1.js memuat three.js (viewer tidak di-lazy-load)");
    expect(leaked).toContain("chunk viewer (three.js) tidak ditemukan");
    // Isi acak (PRNG ber-seed) hampir tidak bisa dimampatkan: gzip-nya tetap di atas anggaran.
    const noise = noiseText(ENTRY_GZIP_BUDGET_BYTES * 2, 42);
    expect(bundleProblems(html, [{ name: "index-a1.js", text: noise }, viewer])[0]).toMatch(
      /melewati anggaran/,
    );
    expect(bundleProblems("<html></html>", [viewer])).toEqual(["script awal di index.html tidak ditemukan"]);
  });
});

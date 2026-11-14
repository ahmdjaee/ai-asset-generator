import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { assertZipPath, fileChunks, type ZipEntry, ZipPathError, zipStream } from "./zip-stream.ts";

const MTIME = Date.UTC(2026, 10, 14, 10, 0, 0);

async function* listOf(entries: readonly ZipEntry[]): AsyncIterable<ZipEntry> {
  for (const entry of entries) yield entry;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("zipStream", () => {
  test("teks dideflate, file dari disk disimpan apa adanya; isi dan folder utuh setelah dibuka", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aag-zip-"));
    try {
      const big = new Uint8Array(3 * 1024 * 1024).map((_, index) => (index * 7) % 251);
      await writeFile(join(dir, "besar.bin"), big);
      const zip = await collect(
        zipStream(
          listOf([
            { name: "peti/README.md", content: "# Peti\n".repeat(200), compress: true, mtime: MTIME },
            {
              name: "peti/scene.blend",
              content: fileChunks(join(dir, "besar.bin")),
              compress: false,
              mtime: MTIME,
            },
            {
              name: "peti/textures/warna.png",
              content: new Uint8Array([1, 2, 3]),
              compress: false,
              mtime: 0,
            },
          ]),
          (error) => {
            throw error;
          },
        ),
      );
      const files = unzipSync(zip);
      expect(Object.keys(files)).toEqual(["peti/README.md", "peti/scene.blend", "peti/textures/warna.png"]);
      expect(strFromU8(files["peti/README.md"] ?? new Uint8Array())).toBe("# Peti\n".repeat(200));
      expect(files["peti/scene.blend"]).toEqual(big);
      expect(files["peti/textures/warna.png"]).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("backpressure: entri berikutnya baru dibaca setelah klien mengambil data; batal → berhenti", async () => {
    let produced = 0;
    async function* lazy(): AsyncIterable<ZipEntry> {
      for (let index = 0; index < 8; index++) {
        produced += 1;
        yield { name: `f${index}.bin`, content: new Uint8Array(512 * 1024), compress: false, mtime: MTIME };
      }
    }
    // Semua isi ada di memori, jadi penulis hanya berjalan lewat microtask: satu giliran event loop cukup untuk
    // menghabiskan kedelapan entri bila tidak ada backpressure.
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
    const stream = zipStream(lazy(), () => undefined);
    await turn();
    expect(produced).toBeLessThanOrEqual(3);
    const reader = stream.getReader();
    const before = produced;
    for (let index = 0; index < 4; index++) await reader.read();
    await turn();
    expect(produced).toBeGreaterThan(before);
    await reader.cancel();
    const cancelledAt = produced;
    await turn();
    expect(produced).toBe(cancelledAt);
  });

  test("nama entri tidak aman memutus stream dengan ZipPathError", async () => {
    const errors: unknown[] = [];
    const stream = zipStream(
      listOf([{ name: "../luar.txt", content: "x", compress: true, mtime: MTIME }]),
      (error) => errors.push(error),
    );
    await expect(collect(stream)).rejects.toBeInstanceOf(ZipPathError);
    expect(errors).toHaveLength(1);
  });

  test("file yang hilang saat gilirannya dibaca memutus stream dan dilaporkan", async () => {
    const errors: unknown[] = [];
    const stream = zipStream(
      listOf([
        { name: "a.txt", content: "x", compress: true, mtime: MTIME },
        {
          name: "b.glb",
          content: fileChunks(join(tmpdir(), "aag-zip-tidak-ada", "b.glb")),
          compress: false,
          mtime: MTIME,
        },
      ]),
      (error) => errors.push(error),
    );
    await expect(collect(stream)).rejects.toMatchObject({ code: "ENOENT" });
    expect(errors).toHaveLength(1);
  });
});

describe("assertZipPath", () => {
  test("path relatif biasa lolos; traversal, absolut, backslash, drive, dan kendali ditolak", () => {
    for (const ok of ["a.glb", "peti-v1-sumber/textures/warna.png", "ōkami/刀.glb"]) {
      expect(() => assertZipPath(ok)).not.toThrow();
    }
    for (const bad of [
      "",
      "/etc/passwd",
      "../x",
      "a/../../x",
      "a\\b",
      "C:x",
      "a//b",
      "./a",
      "a/",
      "a\u0000b",
      "x".repeat(256),
    ]) {
      expect(() => assertZipPath(bad)).toThrow(ZipPathError);
    }
  });
});

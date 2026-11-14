import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  ATTACHMENT_CLAUDE_MAX_PX,
  ATTACHMENT_DECAL_MAX_PX,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
} from "../../shared/limits.ts";
import { detectFileType, prepareUploads, sanitizeFileName, writeAttachmentFiles } from "./attachments.ts";
import { ServiceError } from "./errors.ts";

const GLB = new Uint8Array(await readFile(join(import.meta.dir, "../../tests/fixtures/glb/peti.glb")));
const encoder = new TextEncoder();

/** Foto JPEG 3000×2000 dengan EXIF (termasuk teks yang tidak boleh ikut tersimpan). */
async function photo(): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#c08040" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "rahasia-pemilik", Artist: "kamera" } })
    .toBuffer();
  return new Uint8Array(buffer);
}

function binaryStl(triangles: number): Uint8Array {
  const bytes = new Uint8Array(84 + 50 * triangles);
  new DataView(bytes.buffer).setUint32(80, triangles, true);
  return bytes;
}

let ids = 0;
const nextId = () => `lampiran-${++ids}`;

async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ServiceError)) throw new Error(`bukan ServiceError: ${String(error)}`);
  return error.code;
}

describe("detectFileType (dari isi, bukan ekstensi)", () => {
  test.each([
    ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]],
    ["jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["webp", [...encoder.encode("RIFF"), 0, 0, 0, 0, ...encoder.encode("WEBPVP8 ")]],
    ["gif", [...encoder.encode("GIF89a"), 0]],
  ])("gambar %s", (format, bytes) => {
    expect(detectFileType(new Uint8Array(bytes))).toMatchObject({ kind: "image", format });
  });

  test("model: glb, glTF JSON, OBJ, FBX biner/ASCII, STL biner/ASCII", () => {
    expect(detectFileType(GLB)?.format).toBe("glb");
    expect(detectFileType(encoder.encode('\uFEFF  {"asset":{"version":"2.0"}}'))?.format).toBe("gltf");
    expect(detectFileType(encoder.encode("# kubus\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"))?.format).toBe(
      "obj",
    );
    expect(detectFileType(encoder.encode("Kaydara FBX Binary  \0\x1a\0"))?.format).toBe("fbx");
    expect(detectFileType(encoder.encode("; FBX 7.4.0 project file\n"))?.format).toBe("fbx");
    expect(detectFileType(binaryStl(2))?.format).toBe("stl");
    expect(detectFileType(encoder.encode("solid kubus\n facet normal 0 0 1\nendsolid\n"))?.format).toBe(
      "stl",
    );
  });

  test("tipe palsu dan tidak dikenal → null", () => {
    expect(detectFileType(encoder.encode("bukan gambar, hanya teks"))).toBeNull();
    expect(detectFileType(encoder.encode("%PDF-1.7\n"))).toBeNull();
    expect(detectFileType(new Uint8Array([0x4d, 0x5a, 0x90, 0]))).toBeNull();
    expect(detectFileType(new Uint8Array([]))).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  test.each([
    ["../../etc/passwd.png", "passwd.png"],
    ["C:\\Users\\x\\logo.png", "logo.png"],
    ["..hidden", "hidden"],
    ["a\u0000b\u202ec.png", "abc.png"],
    ["  <script>.png ", "script.png"],
    ["", "lampiran"],
    ["...", "lampiran"],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  test("dipotong 120 karakter", () => {
    expect(sanitizeFileName(`${"a".repeat(300)}.png`)).toHaveLength(120);
  });

  test("potongan tidak membelah emoji (teks tetap valid untuk Claude)", () => {
    const name = sanitizeFileName(`${"a".repeat(119)}😀.glb`);
    expect(name.isWellFormed()).toBe(true);
    expect(name).toBe(`${"a".repeat(119)}😀`);
  });
});

describe("prepareUploads", () => {
  test("gambar di-re-encode ke PNG tanpa metadata, dua ukuran (Claude dan decal)", async () => {
    const [prepared] = await prepareUploads([{ name: "foto kamera.jpg", bytes: await photo() }], nextId);
    if (prepared === undefined) throw new Error("tidak ada hasil");
    expect(prepared).toMatchObject({ kind: "image", name: "foto kamera.jpg", mime: "image/png" });
    expect(prepared.file).toBe(`${prepared.id}.png`);
    expect(prepared.decal).toBe(`${prepared.id}-decal.png`);
    const [claude, decal] = prepared.files;
    if (claude === undefined || decal === undefined) throw new Error("varian kurang");
    const claudeMeta = await sharp(claude.bytes).metadata();
    const decalMeta = await sharp(decal.bytes).metadata();
    expect([claudeMeta.format, claudeMeta.width, claudeMeta.height]).toEqual([
      "png",
      ATTACHMENT_CLAUDE_MAX_PX,
      1045,
    ]);
    expect([decalMeta.width, decalMeta.height]).toEqual([ATTACHMENT_DECAL_MAX_PX, 1365]);
    expect(claudeMeta.exif).toBeUndefined();
    expect(Buffer.from(claude.bytes).includes("rahasia-pemilik")).toBe(false);
    expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("gambar kecil tidak diperbesar", async () => {
    const small = new Uint8Array(
      await sharp({ create: { width: 64, height: 32, channels: 4, background: "#00000000" } })
        .png()
        .toBuffer(),
    );
    const [prepared] = await prepareUploads([{ name: "ikon.png", bytes: small }], nextId);
    const meta = await sharp(prepared?.files[0]?.bytes).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([64, 32, true]);
  });

  test("model disimpan apa adanya dengan ekstensi dari isi", async () => {
    const [glb, stl] = await prepareUploads(
      [
        { name: "model.bin", bytes: GLB },
        { name: "cetak.stl", bytes: binaryStl(1) },
      ],
      nextId,
    );
    expect(glb).toMatchObject({ kind: "model", mime: "model/gltf-binary", decal: null });
    expect(glb?.file.endsWith(".glb")).toBe(true);
    expect(glb?.files[0]?.bytes).toBe(GLB);
    expect(stl?.file.endsWith(".stl")).toBe(true);
  });

  test("tipe palsu (teks bernama .png) ditolak", async () => {
    expect(await rejection(prepareUploads([{ name: "x.png", bytes: encoder.encode("halo") }]))).toBe(
      "UNSUPPORTED_FILE",
    );
  });

  test("file kosong ditolak dengan pesan file kosong, bukan tipe tidak didukung", async () => {
    const empty = prepareUploads([{ name: "kosong.png", bytes: new Uint8Array(0) }]);
    const error = await empty.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code: "INVALID_FILE", message: "kosong.png: file kosong." });
  });

  test("gambar terlalu besar ditolak sebelum diproses", async () => {
    const big = new Uint8Array(ATTACHMENT_IMAGE_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await rejection(prepareUploads([{ name: "besar.png", bytes: big }]))).toBe("FILE_TOO_LARGE");
  });

  test("gambar rusak ditolak", async () => {
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(await rejection(prepareUploads([{ name: "rusak.png", bytes: broken }]))).toBe("INVALID_FILE");
  });

  test("glTF dengan file terpisah atau JSON rusak ditolak", async () => {
    const external = encoder.encode(
      '{"asset":{"version":"2.0"},"buffers":[{"uri":"model.bin","byteLength":4}]}',
    );
    const embedded = encoder.encode(
      '{"asset":{"version":"2.0"},"buffers":[{"uri":"data:application/octet-stream;base64,AAAA","byteLength":3}]}',
    );
    expect(await rejection(prepareUploads([{ name: "a.gltf", bytes: external }]))).toBe("UNSUPPORTED_FILE");
    expect(await rejection(prepareUploads([{ name: "b.gltf", bytes: encoder.encode("{rusak") }]))).toBe(
      "INVALID_FILE",
    );
    expect(await rejection(prepareUploads([{ name: "c.gltf", bytes: encoder.encode("{}") }]))).toBe(
      "UNSUPPORTED_FILE",
    );
    expect((await prepareUploads([{ name: "d.gltf", bytes: embedded }], nextId))[0]?.mime).toBe(
      "model/gltf+json",
    );
  });

  test(`lebih dari ${ATTACHMENT_MAX_FILES} file ditolak`, async () => {
    const files = Array.from({ length: ATTACHMENT_MAX_FILES + 1 }, (_, index) => ({
      name: `${index}.stl`,
      bytes: binaryStl(1),
    }));
    expect(await rejection(prepareUploads(files))).toBe("TOO_MANY_FILES");
  });
});

describe("writeAttachmentFiles", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aag-refs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("menulis semua varian tanpa file sementara tersisa", async () => {
    const prepared = await prepareUploads([{ name: "foto.jpg", bytes: await photo() }], nextId);
    const written = await writeAttachmentFiles(dir, prepared);
    expect(written).toHaveLength(2);
    const expected = [prepared[0]?.decal ?? "", prepared[0]?.file ?? ""].sort();
    expect((await readdir(dir)).sort()).toEqual(expected);
  });

  test("gagal di tengah → file yang sudah ditulis dibersihkan", async () => {
    const [first] = await prepareUploads([{ name: "a.stl", bytes: binaryStl(1) }], () => "sama");
    const [second] = await prepareUploads([{ name: "b.stl", bytes: binaryStl(1) }], () => "beda");
    if (first === undefined || second === undefined) throw new Error("tidak ada hasil");
    const clash = { ...second, files: [{ name: "../luar/x.stl", bytes: binaryStl(1) }] };
    await expect(writeAttachmentFiles(dir, [first, clash])).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

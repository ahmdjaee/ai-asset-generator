/**
 * Lampiran pemilik (PLAN Tahap 6). Unggahan divalidasi dan diproses di memori SEBELUM aset/pesan dibuat, lalu ditulis
 * atomik ke `refs/`. Tipe dicek dari isi (magic byte), bukan dari ekstensi atau `Content-Type` dari klien.
 * - Gambar (PNG/JPEG/WebP/GIF): di-re-encode sharp menjadi PNG tanpa metadata (EXIF/GPS dibuang, orientasi
 *   diterapkan dulu). `<id>.png` ≤1568 px untuk Claude (dibaca lewat Read), `<id>-decal.png` ≤2048 px untuk
 *   `decal.from_image` di container.
 * - Model 3D (glb/gltf/obj/fbx/stl): disimpan apa adanya; Claude tidak membacanya, skrip Blender bisa mengimpornya
 *   dari `/refs` (dipasang read-only di container).
 * Nama file di disk dibuat server dari id; nama asli hanya disimpan (disanitasi) untuk tampilan.
 */
import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { formatBytes } from "../../shared/format.ts";
import {
  ATTACHMENT_CLAUDE_MAX_PX,
  ATTACHMENT_DECAL_MAX_PX,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_IMAGE_MAX_PIXELS,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MODEL_MAX_BYTES,
  ATTACHMENT_NAME_MAX_CHARS,
  ATTACHMENT_TEXT_SNIFF_BYTES,
} from "../../shared/limits.ts";
import { truncate } from "../../shared/text.ts";
import { ServiceError } from "./errors.ts";

export type UploadFile = Readonly<{ name: string; bytes: Uint8Array }>;

export type AttachmentKind = "image" | "model";

export type DetectedType = Readonly<{
  kind: AttachmentKind;
  format: "png" | "jpeg" | "webp" | "gif" | "glb" | "gltf" | "obj" | "fbx" | "stl";
}>;

type StoredFile = Readonly<{ name: string; bytes: Uint8Array }>;

export type PreparedAttachment = Readonly<{
  id: string;
  kind: AttachmentKind;
  /** Nama asli (disanitasi). */
  name: string;
  /** File utama di `refs/` (gambar untuk Claude, atau model). */
  file: string;
  /** Varian decal (gambar saja). */
  decal: string | null;
  mime: string;
  /** Ukuran dan sha256 unggahan asli. */
  size: number;
  sha256: string;
  files: readonly StoredFile[];
}>;

const MODEL_MIME: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "model/obj",
  fbx: "application/octet-stream",
  stl: "model/stl",
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** Awal file sebagai teks (BOM dan spasi di depan dibuang), atau null bila ada byte NUL (bukan teks). */
function textHead(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, ATTACHMENT_TEXT_SNIFF_BYTES);
  if (head.includes(0)) return null;
  return new TextDecoder("utf-8").decode(head).replace(/^﻿/, "").trimStart();
}

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  return 84 + 50 * uint32le(bytes, 80) === bytes.length;
}

/** Jenis file dari isinya. `null` = tidak didukung. */
export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "image", format: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", format: "jpeg" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8))
    return { kind: "image", format: "webp" };
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a")))
    return { kind: "image", format: "gif" };
  if (startsWith(bytes, ascii("glTF")) && bytes.length >= 12 && uint32le(bytes, 4) === 2) {
    return { kind: "model", format: "glb" };
  }
  if (startsWith(bytes, ascii("Kaydara FBX Binary  \0"))) return { kind: "model", format: "fbx" };
  // STL biner bisa diawali "solid" juga, jadi ukurannya dicek lebih dulu.
  if (isBinaryStl(bytes)) return { kind: "model", format: "stl" };
  const text = textHead(bytes);
  if (text === null) return null;
  if (text.startsWith("{")) return { kind: "model", format: "gltf" };
  if (text.startsWith("; FBX")) return { kind: "model", format: "fbx" };
  if (/^solid\b/.test(text) && /\bfacet\b/.test(text)) return { kind: "model", format: "stl" };
  if (/^v\s+[-+\d.]/m.test(text) && /^(f|o|g|vn|vt|usemtl|mtllib)\s/m.test(text))
    return { kind: "model", format: "obj" };
  return null;
}

/** Nama file varian decal sebuah lampiran gambar di `refs/`. */
export function decalFileName(id: string): string {
  return `${id}-decal.png`;
}

/**
 * Nama asli untuk tampilan: tanpa folder, tanpa karakter kontrol, tanpa titik di depan, maks. 120 karakter
 * (per code point, supaya emoji tidak terbelah; nama ini ikut dikirim ke Claude).
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}<>:"|?*]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return truncate(clean === "" ? "lampiran" : clean, ATTACHMENT_NAME_MAX_CHARS);
}

function unsupported(name: string): ServiceError {
  return new ServiceError(
    "UNSUPPORTED_FILE",
    `${name}: tipe file tidak didukung. Pakai gambar PNG/JPEG/WebP/GIF atau model GLB/glTF/OBJ/FBX/STL.`,
  );
}

/** glTF JSON hanya diterima bila mandiri: buffer dan gambar di dalam file (data URI). */
function checkGltf(name: string, bytes: Uint8Array): void {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ServiceError("INVALID_FILE", `${name}: glTF tidak bisa dibaca (JSON rusak).`);
  }
  if (typeof json !== "object" || json === null || !("asset" in json)) throw unsupported(name);
  const external = ["buffers", "images"].some((key) => {
    const list: unknown = Reflect.get(json, key);
    return (
      Array.isArray(list) &&
      list.some((item: unknown) => {
        const uri: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "uri") : undefined;
        return typeof uri === "string" && !uri.startsWith("data:");
      })
    );
  });
  if (external) {
    throw new ServiceError(
      "UNSUPPORTED_FILE",
      `${name}: glTF dengan file terpisah (.bin/tekstur) tidak didukung. Ekspor sebagai .glb.`,
    );
  }
}

async function encodeImage(name: string, bytes: Uint8Array, maxPx: number): Promise<Uint8Array> {
  try {
    const output = await sharp(bytes, { limitInputPixels: ATTACHMENT_IMAGE_MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: maxPx, height: maxPx, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    throw new ServiceError("INVALID_FILE", `${name}: gambar rusak atau terlalu besar untuk diproses.`);
  }
}

async function prepareOne(file: UploadFile, newId: () => string): Promise<PreparedAttachment> {
  const name = sanitizeFileName(file.name);
  // Dicek sebelum deteksi tipe: file kosong tidak punya magic byte (mis. input file tanpa pilihan di form).
  if (file.bytes.length === 0) throw new ServiceError("INVALID_FILE", `${name}: file kosong.`);
  const type = detectFileType(file.bytes);
  if (type === null) throw unsupported(name);
  const max = type.kind === "image" ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_MODEL_MAX_BYTES;
  if (file.bytes.length > max) {
    throw new ServiceError("FILE_TOO_LARGE", `${name}: maksimal ${formatBytes(max)}.`);
  }
  const id = newId();
  const common = {
    id,
    name,
    size: file.bytes.length,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
  };
  if (type.kind === "image") {
    const claude = await encodeImage(name, file.bytes, ATTACHMENT_CLAUDE_MAX_PX);
    const decal = await encodeImage(name, file.bytes, ATTACHMENT_DECAL_MAX_PX);
    return {
      ...common,
      kind: "image",
      file: `${id}.png`,
      decal: decalFileName(id),
      mime: "image/png",
      files: [
        { name: `${id}.png`, bytes: claude },
        { name: decalFileName(id), bytes: decal },
      ],
    };
  }
  if (type.format === "gltf") checkGltf(name, file.bytes);
  const fileName = `${id}.${type.format}`;
  return {
    ...common,
    kind: "model",
    file: fileName,
    decal: null,
    mime: MODEL_MIME[type.format] ?? "application/octet-stream",
    files: [{ name: fileName, bytes: file.bytes }],
  };
}

/** Validasi + proses semua unggahan. Gagal satu = gagal semua (tidak ada yang ditulis). */
export async function prepareUploads(
  files: readonly UploadFile[],
  newId: () => string = randomUUID,
): Promise<PreparedAttachment[]> {
  if (files.length > ATTACHMENT_MAX_FILES) {
    throw new ServiceError("TOO_MANY_FILES", `Maksimal ${ATTACHMENT_MAX_FILES} lampiran per pesan.`);
  }
  const prepared: PreparedAttachment[] = [];
  for (const file of files) prepared.push(await prepareOne(file, newId));
  return prepared;
}

/** Menulis file lampiran secara atomik (file sementara di folder yang sama → rename). Hasil: path yang ditulis. */
export async function writeAttachmentFiles(
  refsDir: string,
  attachments: readonly PreparedAttachment[],
): Promise<string[]> {
  const written: string[] = [];
  try {
    for (const attachment of attachments) {
      for (const file of attachment.files) {
        const target = join(refsDir, file.name);
        const temp = join(refsDir, `.${file.name}.${randomUUID()}.tmp`);
        await writeFile(temp, file.bytes, { flag: "wx", mode: 0o644 });
        await rename(temp, target);
        written.push(target);
      }
    }
  } catch (error) {
    await removeFiles(written);
    throw error;
  }
  return written;
}

export async function removeFiles(paths: readonly string[]): Promise<void> {
  for (const path of paths) await rm(path, { force: true });
}

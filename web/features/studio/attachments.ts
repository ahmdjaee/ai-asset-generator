/**
 * Lampiran yang disiapkan di composer sebelum dikirim. Cek di sini hanya untuk umpan balik cepat (dari nama dan
 * ukuran file); server tetap memeriksa isi file (magic byte), ukuran, dan jumlahnya.
 */
import { t } from "@/i18n/id.ts";
import type { AttachmentKind } from "../../../shared/agent-events.ts";
import { formatBytes } from "../../../shared/format.ts";
import {
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MODEL_MAX_BYTES,
} from "../../../shared/limits.ts";

const KINDS: Readonly<Record<string, AttachmentKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  glb: "model",
  gltf: "model",
  obj: "model",
  fbx: "model",
  stl: "model",
};

/** Nilai `accept` pemilih file: semua jenis (klip kertas) atau gambar saja (tambah gambar referensi). */
export const ACCEPT_ALL = Object.keys(KINDS)
  .map((extension) => `.${extension}`)
  .join(",");
export const ACCEPT_IMAGES = Object.entries(KINDS)
  .filter(([, kind]) => kind === "image")
  .map(([extension]) => `.${extension}`)
  .join(",");

const MAX_BYTES: Readonly<Record<AttachmentKind, number>> = {
  image: ATTACHMENT_IMAGE_MAX_BYTES,
  model: ATTACHMENT_MODEL_MAX_BYTES,
};

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function attachmentKind(name: string): AttachmentKind | null {
  return KINDS[extension(name)] ?? null;
}

/** Keterangan chip: "JPG · 184 KB" (JPEG ditulis JPG, sama dengan desain). */
export function fileMeta(name: string, bytes: number): string {
  const format = extension(name).toUpperCase();
  return t.composer.fileMeta(format === "JPEG" ? "JPG" : format, formatBytes(bytes));
}

export type FileCheck = Readonly<{ accepted: readonly File[]; errors: readonly string[] }>;

/** Memilah file baru: jenis dan ukuran per file, lalu batas jumlah lampiran per pesan (termasuk yang sudah ada). */
export function checkFiles(existing: number, files: readonly File[]): FileCheck {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const kind = attachmentKind(file.name);
    if (kind === null) errors.push(t.composer.unsupported(file.name));
    else if (file.size > MAX_BYTES[kind])
      errors.push(t.composer.tooLarge(file.name, formatBytes(MAX_BYTES[kind])));
    else accepted.push(file);
  }
  const room = Math.max(0, ATTACHMENT_MAX_FILES - existing);
  if (accepted.length > room) {
    errors.push(t.composer.tooMany(ATTACHMENT_MAX_FILES));
    return { accepted: accepted.slice(0, room), errors };
  }
  return { accepted, errors };
}

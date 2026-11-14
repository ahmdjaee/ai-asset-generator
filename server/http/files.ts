import type { ServedFile } from "../services/asset-queries.ts";

/** Karakter yang tidak boleh mentah di `filename*` (RFC 5987 attr-char) walau tidak di-encode `encodeURIComponent`. */
const EXTRA_ESCAPES = /['()*!]/g;

/** `Content-Disposition: attachment` dengan nama ASCII cadangan dan nama asli UTF-8 (RFC 6266/5987). */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    EXTRA_ESCAPES,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Respons file yang sudah dicek service (`ServedFile`). Isi dialirkan dari disk (`Bun.file`), tidak dibaca ke memori.
 * - Versi dan lampiran write-once → cache panjang `immutable`. Turunan (contact sheet) dicek ulang.
 * - `nosniff` + CSP `sandbox`: isi file tidak pernah dijalankan browser sebagai halaman.
 */
export function fileResponse(served: ServedFile): Response {
  const headers = new Headers({
    "Content-Type": served.contentType,
    "Content-Length": String(served.size),
    "Cache-Control": served.cache === "immutable" ? "private, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (served.downloadName !== undefined)
    headers.set("Content-Disposition", contentDisposition(served.downloadName));
  return new Response(Bun.file(served.path), { headers });
}

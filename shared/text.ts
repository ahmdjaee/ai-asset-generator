/**
 * Potongan teks per code point. `String.length` dan `slice` menghitung unit UTF-16, jadi bisa membelah emoji menjadi
 * surrogate tunggal. Teks seperti itu ditolak API Claude, dan karena tersimpan di transkrip sesi, setiap giliran
 * berikutnya ikut gagal. Surrogate tunggal yang terlanjur ada (mis. dari escape `\uD83D` di JSON) diganti U+FFFD.
 */

/** Panjang teks dalam code point (emoji = 1). */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** `max` code point pertama, selalu valid (well-formed). */
export function truncate(text: string, max: number): string {
  const points = Array.from(text.toWellFormed());
  return points.length <= max ? points.join("") : points.slice(0, max).join("");
}

/** Seperti `truncate`, ditambah "…" bila memang terpotong. */
export function ellipsize(text: string, max: number): string {
  const points = Array.from(text.toWellFormed());
  return points.length <= max ? points.join("") : `${points.slice(0, max).join("")}…`;
}

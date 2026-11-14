/** Batas panjang nama file unduhan (tanpa ekstensi). */
const STEM_MAX = 60;

/** Nama file aman dari judul bebas: "Peti harta kayu" → "peti-harta-kayu"; aksen dibuang, sisanya jadi tanda hubung. */
export function fileStem(name: string, fallback = "aset"): string {
  const stem = name
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, STEM_MAX)
    .replace(/^-+|-+$/g, "");
  return stem === "" ? fallback : stem;
}

/**
 * Jeda sebelum URL blob dibebaskan. Firefox dan Safari masih membaca URL itu beberapa saat setelah klik, jadi
 * membebaskannya langsung bisa membatalkan unduhan. 40 dtk sama dengan FileSaver.js.
 */
export const REVOKE_DELAY_MS = 40_000;

type Schedule = (run: () => void, delayMs: number) => void;

const defaultSchedule: Schedule = (run, delayMs) => {
  setTimeout(run, delayMs);
};

/** Mengunduh blob lewat tautan sementara, tanpa membuka tab baru. `schedule` disuntikkan di tes. */
export function saveBlob(blob: Blob, fileName: string, schedule: Schedule = defaultSchedule): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  schedule(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Mengunduh file dari server lewat tautan sementara. Browser menulis respons langsung ke file (tidak lewat memori JS),
 * dan nama filenya dari `Content-Disposition`.
 */
export function downloadUrl(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

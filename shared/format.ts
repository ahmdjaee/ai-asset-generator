/**
 * Format tampilan `id-ID` yang dipakai server (pesan error) dan web (PLAN Tahap 7). Angka mengikuti desain FigCraft:
 * "3.388", "3,4k segitiga", "1,5 MB", "12 mnt", "2 jam lalu", "1 mnt 48 dtk".
 */

/** Tanda nilai tidak diketahui (NaN, tak hingga): data rusak tidak boleh tampil sebagai "NaN hari lalu". */
export const UNKNOWN_VALUE = "—";

const LOCALE = "id-ID";
const NUMBER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const BYTE_UNITS = ["KB", "MB", "GB"] as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Angka dengan pemisah ribuan titik dan desimal koma: 3388 → "3.388", (0.65, 2) → "0,65". */
export function formatNumber(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value);
}

/** Angka ringkas untuk label sempit: 3388 → "3,4k", 1.250.000 → "1,3jt". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return UNKNOWN_VALUE;
  // Dibulatkan dulu: 999,6 ditulis "1k", bukan "1.000".
  if (Math.abs(Math.round(value)) < 1000) return formatNumber(value);
  const thousands = value / 1000;
  // 999.960 dibulatkan menjadi 1.000k: naikkan ke satuan juta.
  if (Math.abs(Math.round(thousands * 10) / 10) < 1000) return `${NUMBER.format(thousands)}k`;
  return `${NUMBER.format(value / 1_000_000)}jt`;
}

/**
 * Ukuran file, mis. `184 KB`, `1,5 MB`. Desimal (1 KB = 1000 byte), sama dengan budget tier dan desain; dibulatkan
 * satu desimal. Nilai negatif dianggap 0.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return UNKNOWN_VALUE;
  const size = Math.max(0, Math.round(bytes));
  if (size < 1000) return `${NUMBER.format(size)} B`;
  let value = size / 1000;
  let unit: (typeof BYTE_UNITS)[number] = "KB";
  for (const next of BYTE_UNITS.slice(1)) {
    // 999,96 KB dibulatkan menjadi 1.000 KB: naikkan ke satuan berikutnya.
    if (Math.round(value * 10) / 10 < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${NUMBER.format(value)} ${unit}`;
}

/** Panjang dalam meter dengan satuan yang mudah dibaca: 0,2 → "20 cm", 0,005 → "5 mm", 2 → "2 m", 1,5 → "1,5 m". */
export function formatLength(meters: number): string {
  if (!Number.isFinite(meters)) return UNKNOWN_VALUE;
  const size = Math.max(0, meters);
  // Dibandingkan setelah dibulatkan: 0,9999 m ditulis "1 m", bukan "100 cm".
  if (Math.round(size * 100) / 100 >= 1) return `${formatNumber(size, 2)} m`;
  if (Math.round(size * 1000) / 1000 >= 0.01) return `${formatNumber(size * 100, 1)} cm`;
  return `${formatNumber(size * 1000, 1)} mm`;
}

/** Persen tanpa desimal: 0,62 → "62%". */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return UNKNOWN_VALUE;
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Waktu relatif. `short` untuk kartu sempit ("12 mnt", "2 jam"), `long` untuk teks biasa ("12 mnt lalu").
 * Di bawah satu menit (atau jam klien tidak sinkron) → "baru saja"; lebih dari seminggu → tanggal.
 * `now` disuntikkan supaya deterministik; `timeZone` hanya untuk tes.
 */
export function formatRelativeTime(
  timestamp: number,
  now: number,
  style: "short" | "long" = "long",
  timeZone?: string,
): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return UNKNOWN_VALUE;
  const elapsed = now - timestamp;
  if (elapsed < MINUTE) return "baru saja";
  if (elapsed >= WEEK) return formatDate(timestamp, now, timeZone);
  const amount =
    elapsed < HOUR
      ? `${Math.floor(elapsed / MINUTE)} mnt`
      : elapsed < DAY
        ? `${Math.floor(elapsed / HOUR)} jam`
        : `${Math.floor(elapsed / DAY)} hari`;
  return style === "short" ? amount : `${amount} lalu`;
}

/** Tanggal singkat: "1 Okt" (tahun ini) atau "1 Okt 2025". */
export function formatDate(timestamp: number, now: number, timeZone?: string): string {
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return UNKNOWN_VALUE;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    ...(timeZone ? { timeZone } : {}),
  };
  const year = (value: number) =>
    new Intl.DateTimeFormat(LOCALE, { year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(value);
  if (year(timestamp) !== year(now)) options.year = "numeric";
  return new Intl.DateTimeFormat(LOCALE, options).format(timestamp);
}

/** Tanggal dan jam lengkap: "14 Nov 2026, 09.12" (info aset). `timeZone` hanya untuk tes. */
export function formatDateTime(timestamp: number, timeZone?: string): string {
  if (!Number.isFinite(timestamp)) return UNKNOWN_VALUE;
  const date = new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(timestamp);
  return `${date}, ${formatTime(timestamp, timeZone)}`;
}

/** Jam: "14.30" (format id-ID 24 jam). `timeZone` hanya untuk tes. */
export function formatTime(timestamp: number, timeZone?: string): string {
  if (!Number.isFinite(timestamp)) return UNKNOWN_VALUE;
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).format(timestamp);
}

/**
 * Durasi: "12 dtk", "1 mnt 48 dtk", "2 mnt", "1 jam 2 mnt". Negatif dianggap 0 (waktu berjalan dihitung dari jam
 * server yang bisa sedikit di depan jam klien).
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return UNKNOWN_VALUE;
  const totalSeconds = Math.floor(Math.max(0, ms) / SECOND);
  if (totalSeconds < 60) return `${totalSeconds} dtk`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes} mnt` : `${minutes} mnt ${seconds} dtk`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

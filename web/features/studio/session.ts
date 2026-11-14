/** Aturan tampilan halaman sesi Studio (fungsi murni, diuji tanpa DOM). */
import type { ThreadEvent } from "./thread-store.ts";

/** Awal giliran Claude: pesan atau aksi pemilik terakhir di thread. `null` bila thread belum memuatnya. */
export function turnStartedAt(events: readonly ThreadEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const stored = events[index];
    if (stored !== undefined && (stored.event.type === "user" || stored.event.type === "action"))
      return stored.ts;
  }
  return null;
}

/** Versi yang dipilih pemilik di panel Detail, beserta versi terkini aset saat memilih. */
export type VersionPick = Readonly<{ version: number; current: number | null }>;

/**
 * Versi di viewer: pilihan pemilik berlaku selama versi terkini aset belum berganti. Build baru atau versi yang dikirim
 * untuk review langsung tampil. Tanpa versi terkini (data lama), versi terbaru yang ada.
 */
export function shownVersion(
  pick: VersionPick | null,
  current: number | null,
  available: readonly number[],
): number | null {
  if (pick !== null && pick.current === current && available.includes(pick.version)) return pick.version;
  if (current !== null && available.includes(current)) return current;
  return available.length === 0 ? null : Math.max(...available);
}

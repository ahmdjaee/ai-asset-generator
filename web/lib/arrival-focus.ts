/**
 * Fokus setelah pindah halaman karena elemen asalnya hilang, mis. aset dihapus dari Detail aset atau sesi Studio.
 * Halaman tujuan memindah fokus ke elemen utamanya (kolom cari Gudang, kolom prompt Studio baru), supaya fokus keyboard
 * tidak jatuh ke `<body>`. Dibawa lewat `state` navigasi; state riwayat tidak dipercaya, jadi dicek dengan zod.
 */
import { type RefObject, useEffect } from "react";
import { useLocation } from "react-router";
import { z } from "zod";

const ARRIVAL_TARGETS = ["search", "prompt"] as const;
export type ArrivalTarget = (typeof ARRIVAL_TARGETS)[number];

const ArrivalState = z.object({ arrivalFocus: z.enum(ARRIVAL_TARGETS) });

/** `state` navigasi ke halaman yang harus memindah fokus ke `target`. */
export function arrivalState(target: ArrivalTarget): Readonly<{ arrivalFocus: ArrivalTarget }> {
  return { arrivalFocus: target };
}

/**
 * Entri riwayat yang fokusnya sudah dipindah: kembali ke entri itu (Back/Forward) tidak memindah fokus lagi. Kunci
 * `"default"` (entri awal tanpa kunci riwayat) bukan identitas entri yang unik, jadi tidak dicatat.
 */
const arrived = new Set<string>();
const UNKEYED_ENTRY = "default";

/** Memindah fokus ke `ref` saat halaman dibuka dengan `arrivalState(target)`, sekali per entri riwayat. */
export function useArrivalFocus(target: ArrivalTarget, ref: RefObject<HTMLElement | null>): void {
  const location = useLocation();
  const parsed = ArrivalState.safeParse(location.state);
  const entry = parsed.success && parsed.data.arrivalFocus === target ? location.key : null;
  useEffect(() => {
    if (entry === null || arrived.has(entry)) return;
    if (entry !== UNKEYED_ENTRY) arrived.add(entry);
    ref.current?.focus();
  }, [entry, ref]);
}

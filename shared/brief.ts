/** Brief aset yang dicatat Claude lewat tool `record_brief` dan ditampilkan di UI. */
import { z } from "zod";

/** Batas dimensi brief (meter). Aset game di app ini: dari barang genggam sampai bangunan kecil. */
export const BRIEF_DIMENSION_MAX_M = 50;

const Meters = z.number().positive().max(BRIEF_DIMENSION_MAX_M);

export const Brief = z.object({
  summary: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(40),
  style: z.string().trim().min(1).max(80),
  /** Ukuran target: lebar (X), kedalaman (depan-belakang), tinggi (atas). */
  dimensionsM: z.object({ width: Meters, depth: Meters, height: Meters }),
  notes: z.string().trim().max(1000).optional(),
});
export type Brief = z.infer<typeof Brief>;

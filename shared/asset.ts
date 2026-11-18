/** Status aset (PLAN Lampiran C). Dipakai server (domain, database) dan web. */
import { z } from "zod";

/** Tahap kerja aset. Hanya berubah lewat `transition()` di `server/domain/status.ts`. */
export const ASSET_STATUSES = [
  "BRIEFING",
  "BASE_WORKING",
  "BASE_REVIEW",
  "TEXTURE_WORKING",
  "TEXTURE_REVIEW",
  "DONE",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Keadaan proses Claude, terpisah dari tahap:
 * - `waiting_user`: ada kartu pertanyaan terbuka;
 * - `failed`: giliran gagal, detail di `lastError`;
 * - `interrupted`: server berhenti di tengah giliran (aksi "Lanjutkan").
 */
export const RUN_STATES = ["idle", "running", "waiting_user", "failed", "interrupted"] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Kode error proses yang ditampilkan ke pemilik (bukan error tool `forge`). */
export const RUN_ERROR_CODES = ["USAGE_LIMIT", "AUTH_REQUIRED", "SESSION_FAILED", "TURN_FAILED"] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

export const LastError = z.object({
  code: z.enum(RUN_ERROR_CODES),
  message: z.string(),
  /** Waktu gagal (ms epoch). */
  at: z.number().int().nonnegative(),
  /** Batas pemakaian: waktu reset (ms epoch), bila diketahui. */
  resetsAt: z.number().int().nonnegative().optional(),
});
export type LastError = z.infer<typeof LastError>;

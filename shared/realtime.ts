/**
 * Protokol WebSocket `/api/ws` (port dari ai-team `server/realtime.ts`). Satu sambungan per tab browser.
 *
 * Klien → server: `{op:"sub", sid, topic, after?}` · `{op:"unsub", sid}`
 * Server → klien: `{sid, event}` · `{sid, op:"ready"}` · `{sid, error}` · `{op:"hb"}`
 *
 * - `sid` dipilih klien per langganan, jadi dua komponen boleh menyimak topik yang sama dengan `after` berbeda.
 * - `ready` dikirim setelah langganan terpasang dan replay selesai: snapshot HTTP yang diambil sesudah `ready` dijamin
 *   tidak kehilangan event di antaranya (event ganda disaring klien lewat `seq`).
 * - Topik `global`: perubahan daftar aset, progres build (live), Pengaturan, dan status runtime. Topik `asset:<id>`: event thread (tersimpan dan
 *   live), `resync` bila klien tertinggal terlalu jauh, `asset_deleted` saat aset dihapus.
 */
import { z } from "zod";
import { StoredEventSchema } from "./asset-events.ts";

export const REALTIME_PATH = "/api/ws";

const ID = "[A-Za-z0-9_-]{1,64}";
export const TOPIC_PATTERN = new RegExp(`^(global|asset:${ID})$`);

export const Sid = z.number().int().min(1).max(1e9);

export const ClientMessage = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("sub"),
    sid: Sid,
    topic: z.string().regex(TOPIC_PATTERN),
    after: z.number().int().min(0).optional(),
  }),
  z.object({ op: z.literal("unsub"), sid: Sid }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ASSET_CHANGES = ["created", "updated", "deleted"] as const;
export type AssetChange = (typeof ASSET_CHANGES)[number];

export const TopicEvent = z.discriminatedUnion("type", [
  /** Event thread aset; `stored.seq` null = event live (boleh dibuang saat klien lambat). */
  z.object({ type: z.literal("thread"), stored: StoredEventSchema }),
  /** Klien tertinggal lebih dari `WS_REPLAY_MAX_EVENTS`: muat ulang thread lewat HTTP. */
  z.object({ type: z.literal("resync") }),
  z.object({ type: z.literal("asset_deleted") }),
  /** Topik `global`: daftar aset berubah. */
  z.object({ type: z.literal("asset"), assetId: z.string(), change: z.enum(ASSET_CHANGES) }),
  /** Topik `global`: progres build yang sedang berjalan (live; boleh dibuang saat sambungan padat). */
  z.object({
    type: z.literal("asset_progress"),
    assetId: z.string(),
    stage: z.enum(["base", "textured"]),
    pct: z.number().min(0).max(100),
  }),
  /** Topik `global`: Pengaturan disimpan (tab lain mengambil ulang). */
  z.object({ type: z.literal("settings") }),
  /** Topik `global`: status runtime berubah (bangun image mulai/selesai). */
  z.object({ type: z.literal("runtime") }),
  /** Topik `global`: status login Claude perlu diperiksa ulang (giliran gagal karena belum login). */
  z.object({ type: z.literal("auth") }),
]);
export type TopicEvent = z.infer<typeof TopicEvent>;

export const ServerMessage = z.union([
  z.object({ op: z.literal("hb") }),
  z.object({ sid: Sid, op: z.literal("ready") }),
  z.object({ sid: Sid, error: z.string() }),
  z.object({ sid: Sid, event: TopicEvent }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

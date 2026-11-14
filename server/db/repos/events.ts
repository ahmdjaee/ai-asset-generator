/** Repositori event thread. `seq` dialokasikan di dalam transaksi, berurutan per aset mulai 1. */
import { and, asc, desc, eq, gt, lt, max, sql } from "drizzle-orm";
import type { MessageAttachment } from "../../../shared/agent-events.ts";
import {
  type AssetEvent,
  AssetEventSchema,
  isLiveOnly,
  type StoredEvent,
} from "../../../shared/asset-events.ts";
import { EVENTS_PAGE_MAX } from "../../../shared/limits.ts";
import { events } from "../schema.ts";
import type { Executor } from "./executor.ts";

type Row = typeof events.$inferSelect;

/**
 * Baris yang tidak lolos skema (mis. format lama) dilewati; jumlahnya dilaporkan ke pemanggil. `rows` dan `lastSeq`
 * menghitung semua baris halaman (termasuk yang dilewati), supaya pembaca berhalaman tahu halaman itu penuh dan
 * melanjutkan dari seq yang benar.
 */
export type EventPage = Readonly<{
  events: StoredEvent[];
  skipped: number;
  rows: number;
  lastSeq: number | null;
}>;

function toPage(rows: readonly Row[]): EventPage {
  const parsed: StoredEvent[] = [];
  let skipped = 0;
  for (const row of rows) {
    const event = AssetEventSchema.safeParse(row.payload);
    if (event.success) parsed.push({ assetId: row.assetId, seq: row.seq, ts: row.ts, event: event.data });
    else skipped += 1;
  }
  return { events: parsed, skipped, rows: rows.length, lastSeq: rows.at(-1)?.seq ?? null };
}

export function appendEvent(x: Executor, assetId: string, event: AssetEvent, ts: number): StoredEvent {
  if (isLiveOnly(event)) throw new Error(`Event ${event.type} hanya live dan tidak disimpan`);
  return x.transaction((tx) => {
    const last = tx
      .select({ seq: max(events.seq) })
      .from(events)
      .where(eq(events.assetId, assetId))
      .get();
    const seq = (last?.seq ?? 0) + 1;
    tx.insert(events).values({ assetId, seq, type: event.type, payload: event, ts }).run();
    return { assetId, seq, ts, event };
  });
}

export type EventQuery = Readonly<{
  /** Hanya event dengan seq > after (replay setelah sambung ulang). */
  after?: number;
  /** Hanya event dengan seq < before (halaman thread yang lebih lama). */
  before?: number;
  limit?: number;
}>;

/** Event urut naik. Dengan `before`, yang diambil adalah halaman terbaru sebelum seq itu. */
export function listEvents(x: Executor, assetId: string, query: EventQuery = {}): EventPage {
  const limit = Math.min(query.limit ?? EVENTS_PAGE_MAX, EVENTS_PAGE_MAX);
  const filters = [eq(events.assetId, assetId)];
  if (query.after !== undefined) filters.push(gt(events.seq, query.after));
  if (query.before !== undefined) filters.push(lt(events.seq, query.before));
  const newestFirst = query.before !== undefined && query.after === undefined;
  const rows = x
    .select()
    .from(events)
    .where(and(...filters))
    .orderBy(newestFirst ? desc(events.seq) : asc(events.seq))
    .limit(limit)
    .all();
  return toPage(newestFirst ? rows.reverse() : rows);
}

/** Event terakhir bertipe `type`, atau null. */
export function lastEventOfType<T extends AssetEvent["type"]>(
  x: Executor,
  assetId: string,
  type: T,
): Extract<AssetEvent, { type: T }> | null {
  const rows = x
    .select()
    .from(events)
    .where(and(eq(events.assetId, assetId), eq(events.type, type)))
    .orderBy(desc(events.seq))
    .limit(1)
    .all();
  const found = toPage(rows).events[0]?.event;
  return found !== undefined && isEventType(found, type) ? found : null;
}

/** Permintaan tersimpan: kata-kata di event `user` + chip lampirannya (catatan lampiran untuk Claude tidak disimpan). */
export type StoredRequest = Readonly<{ text: string; attachments: readonly MessageAttachment[] }>;

/**
 * Permintaan terakhir ke Claude: event `user` terakhir yang bukan pesan lanjutkan/coba lagi (pesan pemilik,
 * persetujuan, atau ubah bentuk). Dipakai untuk mengutipnya di pesan lanjutkan/coba lagi.
 */
export function lastRequest(x: Executor, assetId: string): StoredRequest | null {
  const rows = x
    .select()
    .from(events)
    .where(
      and(
        eq(events.assetId, assetId),
        eq(events.type, "user"),
        sql`coalesce(json_extract(${events.payload}, '$.origin'), '') not in ('resume', 'retry')`,
      ),
    )
    .orderBy(desc(events.seq))
    .limit(1)
    .all();
  const found = toPage(rows).events[0]?.event;
  return found?.type === "user" ? { text: found.text, attachments: found.attachments ?? [] } : null;
}

function isEventType<T extends AssetEvent["type"]>(
  event: AssetEvent,
  type: T,
): event is Extract<AssetEvent, { type: T }> {
  return event.type === type;
}

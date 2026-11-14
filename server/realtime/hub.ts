/**
 * Hub realtime `/api/ws` (PLAN Tahap 6), port dari ai-team `server/realtime.ts` di atas WebSocket Bun. Protokol dan
 * topiknya ada di `shared/realtime.ts`.
 *
 * Backpressure:
 * - Nilai balik `send()` Bun dibaca: -1 = pesan masuk antrean (sambungan padat), 0 = pesan dibuang Bun.
 * - Selama padat (sampai `drain`) atau antrean di atas `WS_SOFT_BUFFER_BYTES`, event live (`seq` null: delta teks,
 *   progres build) dilewati. Teks lengkap tetap datang lewat event `assistant` dan hasil build.
 * - Event penting tidak pernah dibuang diam-diam: bila Bun membuangnya, atau antrean melewati `WS_HARD_BUFFER_BYTES`,
 *   sambungan ditutup. Klien menyambung ulang dengan `after`, lalu replay dari database menutup celahnya.
 * - Adaptor `@hono/bun` tidak meneruskan event `drain`, jadi `main.ts` memasang handler `drain` yang memanggil
 *   `Hub.drain()`.
 *
 * Detak: Bun sendiri mengirim ping protokol dan menutup sambungan yang mati (`idleTimeout`). Pesan `{op:"hb"}` hanya
 * untuk browser, yang tidak bisa melihat ping.
 */
import {
  WS_HARD_BUFFER_BYTES,
  WS_HEARTBEAT_MS,
  WS_MAX_SUBSCRIPTIONS,
  WS_SOFT_BUFFER_BYTES,
} from "../../shared/limits.ts";
import { ClientMessage, type ServerMessage, type TopicEvent } from "../../shared/realtime.ts";
import type { AssetQueries } from "../services/asset-queries.ts";
import type { EventBus } from "../services/bus.ts";

/** Bagian `ServerWebSocket` Bun yang dipakai hub (antarmuka kecil supaya hub bisa diuji tanpa server). */
export interface HubSocket {
  /** Status kirim Bun: -1 = masuk antrean (backpressure), 0 = dibuang, >0 = byte terkirim. */
  send(data: string): number;
  getBufferedAmount(): number;
  close(code?: number, reason?: string): void;
}

/** Penjadwal detak; hasilnya menghentikan jadwal. Disuntikkan supaya tes tidak bergantung pada waktu. */
export type Every = (ms: number, run: () => void) => () => void;

export type HubDeps = Readonly<{
  bus: EventBus;
  queries: Pick<AssetQueries, "exists" | "replay">;
  every?: Every;
  heartbeatMs?: number;
  onError?: (error: unknown, context: Readonly<{ op: string }>) => void;
}>;

/** Kode tutup WebSocket (RFC 6455): server berhenti, dan "coba lagi nanti" untuk klien yang terlalu lambat. */
export const CLOSE_GOING_AWAY = 1001;
export const CLOSE_TRY_AGAIN = 1013;

type Emit = (event: TopicEvent, droppable?: boolean) => void;

/**
 * Sambungan dikenali dari kuncinya: objek `ServerWebSocket` asli, yang sama di setiap event adaptor Hono dan di
 * handler `drain` Bun (pembungkus `WSContext` dibuat ulang setiap event).
 */
type Client = {
  readonly key: object;
  readonly socket: HubSocket;
  readonly subs: Map<number, () => void>;
  /** `send()` terakhir masuk antrean; dibersihkan oleh `drain`. */
  congested: boolean;
  closed: boolean;
};

const realEvery: Every = (ms, run) => {
  const handle = setInterval(run, ms);
  handle.unref();
  return () => clearInterval(handle);
};

export class Hub {
  readonly #deps: HubDeps;
  readonly #clients = new Map<object, Client>();
  #stopHeartbeat: (() => void) | undefined;

  constructor(deps: HubDeps) {
    this.#deps = deps;
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  start(): void {
    if (this.#stopHeartbeat !== undefined) return;
    const every = this.#deps.every ?? realEvery;
    this.#stopHeartbeat = every(this.#deps.heartbeatMs ?? WS_HEARTBEAT_MS, () => this.heartbeat());
  }

  /** Menghentikan detak dan menutup semua sambungan (server berhenti). */
  stop(): void {
    this.#stopHeartbeat?.();
    this.#stopHeartbeat = undefined;
    for (const client of [...this.#clients.values()])
      this.#disconnect(client, CLOSE_GOING_AWAY, "server berhenti");
  }

  open(key: object, socket: HubSocket): void {
    if (this.#clients.has(key)) return;
    this.#clients.set(key, { key, socket, subs: new Map(), congested: false, closed: false });
  }

  close(key: object): void {
    const client = this.#clients.get(key);
    if (client === undefined) return;
    this.#clients.delete(key);
    client.closed = true;
    this.#unsubscribeAll(client);
  }

  /** Antrean kirim sudah kosong lagi: event live boleh dikirim lagi. */
  drain(key: object): void {
    const client = this.#clients.get(key);
    if (client !== undefined) client.congested = false;
  }

  heartbeat(): void {
    for (const client of [...this.#clients.values()]) this.#send(client, { op: "hb" });
  }

  /** Pesan dari klien. Pesan biner, JSON rusak, atau di luar protokol diabaikan. */
  message(key: object, data: unknown): void {
    const client = this.#clients.get(key);
    if (client === undefined || typeof data !== "string") return;
    let parsed: ReturnType<typeof ClientMessage.safeParse>;
    try {
      parsed = ClientMessage.safeParse(JSON.parse(data));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const message = parsed.data;
    const previous = client.subs.get(message.sid);
    if (previous !== undefined) {
      client.subs.delete(message.sid);
      previous();
    }
    if (message.op === "unsub") return;

    const { sid } = message;
    if (client.subs.size >= WS_MAX_SUBSCRIPTIONS) {
      this.#send(client, { sid, error: "Terlalu banyak langganan di satu sambungan." });
      return;
    }
    const emit: Emit = (event, droppable = false) => this.#send(client, { sid, event }, droppable);
    let result: (() => void) | string;
    try {
      result = this.#openTopic(message.topic, message.after, emit);
    } catch (error) {
      this.#deps.onError?.(error, { op: `sub ${message.topic}` });
      result = "Langganan gagal. Coba sambung ulang.";
    }
    if (typeof result === "string") {
      this.#send(client, { sid, error: result });
      return;
    }
    if (client.closed) {
      // Replay membuat sambungan ditutup (klien terlalu lambat): jangan sisakan langganan.
      result();
      return;
    }
    client.subs.set(sid, result);
    this.#send(client, { sid, op: "ready" });
  }

  /**
   * Replay lalu langsung berlangganan; keduanya sinkron berurutan, jadi tanpa celah dan tanpa duplikat (bus
   * menyiarkan di thread yang sama).
   */
  #openTopic(topic: string, after: number | undefined, emit: Emit): (() => void) | string {
    const { bus, queries } = this.#deps;
    if (topic === "global") {
      return bus.subscribeGlobal((event) => {
        if (event.type === "asset") emit({ type: "asset", assetId: event.assetId, change: event.change });
        else
          emit({ type: "asset_progress", assetId: event.assetId, stage: event.stage, pct: event.pct }, true);
      });
    }
    const assetId = topic.slice("asset:".length);
    if (!queries.exists(assetId)) return "Aset tidak ditemukan.";
    if (after !== undefined) {
      const missed = queries.replay(assetId, after);
      if (missed === "resync") emit({ type: "resync" });
      else for (const stored of missed) emit({ type: "thread", stored });
    }
    const offThread = bus.subscribe(assetId, (stored) =>
      emit({ type: "thread", stored }, stored.seq === null),
    );
    const offDeleted = bus.subscribeGlobal((event) => {
      if (event.type === "asset" && event.assetId === assetId && event.change === "deleted") {
        emit({ type: "asset_deleted" });
      }
    });
    return () => {
      offThread();
      offDeleted();
    };
  }

  #send(client: Client, message: ServerMessage, droppable = false): void {
    if (client.closed) return;
    const buffered = client.socket.getBufferedAmount();
    if (droppable && (client.congested || buffered > WS_SOFT_BUFFER_BYTES)) return;
    if (buffered > WS_HARD_BUFFER_BYTES) {
      this.#disconnect(client, CLOSE_TRY_AGAIN, "klien terlalu lambat");
      return;
    }
    const status = client.socket.send(JSON.stringify(message));
    if (status === -1) client.congested = true;
    else if (status === 0 && !droppable) this.#disconnect(client, CLOSE_TRY_AGAIN, "pesan tidak terkirim");
  }

  #disconnect(client: Client, code: number, reason: string): void {
    if (client.closed) return;
    client.closed = true;
    this.#clients.delete(client.key);
    this.#unsubscribeAll(client);
    try {
      client.socket.close(code, reason);
    } catch (error) {
      this.#deps.onError?.(error, { op: "tutup sambungan" });
    }
  }

  #unsubscribeAll(client: Client): void {
    for (const off of client.subs.values()) off();
    client.subs.clear();
  }
}

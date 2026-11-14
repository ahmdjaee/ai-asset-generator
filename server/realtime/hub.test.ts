import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_TIERS,
  WS_HARD_BUFFER_BYTES,
  WS_MAX_SUBSCRIPTIONS,
  WS_REPLAY_MAX_EVENTS,
  WS_SOFT_BUFFER_BYTES,
} from "../../shared/limits.ts";
import { ServerMessage } from "../../shared/realtime.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { insertAsset } from "../db/repos/assets.ts";
import { AssetQueries } from "../services/asset-queries.ts";
import { EventLog } from "../services/asset-store.ts";
import { EventBus } from "../services/bus.ts";
import { CLOSE_GOING_AWAY, CLOSE_TRY_AGAIN, type Every, Hub, type HubSocket } from "./hub.ts";

class FakeSocket implements HubSocket {
  readonly sent: ServerMessage[] = [];
  buffered = 0;
  /** Status `send()` berikutnya (Bun: -1 antre, 0 dibuang, >0 terkirim). */
  status = 1;
  closed: { code: number | undefined; reason: string | undefined } | null = null;

  send(data: string): number {
    this.sent.push(ServerMessage.parse(JSON.parse(data)));
    return this.status;
  }

  getBufferedAmount(): number {
    return this.buffered;
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }

  /** Tipe event per langganan, dalam urutan diterima. */
  events(sid: number): string[] {
    return this.sent.flatMap((message) =>
      "sid" in message && message.sid === sid && "event" in message
        ? [message.event.type === "thread" ? `thread:${message.event.stored.event.type}` : message.event.type]
        : [],
    );
  }

  take(): ServerMessage[] {
    return this.sent.splice(0);
  }
}

let handle: DatabaseHandle;
let bus: EventBus;
let log: EventLog;
let hub: Hub;
let errors: unknown[];

beforeEach(() => {
  handle = openDatabase(":memory:");
  errors = [];
  bus = new EventBus({ onError: (error) => errors.push(error) });
  log = new EventLog({ db: handle.db, bus, now: () => 1 });
  hub = new Hub({ bus, queries: new AssetQueries({ db: handle.db, dataDir: "/tidak-dipakai" }) });
  insertAsset(handle.db, {
    id: "a1",
    name: "Peti",
    prompt: "peti",
    tierId: "ringan",
    tier: DEFAULT_TIERS.ringan,
    now: 1,
  });
});

afterEach(() => {
  hub.stop();
  handle.close();
  expect(errors).toEqual([]);
});

function connect(): FakeSocket {
  const socket = new FakeSocket();
  hub.open(socket, socket);
  return socket;
}

function send(socket: FakeSocket, message: unknown): void {
  hub.message(socket, JSON.stringify(message));
}

function notice(text: string) {
  return log.record("a1", { type: "notice", text });
}

describe("Hub — langganan", () => {
  test("global: ready, perubahan daftar aset, berhenti setelah unsub", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "global" });
    bus.publishGlobal({ type: "asset", assetId: "a1", change: "updated" });
    send(socket, { op: "unsub", sid: 1 });
    bus.publishGlobal({ type: "asset", assetId: "a1", change: "deleted" });
    expect(socket.take()).toEqual([
      { sid: 1, op: "ready" },
      { sid: 1, event: { type: "asset", assetId: "a1", change: "updated" } },
    ]);
  });

  test("global: progres build diteruskan; topik aset tidak menerimanya", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "global" });
    send(socket, { op: "sub", sid: 2, topic: "asset:a1" });
    bus.publishGlobal({ type: "progress", assetId: "a1", stage: "textured", pct: 62 });
    expect(socket.take()).toEqual([
      { sid: 1, op: "ready" },
      { sid: 2, op: "ready" },
      { sid: 1, event: { type: "asset_progress", assetId: "a1", stage: "textured", pct: 62 } },
    ]);
  });

  test("aset: event tersimpan dan live setelah ready; aset dihapus diberitahukan", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 7, topic: "asset:a1" });
    notice("satu");
    log.record("a1", { type: "delta", kind: "text", text: "ha" });
    bus.publishGlobal({ type: "asset", assetId: "lain", change: "deleted" });
    bus.publishGlobal({ type: "asset", assetId: "a1", change: "deleted" });
    expect(socket.sent[0]).toEqual({ sid: 7, op: "ready" });
    expect(socket.events(7)).toEqual(["thread:notice", "thread:delta", "asset_deleted"]);
  });

  test("replay setelah `after` dikirim sebelum ready, berurutan dan tanpa duplikat", () => {
    for (const text of ["1", "2", "3", "4"]) notice(text);
    const socket = connect();
    send(socket, { op: "sub", sid: 2, topic: "asset:a1", after: 2 });
    notice("5");
    const seqs = socket.sent.map((message) =>
      "event" in message && message.event.type === "thread" ? message.event.stored.seq : "ready",
    );
    expect(seqs).toEqual([3, 4, "ready", 5]);
  });

  test(`tertinggal lebih dari ${WS_REPLAY_MAX_EVENTS} event → resync, lalu tetap berlangganan`, () => {
    for (let index = 0; index <= WS_REPLAY_MAX_EVENTS; index += 1) notice(`n${index}`);
    const socket = connect();
    send(socket, { op: "sub", sid: 3, topic: "asset:a1", after: 0 });
    notice("baru");
    expect(socket.events(3)).toEqual(["resync", "thread:notice"]);
    expect(socket.sent[1]).toEqual({ sid: 3, op: "ready" });
  });

  test("aset tidak ada → error; pesan rusak, biner, atau di luar protokol diabaikan", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 4, topic: "asset:tidak-ada" });
    send(socket, { op: "sub", sid: 5, topic: "asset:../x" });
    send(socket, { op: "sub", sid: 0, topic: "global" });
    send(socket, { op: "kendali", sid: 6 });
    hub.message(socket, "{bukan json");
    hub.message(socket, new Uint8Array([1, 2]).buffer);
    expect(socket.take()).toEqual([{ sid: 4, error: "Aset tidak ditemukan." }]);
    expect(socket.closed).toBeNull();
  });

  test("sid yang sama mengganti langganan lama (tanpa event ganda)", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    notice("sekali");
    expect(socket.events(1)).toEqual(["thread:notice"]);
  });

  test(`maksimal ${WS_MAX_SUBSCRIPTIONS} langganan per sambungan`, () => {
    const socket = connect();
    for (let sid = 1; sid <= WS_MAX_SUBSCRIPTIONS + 1; sid += 1)
      send(socket, { op: "sub", sid, topic: "global" });
    expect(socket.sent.at(-1)).toEqual({
      sid: WS_MAX_SUBSCRIPTIONS + 1,
      error: "Terlalu banyak langganan di satu sambungan.",
    });
  });

  test("sambungan ditutup: langganan dilepas, tidak ada kiriman lagi", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    hub.close(socket);
    notice("setelah tutup");
    expect(socket.events(1)).toEqual([]);
    expect(hub.clientCount).toBe(0);
  });

  test("error saat membuka topik dilaporkan, klien menerima pesan umum", () => {
    const broken = new Hub({
      bus,
      queries: {
        exists: () => true,
        replay: () => {
          throw new Error("database terkunci");
        },
      },
      onError: (error) => errors.push(error),
    });
    const socket = new FakeSocket();
    broken.open(socket, socket);
    broken.message(socket, JSON.stringify({ op: "sub", sid: 1, topic: "asset:a1", after: 0 }));
    expect(socket.take()).toEqual([{ sid: 1, error: "Langganan gagal. Coba sambung ulang." }]);
    expect(errors.splice(0)).toHaveLength(1);
  });
});

describe("Hub — detak", () => {
  test("pesan hb terjadwal ke semua klien; stop menghentikan jadwal dan menutup sambungan", () => {
    const runs: Array<() => void> = [];
    let stopped = 0;
    const every: Every = (ms, run) => {
      expect(ms).toBe(10);
      runs.push(run);
      return () => {
        stopped += 1;
      };
    };
    const timed = new Hub({ bus, queries: { exists: () => true, replay: () => [] }, every, heartbeatMs: 10 });
    const first = new FakeSocket();
    const second = new FakeSocket();
    timed.open(first, first);
    timed.open(second, second);
    timed.start();
    timed.start();
    expect(runs).toHaveLength(1);
    runs[0]?.();
    expect(first.take()).toEqual([{ op: "hb" }]);
    expect(second.take()).toEqual([{ op: "hb" }]);
    timed.stop();
    expect(stopped).toBe(1);
    expect(first.closed).toEqual({ code: CLOSE_GOING_AWAY, reason: "server berhenti" });
    expect(timed.clientCount).toBe(0);
  });
});

describe("Hub — backpressure", () => {
  test("send() masuk antrean → delta dilewati sampai drain; event tersimpan tetap terkirim", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    socket.status = -1;
    notice("antre");
    socket.status = 1;
    log.record("a1", { type: "delta", kind: "text", text: "dilewati" });
    notice("penting");
    hub.drain(socket);
    log.record("a1", { type: "delta", kind: "text", text: "terkirim" });
    expect(socket.events(1)).toEqual(["thread:notice", "thread:notice", "thread:delta"]);
    expect(socket.closed).toBeNull();
  });

  test(`antrean > ${WS_SOFT_BUFFER_BYTES} byte → delta dibuang, event penting tidak`, () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    socket.buffered = WS_SOFT_BUFFER_BYTES + 1;
    log.record("a1", { type: "delta", kind: "text", text: "x" });
    log.record("a1", { type: "build_progress", jobId: "j1", step: "render", pct: 50 });
    notice("tetap");
    expect(socket.events(1)).toEqual(["thread:notice"]);
  });

  test("progres build di topik global boleh dibuang saat padat; perubahan daftar aset tidak", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "global" });
    socket.buffered = WS_SOFT_BUFFER_BYTES + 1;
    bus.publishGlobal({ type: "progress", assetId: "a1", stage: "base", pct: 40 });
    bus.publishGlobal({ type: "asset", assetId: "a1", change: "updated" });
    expect(socket.events(1)).toEqual(["asset"]);
  });

  test(`antrean > ${WS_HARD_BUFFER_BYTES} byte → sambungan diputus (klien replay dengan after)`, () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    socket.buffered = WS_HARD_BUFFER_BYTES + 1;
    notice("tidak muat");
    expect(socket.closed).toEqual({ code: CLOSE_TRY_AGAIN, reason: "klien terlalu lambat" });
    expect(hub.clientCount).toBe(0);
    socket.buffered = 0;
    notice("setelah putus");
    expect(socket.events(1)).toEqual([]);
  });

  test("Bun membuang event penting (send() = 0) → sambungan diputus; delta yang dibuang tidak", () => {
    const socket = connect();
    send(socket, { op: "sub", sid: 1, topic: "asset:a1" });
    socket.status = 0;
    log.record("a1", { type: "delta", kind: "text", text: "x" });
    expect(socket.closed).toBeNull();
    notice("hilang");
    expect(socket.closed).toEqual({ code: CLOSE_TRY_AGAIN, reason: "pesan tidak terkirim" });
  });

  test("replay yang membuat sambungan putus tidak menyisakan langganan", () => {
    for (const text of ["1", "2"]) notice(text);
    const socket = connect();
    socket.buffered = WS_HARD_BUFFER_BYTES + 1;
    send(socket, { op: "sub", sid: 1, topic: "asset:a1", after: 0 });
    socket.buffered = 0;
    notice("3");
    expect(socket.sent).toEqual([]);
    expect(socket.closed?.code).toBe(CLOSE_TRY_AGAIN);
  });
});

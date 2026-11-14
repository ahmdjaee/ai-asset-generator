import { beforeEach, describe, expect, test } from "bun:test";
import type { SubscribeOptions } from "@/lib/realtime.ts";
import type { AssetEvent, StoredEvent } from "../../../shared/asset-events.ts";
import type { TopicEvent } from "../../../shared/realtime.ts";
import {
  type EventsPage,
  mergeEvents,
  READY_FALLBACK_MS,
  STREAM_FLUSH_MS,
  type ThreadEvent,
  ThreadStore,
} from "./thread-store.ts";

function stored(seq: number, event: AssetEvent = { type: "notice", text: `n${seq}` }): ThreadEvent {
  return { assetId: "a1", seq, ts: seq * 10, event };
}

function live(event: AssetEvent): StoredEvent {
  return { assetId: "a1", seq: null, ts: 0, event };
}

const thread = (event: StoredEvent): TopicEvent => ({ type: "thread", stored: event });

/** Langganan realtime tiruan: tes memicu ready, event, dan sambung ulang sendiri. */
class FakeRealtime {
  topic = "";
  onEvent: ((event: TopicEvent) => void) | null = null;
  options: SubscribeOptions = {};
  unsubscribed = 0;

  subscribe = (topic: string, onEvent: (event: TopicEvent) => void, options: SubscribeOptions = {}) => {
    this.topic = topic;
    this.onEvent = onEvent;
    this.options = options;
    return () => {
      this.unsubscribed += 1;
    };
  };

  /** Seperti klien sungguhan saat (ulang) berlangganan: membaca `after`, lalu server mengirim `ready`. */
  ready(): number | undefined {
    const after = this.options.after?.();
    this.options.onReady?.();
    return after;
  }

  send(event: TopicEvent): void {
    this.onEvent?.(event);
  }
}

class FakeTimers {
  readonly pending: Array<{ run: () => void; ms: number }> = [];

  schedule = (run: () => void, ms: number) => {
    const timer = { run, ms };
    this.pending.push(timer);
    return () => {
      const index = this.pending.indexOf(timer);
      if (index >= 0) this.pending.splice(index, 1);
    };
  };

  fire(ms: number): void {
    for (const timer of this.pending.filter((candidate) => candidate.ms === ms)) {
      this.pending.splice(this.pending.indexOf(timer), 1);
      timer.run();
    }
  }
}

type Fetch = {
  query: { before?: number; limit?: number };
  resolve: (page: EventsPage) => void;
  reject: (e: Error) => void;
};

let realtime: FakeRealtime;
let timers: FakeTimers;
let fetches: Fetch[];
let seen: ThreadEvent[];
let store: ThreadStore;
let clock: number;

/** Biarkan promise fetch yang sudah diselesaikan berjalan. */
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

beforeEach(() => {
  realtime = new FakeRealtime();
  timers = new FakeTimers();
  fetches = [];
  seen = [];
  clock = 1_000;
  store = new ThreadStore("a1", {
    realtime,
    schedule: timers.schedule,
    now: () => clock,
    fetchEvents: (query) =>
      new Promise<EventsPage>((resolve, reject) => {
        fetches.push({ query, resolve, reject });
      }),
    onStored: (event) => seen.push(event),
  });
});

function answer(index: number, page: EventsPage): Promise<void> {
  const pending = fetches[index];
  if (pending === undefined) throw new Error(`fetch #${index} tidak ada`);
  pending.resolve(page);
  return flush();
}

describe("mergeEvents", () => {
  test("menempel event baru, menyaring ganda, dan mengurutkan event lama", () => {
    const base = [stored(2), stored(3)];
    expect(mergeEvents(base, [stored(4)]).map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(mergeEvents(base, [stored(3)])).toBe(base);
    expect(mergeEvents(base, [stored(1), stored(3), stored(5)]).map((event) => event.seq)).toEqual([
      1, 2, 3, 5,
    ]);
  });
});

describe("ThreadStore", () => {
  test("berlangganan dulu; snapshot diambil setelah ready tanpa after", async () => {
    store.start();
    expect(realtime.topic).toBe("asset:a1");
    expect(store.getSnapshot().phase).toBe("loading");
    expect(fetches).toHaveLength(0);
    expect(realtime.ready()).toBeUndefined();
    expect(fetches.map((fetch) => fetch.query)).toEqual([{ limit: 200 }]);
    // Event live yang datang selama fetch ikut tergabung.
    realtime.send(thread(stored(3)));
    await answer(0, { events: [stored(1), stored(2), stored(3)], hasMore: false });
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(seen.map((event) => event.seq)).toEqual([3]);
  });

  test("sambung ulang mengirim after = seq terakhir; replay tidak memuat ulang jendela", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [stored(1), stored(2)], hasMore: true });
    expect(realtime.ready()).toBe(2);
    realtime.send(thread(stored(3)));
    expect(fetches).toHaveLength(1);
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(store.getSnapshot().hasMore).toBe(true);
  });

  test("delta ditampung dan dikeluarkan sekali per 100 ms; event tersimpan menggantikan stream", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [], hasMore: false });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    realtime.send(thread(live({ type: "delta", kind: "thinking", text: "Men" })));
    realtime.send(thread(live({ type: "delta", kind: "thinking", text: "imbang" })));
    realtime.send(thread(live({ type: "delta", kind: "text", text: "Halo" })));
    expect(notified).toBe(0);
    expect(timers.pending.map((timer) => timer.ms)).toEqual([READY_FALLBACK_MS, STREAM_FLUSH_MS]);
    timers.fire(STREAM_FLUSH_MS);
    expect(notified).toBe(1);
    expect(store.getSnapshot().streaming).toEqual({ text: "Halo", thinking: "Menimbang" });

    realtime.send(thread(stored(1, { type: "thinking", text: "Menimbang" })));
    expect(store.getSnapshot().streaming).toEqual({ text: "Halo", thinking: "" });
    realtime.send(thread(stored(2, { type: "assistant", text: "Halo" })));
    expect(store.getSnapshot().streaming).toEqual({ text: "", thinking: "" });
  });

  test("progres build live per job; dibuang saat build selesai atau giliran berakhir", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [], hasMore: false });
    realtime.send(thread(live({ type: "build_progress", jobId: "j1", step: "ekspor", pct: 30 })));
    clock = 5_000;
    realtime.send(thread(live({ type: "build_progress", jobId: "j1", step: "bake", pct: 40 })));
    clock = 9_000;
    realtime.send(
      thread(live({ type: "build_progress", jobId: "j1", step: "optimasi dan validasi", pct: 65 })),
    );
    clock = 12_000;
    realtime.send(
      thread(live({ type: "build_progress", jobId: "j1", step: "render contact sheet", pct: 80 })),
    );
    clock = 13_000;
    realtime.send(thread(live({ type: "build_progress", jobId: "j1", step: "menyimpan versi", pct: 95 })));
    // Waktu tiap bagian = saat pertama kali terlihat; langkah lain di bagian yang sama tidak menggesernya.
    expect(store.getSnapshot().builds).toEqual({
      j1: { step: "menyimpan versi", pct: 95, phases: { sandbox: 1_000, optimize: 9_000, render: 12_000 } },
    });
    realtime.send(thread(stored(1, { type: "build_finished", jobId: "j1", ok: true, version: 1 })));
    expect(store.getSnapshot().builds).toEqual({});

    realtime.send(thread(live({ type: "build_progress", jobId: "j2", step: "ekspor", pct: 10 })));
    realtime.send(thread(live({ type: "delta", kind: "text", text: "x" })));
    realtime.send(
      thread(
        stored(2, {
          type: "result",
          subtype: "success",
          isError: false,
          interrupted: true,
          durationMs: 1,
          numTurns: 1,
        }),
      ),
    );
    expect(store.getSnapshot().builds).toEqual({});
    // Stream yang terputus dibuang, termasuk jadwal flush-nya.
    expect(timers.pending.map((timer) => timer.ms)).toEqual([READY_FALLBACK_MS]);
  });

  test("resync mengganti isi dengan jendela terbaru; asset_deleted ditandai", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [stored(1), stored(2)], hasMore: false });
    realtime.send({ type: "resync" });
    expect(store.getSnapshot().events).toEqual([]);
    await answer(1, { events: [stored(900)], hasMore: true });
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([900]);
    realtime.send({ type: "asset_deleted" });
    expect(store.getSnapshot().deleted).toBe(true);
  });

  test("muat yang lebih lama memakai before = seq tertua", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [stored(201), stored(202)], hasMore: true });
    const older = store.loadOlder();
    expect(store.getSnapshot().loadingOlder).toBe(true);
    expect(fetches[1]?.query).toEqual({ before: 201, limit: 200 });
    await answer(1, { events: [stored(1), stored(200)], hasMore: false });
    await older;
    const snapshot = store.getSnapshot();
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 200, 201, 202]);
    expect(snapshot).toMatchObject({ hasMore: false, loadingOlder: false });
    await store.loadOlder();
    expect(fetches).toHaveLength(2);
  });

  test("resync saat memuat halaman lama: halaman lama dibuang, tombol muat tidak macet", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [stored(201), stored(202)], hasMore: true });
    const older = store.loadOlder();
    realtime.send({ type: "resync" });
    expect(store.getSnapshot().loadingOlder).toBe(false);
    await answer(2, { events: [stored(900), stored(901)], hasMore: true });
    // Halaman lama (sebelum 201) tiba setelah jendela diganti: tidak boleh menyisakan celah 202 → 900.
    await answer(1, { events: [stored(1), stored(200)], hasMore: false });
    await older;
    const snapshot = store.getSnapshot();
    expect(snapshot.events.map((event) => event.seq)).toEqual([900, 901]);
    expect(snapshot).toMatchObject({ hasMore: true, loadingOlder: false });
    const next = store.loadOlder();
    expect(fetches[3]?.query).toEqual({ before: 900, limit: 200 });
    await answer(3, { events: [stored(899)], hasMore: false });
    await next;
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([899, 900, 901]);
  });

  test("dua resync beruntun: hanya jendela terakhir yang dipakai", async () => {
    store.start();
    realtime.ready();
    await answer(0, { events: [stored(1)], hasMore: false });
    realtime.send({ type: "resync" });
    realtime.send({ type: "resync" });
    await answer(2, { events: [stored(900)], hasMore: false });
    await answer(1, { events: [stored(500)], hasMore: true });
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([900]);
    expect(store.getSnapshot().hasMore).toBe(false);
  });

  test("tanpa ready dalam 4 dtk, jendela tetap dimuat", async () => {
    store.start();
    timers.fire(READY_FALLBACK_MS);
    expect(fetches).toHaveLength(1);
    await answer(0, { events: [stored(1)], hasMore: false });
    expect(store.getSnapshot().phase).toBe("ready");
  });

  test("snapshot pertama gagal → error; topik ditolak → error", async () => {
    store.start();
    realtime.ready();
    fetches[0]?.reject(new Error("Aset tidak ditemukan."));
    await flush();
    expect(store.getSnapshot()).toMatchObject({ phase: "error", error: "Aset tidak ditemukan." });

    const other = new ThreadStore("a2", {
      realtime,
      schedule: timers.schedule,
      now: () => clock,
      fetchEvents: () => new Promise<EventsPage>(() => {}),
    });
    other.start();
    realtime.options.onError?.("Topik tidak dikenal.");
    expect(other.getSnapshot()).toMatchObject({ phase: "error", error: "Topik tidak dikenal." });
  });

  test("coba lagi setelah gagal memuat: memuat ulang jendela; tidak berbuat apa-apa bila tidak sedang error", async () => {
    store.start();
    realtime.ready();
    fetches[0]?.reject(new Error("Server sibuk."));
    await flush();
    expect(store.getSnapshot().phase).toBe("error");

    store.retry();
    expect(store.getSnapshot()).toMatchObject({ phase: "loading", error: null });
    await answer(1, { events: [stored(1)], hasMore: false });
    expect(store.getSnapshot()).toMatchObject({ phase: "ready", error: null });
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([1]);

    store.retry();
    expect(fetches).toHaveLength(2);
  });

  test("stop melepas langganan; jawaban fetch lama diabaikan; start ulang mulai dari awal", async () => {
    store.start();
    realtime.ready();
    store.stop();
    store.stop();
    expect(realtime.unsubscribed).toBe(1);
    await answer(0, { events: [stored(1)], hasMore: false });
    expect(store.getSnapshot().events).toEqual([]);
    store.start();
    expect(store.getSnapshot().phase).toBe("loading");
    realtime.ready();
    await answer(1, { events: [stored(1)], hasMore: false });
    expect(store.getSnapshot().events.map((event) => event.seq)).toEqual([1]);
  });
});

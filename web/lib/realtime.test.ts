import { beforeEach, describe, expect, test } from "bun:test";
import type { TopicEvent } from "../../shared/realtime.ts";
import {
  type ConnectionState,
  HANDSHAKE_MS,
  RealtimeClient,
  type RealtimeSocket,
  SILENCE_MS,
} from "./realtime.ts";

/** WebSocket tiruan: tes membuka, mengirim pesan server, dan menutupnya sendiri. */
class FakeSocket implements RealtimeSocket {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  fail(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

/** Timer tiruan: berjalan hanya saat tes memanggil `fire`. */
class FakeTimers {
  #next = 1;
  readonly pending = new Map<number, { run: () => void; ms: number }>();

  schedule = (run: () => void, ms: number): (() => void) => {
    const id = this.#next++;
    this.pending.set(id, { run, ms });
    return () => {
      this.pending.delete(id);
    };
  };

  /** Jalankan timer dengan durasi tertentu (mis. backoff atau senyap). */
  fire(ms: number): void {
    for (const [id, timer] of [...this.pending]) {
      if (timer.ms !== ms) continue;
      this.pending.delete(id);
      timer.run();
    }
  }

  delays(): number[] {
    return [...this.pending.values()].map((timer) => timer.ms).sort((a, b) => a - b);
  }
}

let sockets: FakeSocket[];
let timers: FakeTimers;
let client: RealtimeClient;

function latest(): FakeSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error("belum ada socket");
  return socket;
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  client = new RealtimeClient({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: timers.schedule,
    random: () => 0,
  });
});

const threadEvent = (seq: number): TopicEvent => ({
  type: "thread",
  stored: { assetId: "a1", seq, ts: 1, event: { type: "notice", text: `n${seq}` } },
});

describe("RealtimeClient", () => {
  test("menyambung saat langganan pertama, lalu mengirim sub dengan after", () => {
    expect(client.state).toBe("idle");
    client.subscribe("asset:a1", () => {}, { after: () => 7 });
    expect(sockets).toHaveLength(1);
    expect(client.state).toBe("connecting");
    latest().open();
    expect(client.state).toBe("open");
    expect(latest().sent).toEqual([{ op: "sub", sid: 1, topic: "asset:a1", after: 7 }]);
  });

  test("tanpa after tidak mengirim field after; langganan kedua langsung dikirim", () => {
    client.subscribe("global", () => {});
    latest().open();
    client.subscribe("asset:a1", () => {});
    expect(sockets).toHaveLength(1);
    expect(latest().sent).toEqual([
      { op: "sub", sid: 1, topic: "global" },
      { op: "sub", sid: 2, topic: "asset:a1" },
    ]);
  });

  test("meneruskan ready, event, dan error ke langganan yang tepat", () => {
    const events: TopicEvent[] = [];
    const log: string[] = [];
    client.subscribe("asset:a1", (event) => events.push(event), {
      onReady: () => log.push("ready"),
      onError: (message) => log.push(`error:${message}`),
    });
    client.subscribe("global", () => log.push("salah langganan"));
    latest().open();
    latest().receive({ sid: 1, op: "ready" });
    latest().receive({ sid: 1, event: threadEvent(3) });
    latest().receive({ sid: 1, error: "Aset tidak ditemukan." });
    latest().receive({ op: "hb" });
    expect(log).toEqual(["ready", "error:Aset tidak ditemukan."]);
    expect(events).toEqual([threadEvent(3)]);
  });

  test("pesan rusak atau tidak sesuai skema diabaikan", () => {
    const events: TopicEvent[] = [];
    client.subscribe("asset:a1", (event) => events.push(event));
    latest().open();
    latest().onmessage?.(new MessageEvent("message", { data: "{bukan json" }));
    latest().receive({ sid: 1, event: { type: "thread", stored: { seq: "x" } } });
    latest().receive({ sid: 99, event: threadEvent(1) });
    expect(events).toEqual([]);
  });

  test("putus → reconnecting, backoff naik, lalu sub dikirim ulang dengan after terbaru", () => {
    const states: ConnectionState[] = [];
    client.onState((state) => states.push(state));
    let after = 2;
    client.subscribe("asset:a1", () => {}, { after: () => after });
    latest().open();
    after = 9;
    latest().fail();
    expect(client.state).toBe("reconnecting");
    expect(timers.delays()).toEqual([500]);
    timers.fire(500);
    expect(sockets).toHaveLength(2);
    latest().fail();
    expect(timers.delays()).toEqual([1000]);
    timers.fire(1000);
    latest().open();
    expect(latest().sent).toEqual([{ op: "sub", sid: 1, topic: "asset:a1", after: 9 }]);
    expect(states).toEqual(["connecting", "open", "reconnecting", "open"]);
    // Setelah tersambung, backoff kembali ke awal.
    latest().fail();
    expect(timers.delays()).toEqual([500]);
  });

  test("backoff dibatasi 10 dtk ditambah jitter", () => {
    const jittered = new RealtimeClient({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: timers.schedule,
      random: () => 1,
    });
    jittered.subscribe("global", () => {});
    for (let attempt = 0; attempt < 6; attempt += 1) {
      latest().fail();
      const [delay] = timers.delays();
      if (delay === undefined) throw new Error("tidak ada jadwal");
      timers.fire(delay);
    }
    latest().fail();
    expect(timers.delays()).toEqual([13_000]);
  });

  test("senyap terlalu lama = sambungan mati diam-diam", () => {
    client.subscribe("global", () => {});
    latest().open();
    expect(timers.delays()).toEqual([SILENCE_MS]);
    latest().receive({ op: "hb" });
    // Pesan apa pun memasang ulang penjaga senyap (tetap satu timer).
    expect(timers.delays()).toEqual([SILENCE_MS]);
    timers.fire(SILENCE_MS);
    expect(latest().closed).toBe(true);
    expect(client.state).toBe("reconnecting");
  });

  test("unsub dikirim saat berhenti; tanpa langganan tidak menyambung ulang", () => {
    const stop = client.subscribe("global", () => {});
    latest().open();
    stop();
    stop();
    expect(latest().sent).toEqual([
      { op: "sub", sid: 1, topic: "global" },
      { op: "unsub", sid: 1 },
    ]);
    latest().fail();
    expect(timers.delays()).toEqual([]);
  });

  test("reconnectNow melewati sisa backoff", () => {
    client.subscribe("global", () => {});
    latest().fail();
    expect(sockets).toHaveLength(1);
    client.reconnectNow();
    expect(sockets).toHaveLength(2);
    expect(timers.delays()).toEqual([HANDSHAKE_MS]);
    // Percobaan yang masih menyambung (handshake bisa menggantung) dimulai ulang, bukan didiamkan.
    client.reconnectNow();
    expect(sockets).toHaveLength(3);
    expect(sockets[1]?.closed).toBe(true);
    expect(timers.delays()).toEqual([HANDSHAKE_MS]);
    // Saat sudah tersambung, reconnectNow tidak membuat sambungan kedua.
    latest().open();
    client.reconnectNow();
    expect(sockets).toHaveLength(3);
    expect(client.state).toBe("open");
  });

  test("handshake menggantung: percobaan dilepas setelah batas waktu, lalu dijadwalkan ulang", () => {
    client.subscribe("global", () => {});
    expect(timers.delays()).toEqual([HANDSHAKE_MS]);
    timers.fire(HANDSHAKE_MS);
    expect(sockets[0]?.closed).toBe(true);
    expect(client.state).toBe("reconnecting");
    expect(timers.delays()).toEqual([500]);
    timers.fire(500);
    latest().open();
    // Setelah terbuka, penjaga handshake diganti penjaga senyap.
    expect(timers.delays()).toEqual([SILENCE_MS]);
  });

  test("socket lama yang sudah dilepas tidak memengaruhi sambungan baru", () => {
    const events: TopicEvent[] = [];
    client.subscribe("asset:a1", (event) => events.push(event));
    const first = latest();
    first.open();
    first.fail();
    timers.fire(500);
    latest().open();
    first.receive({ sid: 1, event: threadEvent(1) });
    first.fail();
    expect(client.state).toBe("open");
    expect(events).toEqual([]);
  });

  test("gagal membuat socket dijadwalkan ulang", () => {
    let fail = true;
    const flaky = new RealtimeClient({
      createSocket: () => {
        if (fail) throw new Error("tidak bisa");
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      schedule: timers.schedule,
      random: () => 0,
    });
    flaky.subscribe("global", () => {});
    expect(flaky.state).toBe("reconnecting");
    fail = false;
    timers.fire(500);
    expect(sockets).toHaveLength(1);
  });
});

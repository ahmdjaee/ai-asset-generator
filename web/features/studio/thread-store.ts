/**
 * Thread satu aset (port logika ai-team `web/useTaskThread.ts`), di luar React supaya bisa dites tanpa timer sungguhan.
 *
 * Urutannya: langganan `asset:<id>` dipasang dulu. Snapshot HTTP baru diambil saat server mengirim `ready`, jadi tidak
 * ada event yang jatuh di antara keduanya. Saat sambungan pulih, langganan dikirim ulang dengan `after` = seq tersimpan
 * terakhir, dan server me-replay yang terlewat. Event ganda disaring lewat `seq`.
 *
 * Event live (`delta`, `build_progress`) tidak disimpan server. Delta ditampung dan dikeluarkan paling sering tiap
 * `STREAM_FLUSH_MS`, bukan per token.
 */

import type { RealtimeClient, Schedule } from "@/lib/realtime.ts";
import type { StoredEvent } from "../../../shared/asset-events.ts";
import { type BuildPhase, phaseOfStep } from "../../../shared/build-steps.ts";
import { EVENTS_PAGE_DEFAULT } from "../../../shared/limits.ts";
import type { TopicEvent } from "../../../shared/realtime.ts";

/** Event tersimpan: selalu punya seq. */
export type ThreadEvent = StoredEvent & Readonly<{ seq: number }>;

export type EventsPage = Readonly<{ events: readonly StoredEvent[]; hasMore: boolean }>;

/**
 * Progres build live. `phases` = waktu (jam klien) bagian build pertama kali terlihat, untuk lama tiap langkah di kartu
 * progres. Setelah muat ulang di tengah build, bagian yang sudah lewat tidak punya waktu.
 */
export type LiveBuild = Readonly<{
  step: string;
  pct: number;
  phases: Readonly<Partial<Record<Exclude<BuildPhase, "script">, number>>>;
}>;

export type ThreadSnapshot = Readonly<{
  /** `loading` sampai snapshot pertama tiba; `error` bila snapshot pertama gagal. */
  phase: "loading" | "ready" | "error";
  error: string | null;
  /** Aset dihapus (dari tab ini atau tab lain) selagi terbuka. */
  deleted: boolean;
  events: readonly ThreadEvent[];
  /** Teks dan ringkasan berpikir yang sedang di-stream, sebelum event tersimpannya tiba. */
  streaming: Readonly<{ text: string; thinking: string }>;
  /** Progres build yang sedang berjalan, per `jobId` (event live). */
  builds: Readonly<Record<string, LiveBuild>>;
  /** Masih ada event lebih lama di server. */
  hasMore: boolean;
  loadingOlder: boolean;
}>;

export type ThreadStoreDeps = Readonly<{
  realtime: Pick<RealtimeClient, "subscribe">;
  fetchEvents: (query: Readonly<{ before?: number; limit?: number }>) => Promise<EventsPage>;
  schedule: Schedule;
  now: () => number;
  /** Dipanggil untuk setiap event tersimpan yang baru (live atau replay), mis. untuk menyegarkan detail aset. */
  onStored?: (event: ThreadEvent) => void;
}>;

/** Token streaming ditampung dan dikeluarkan maksimal 10× per detik. */
export const STREAM_FLUSH_MS = 100;
/** Tanpa `ready` dari WebSocket (mis. proxy belum meneruskan Upgrade), isi thread tetap dimuat, hanya tidak live. */
export const READY_FALLBACK_MS = 4_000;
export const OLDER_PAGE = EVENTS_PAGE_DEFAULT;

const EMPTY_STREAM = { text: "", thinking: "" } as const;

const INITIAL: ThreadSnapshot = {
  phase: "loading",
  error: null,
  deleted: false,
  events: [],
  streaming: EMPTY_STREAM,
  builds: {},
  hasMore: false,
  loadingOlder: false,
};

function isStored(event: StoredEvent): event is ThreadEvent {
  return event.seq !== null;
}

/** Gabungkan event ke daftar urut-seq: event yang sudah ada dilewati. Daftar yang sama dikembalikan bila tidak berubah. */
export function mergeEvents(
  previous: readonly ThreadEvent[],
  incoming: readonly ThreadEvent[],
): readonly ThreadEvent[] {
  const last = previous.at(-1)?.seq ?? 0;
  const [only] = incoming;
  // Jalur cepat untuk event live: lebih baru dari semua yang ada → cukup ditempel.
  if (incoming.length === 1 && only !== undefined && only.seq > last) return [...previous, only];
  const bySeq = new Map(previous.map((event) => [event.seq, event]));
  let changed = false;
  for (const event of incoming) {
    if (bySeq.has(event.seq)) continue;
    bySeq.set(event.seq, event);
    changed = true;
  }
  if (!changed) return previous;
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class ThreadStore {
  readonly #assetId: string;
  readonly #deps: ThreadStoreDeps;
  readonly #listeners = new Set<() => void>();
  #snapshot: ThreadSnapshot = INITIAL;
  /** Generasi `start()`; jawaban fetch dari generasi lama diabaikan. */
  #generation = 0;
  /**
   * Generasi jendela event, naik setiap kali jendela diganti (`resync`). Jendela dan halaman lama yang diminta untuk
   * jendela sebelumnya diabaikan; tanpa ini halaman itu tergabung dan meninggalkan celah seq yang tidak pernah terisi.
   */
  #window = 0;
  #active = false;
  /** Jendela awal sudah digabung, jadi `lastSeq` sah dipakai sebagai `after`. */
  #baseline = false;
  #ready = false;
  /** `after` yang dikirim di langganan terakhir; `undefined` = server tidak me-replay apa pun. */
  #sentAfter: number | undefined;
  #buffer = { text: "", thinking: "" };
  #cancelFlush: (() => void) | null = null;
  #cancelFallback: (() => void) | null = null;
  #unsubscribe: (() => void) | null = null;

  constructor(assetId: string, deps: ThreadStoreDeps) {
    this.#assetId = assetId;
    this.#deps = deps;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ThreadSnapshot => this.#snapshot;

  /** Mulai menyimak. Aman dipanggil ulang setelah `stop()` (StrictMode memasang efek dua kali). */
  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#generation += 1;
    this.#baseline = false;
    this.#ready = false;
    this.#sentAfter = undefined;
    this.#set(INITIAL);
    const generation = this.#generation;
    this.#unsubscribe = this.#deps.realtime.subscribe(
      `asset:${this.#assetId}`,
      (event) => this.#onEvent(event),
      {
        after: () => {
          this.#sentAfter = this.#baseline ? this.#lastSeq() : undefined;
          return this.#sentAfter;
        },
        onReady: () => {
          if (!this.#active || generation !== this.#generation) return;
          this.#ready = true;
          // Dengan `after`, server sudah me-replay yang terlewat. Tanpa `after` tidak ada replay: jendela diambil
          // sesudah `ready`, jadi event di antaranya tetap tertangkap langganan.
          if (this.#sentAfter === undefined) this.#loadWindow(false);
        },
        onError: (error) => {
          if (this.#active && generation === this.#generation && !this.#baseline) {
            this.#set({ ...this.#snapshot, phase: "error", error });
          }
        },
      },
    );
    this.#cancelFallback = this.#deps.schedule(() => {
      this.#cancelFallback = null;
      if (this.#active && !this.#ready && !this.#baseline) this.#loadWindow(false);
    }, READY_FALLBACK_MS);
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#cancelFallback?.();
    this.#cancelFallback = null;
    this.#clearStream();
  }

  /** Mengambil ulang jendela event setelah gagal dimuat (tombol "Coba lagi" di thread). */
  retry(): void {
    if (!this.#active || this.#snapshot.phase !== "error") return;
    this.#set({ ...this.#snapshot, phase: "loading", error: null });
    this.#loadWindow(false);
  }

  /** Muat halaman event sebelum event tertua yang dimiliki. */
  async loadOlder(): Promise<void> {
    const oldest = this.#snapshot.events[0]?.seq;
    if (!this.#active || this.#snapshot.loadingOlder || oldest === undefined || !this.#snapshot.hasMore)
      return;
    const current = this.#current();
    this.#set({ ...this.#snapshot, loadingOlder: true });
    try {
      const page = await this.#deps.fetchEvents({ before: oldest, limit: OLDER_PAGE });
      if (!current()) return;
      this.#set({
        ...this.#snapshot,
        events: mergeEvents(this.#snapshot.events, page.events.filter(isStored)),
        hasMore: page.hasMore,
        loadingOlder: false,
      });
    } catch (cause) {
      if (!current()) return;
      this.#set({ ...this.#snapshot, loadingOlder: false });
      throw cause;
    }
  }

  /** Penanda permintaan: `true` selama store masih menyimak generasi dan jendela yang sama seperti saat meminta. */
  #current(): () => boolean {
    const generation = this.#generation;
    const window = this.#window;
    return () => this.#active && generation === this.#generation && window === this.#window;
  }

  #set(next: ThreadSnapshot): void {
    if (next === this.#snapshot) return;
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  #lastSeq(): number {
    return this.#snapshot.events.at(-1)?.seq ?? 0;
  }

  #loadWindow(reset: boolean): void {
    // Dikosongkan SEBELUM mengambil jendela: event live yang datang selama fetch ikut tergabung.
    if (reset) {
      this.#window += 1;
      this.#set({ ...this.#snapshot, events: [], hasMore: false, loadingOlder: false });
    }
    const current = this.#current();
    this.#deps
      .fetchEvents({ limit: EVENTS_PAGE_DEFAULT })
      .then((page) => {
        if (!current()) return;
        const events = page.events.filter(isStored);
        this.#baseline = true;
        this.#set({
          ...this.#snapshot,
          phase: "ready",
          error: null,
          events: mergeEvents(this.#snapshot.events, events),
          hasMore: page.hasMore,
        });
      })
      .catch((cause: unknown) => {
        if (!current() || this.#baseline) return;
        this.#set({ ...this.#snapshot, phase: "error", error: message(cause) });
      });
  }

  #onEvent(event: TopicEvent): void {
    if (!this.#active) return;
    if (event.type === "asset_deleted") {
      this.#set({ ...this.#snapshot, deleted: true });
      return;
    }
    if (event.type === "resync") {
      // Tertinggal terlalu jauh untuk di-replay: ganti dengan jendela terbaru.
      this.#baseline = false;
      this.#loadWindow(true);
      return;
    }
    if (event.type !== "thread") return;
    const { stored } = event;
    if (!isStored(stored)) {
      this.#onLive(stored);
      return;
    }
    this.#onStored(stored);
  }

  #onLive(stored: StoredEvent): void {
    const { event } = stored;
    if (event.type === "delta") {
      this.#buffer = { ...this.#buffer, [event.kind]: this.#buffer[event.kind] + event.text };
      this.#cancelFlush ??= this.#deps.schedule(() => {
        this.#cancelFlush = null;
        if (this.#active) this.#set({ ...this.#snapshot, streaming: { ...this.#buffer } });
      }, STREAM_FLUSH_MS);
      return;
    }
    if (event.type === "build_progress") {
      const previous = this.#snapshot.builds[event.jobId];
      const phase = phaseOfStep(event.step);
      const phases = previous?.phases ?? {};
      const build: LiveBuild = {
        step: event.step,
        pct: event.pct,
        phases: phase in phases ? phases : { ...phases, [phase]: this.#deps.now() },
      };
      this.#set({ ...this.#snapshot, builds: { ...this.#snapshot.builds, [event.jobId]: build } });
    }
  }

  #onStored(stored: ThreadEvent): void {
    const events = mergeEvents(this.#snapshot.events, [stored]);
    if (events === this.#snapshot.events) return;
    const { event } = stored;
    let { streaming, builds } = this.#snapshot;
    // Event tersimpan menggantikan isi stream-nya.
    if (event.type === "assistant") streaming = this.#takeStream("text");
    if (event.type === "thinking") streaming = this.#takeStream("thinking");
    if (event.type === "result") {
      this.#clearStream();
      streaming = EMPTY_STREAM;
      builds = {};
    }
    if (event.type === "build_finished") {
      const { [event.jobId]: _finished, ...rest } = builds;
      builds = rest;
    }
    this.#set({ ...this.#snapshot, events, streaming, builds });
    this.#deps.onStored?.(stored);
  }

  /** Kosongkan satu jenis stream (teksnya sudah tersimpan sebagai event). */
  #takeStream(kind: "text" | "thinking"): ThreadSnapshot["streaming"] {
    this.#buffer = { ...this.#buffer, [kind]: "" };
    return { ...this.#snapshot.streaming, [kind]: "" };
  }

  #clearStream(): void {
    this.#cancelFlush?.();
    this.#cancelFlush = null;
    this.#buffer = { text: "", thinking: "" };
  }
}

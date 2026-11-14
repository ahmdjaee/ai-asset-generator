/**
 * Klien realtime: satu WebSocket per tab untuk seluruh app (port ai-team `web/realtime.ts`). Protokolnya di
 * `shared/realtime.ts`.
 * - Dibuka saat langganan pertama, lalu menyambung ulang sendiri: backoff 0,5 → 10 dtk + jitter.
 * - Setiap kali tersambung, semua langganan dikirim ulang dengan `after()` terbaru milik masing-masing, jadi server
 *   me-replay event yang terlewat.
 * - Server mengirim `hb` tiap 25 dtk. Tanpa pesan apa pun selama `SILENCE_MS` berarti sambungan mati diam-diam, dan
 *   klien menyambung ulang. Handshake yang tidak selesai dalam `HANDSHAKE_MS` (server macet) juga dilepas.
 * - Pesan server divalidasi zod. Pesan yang tidak sesuai skema diabaikan.
 */
import { WS_HEARTBEAT_MS } from "../../shared/limits.ts";
import { type ClientMessage, REALTIME_PATH, ServerMessage, type TopicEvent } from "../../shared/realtime.ts";

const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 10_000;
/** Lebih dari dua kali selang heartbeat tanpa pesan = sambungan dianggap mati. */
export const SILENCE_MS = WS_HEARTBEAT_MS * 2 + 10_000;
/** Batas waktu sampai `onopen`; percobaan yang menggantung lebih lama dilepas dan dijadwalkan ulang. */
export const HANDSHAKE_MS = 10_000;

/** Bagian WebSocket yang dipakai klien. `WebSocket` browser memenuhinya; tes memakai tiruan. */
export type RealtimeSocket = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(): void;
};

/** Menjadwalkan `run` setelah `ms`; hasilnya fungsi pembatal. */
export type Schedule = (run: () => void, ms: number) => () => void;

export type RealtimeDeps = Readonly<{
  createSocket: () => RealtimeSocket;
  schedule: Schedule;
  /** 0..1, untuk jitter backoff. */
  random: () => number;
}>;

/**
 * - `idle`: belum pernah menyambung (belum ada langganan);
 * - `connecting`: percobaan pertama;
 * - `open`: tersambung;
 * - `reconnecting`: sambungan putus atau percobaan gagal, menunggu sambungan baru. Banner sambung ulang tampil di sini.
 */
export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting";

export type SubscribeOptions = Readonly<{
  /** Seq tersimpan terakhir yang sudah dimiliki; server me-replay sesudahnya. Dibaca setiap kali (ulang) berlangganan. */
  after?: () => number | undefined;
  /** Langganan terpasang di server, juga setelah sambung ulang. Snapshot HTTP yang diambil sesudah ini tidak berlubang. */
  onReady?: () => void;
  /** Topik ditolak server (mis. aset tidak ada). */
  onError?: (message: string) => void;
}>;

type Subscription = SubscribeOptions & {
  readonly sid: number;
  readonly topic: string;
  readonly onEvent: (event: TopicEvent) => void;
};

const OPEN = 1;

export class RealtimeClient {
  readonly #deps: RealtimeDeps;
  readonly #subscriptions = new Map<number, Subscription>();
  readonly #listeners = new Set<(state: ConnectionState) => void>();
  #socket: RealtimeSocket | null = null;
  #state: ConnectionState = "idle";
  #nextSid = 1;
  #attempt = 0;
  #cancelRetry: (() => void) | null = null;
  #cancelSilence: (() => void) | null = null;

  constructor(deps: RealtimeDeps) {
    this.#deps = deps;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** Berlangganan satu topik. Hasilnya fungsi untuk berhenti. */
  subscribe(topic: string, onEvent: (event: TopicEvent) => void, options: SubscribeOptions = {}): () => void {
    const subscription: Subscription = { ...options, sid: this.#nextSid++, topic, onEvent };
    this.#subscriptions.set(subscription.sid, subscription);
    if (this.#state === "open") this.#sendSub(subscription);
    else this.#connect();
    return () => {
      if (!this.#subscriptions.delete(subscription.sid)) return;
      this.#write({ op: "unsub", sid: subscription.sid });
    };
  }

  /** Perubahan status sambungan (banner sambung ulang). Hasilnya fungsi untuk berhenti menyimak. */
  onState(listener: (state: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Kembali online, tab terlihat lagi, atau tombol "Sambungkan sekarang": jangan tunggu sisa backoff. Percobaan yang
   * masih menyambung dimulai ulang (handshake-nya bisa menggantung); sambungan yang sudah terbuka dibiarkan.
   */
  reconnectNow(): void {
    if (this.#subscriptions.size === 0) return;
    const socket = this.#socket;
    if (socket !== null) {
      if (socket.readyState === OPEN) return;
      this.#release(socket);
    }
    this.#clearRetry();
    this.#attempt = 0;
    this.#connect();
  }

  #setState(state: ConnectionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }

  #write(message: ClientMessage): void {
    if (this.#socket !== null && this.#socket.readyState === OPEN) this.#socket.send(JSON.stringify(message));
  }

  #sendSub(subscription: Subscription): void {
    const after = subscription.after?.();
    this.#write({
      op: "sub",
      sid: subscription.sid,
      topic: subscription.topic,
      ...(after === undefined ? {} : { after }),
    });
  }

  #connect(): void {
    if (this.#socket !== null || this.#cancelRetry !== null || this.#subscriptions.size === 0) return;
    let socket: RealtimeSocket;
    try {
      socket = this.#deps.createSocket();
    } catch {
      this.#setState("reconnecting");
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    if (this.#state === "idle") this.#setState("connecting");
    this.#armSilence(socket, HANDSHAKE_MS);
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#attempt = 0;
      this.#armSilence(socket, SILENCE_MS);
      this.#setState("open");
      for (const subscription of this.#subscriptions.values()) this.#sendSub(subscription);
    };
    socket.onmessage = (event) => {
      if (this.#socket !== socket) return;
      this.#armSilence(socket, SILENCE_MS);
      this.#handle(event.data);
    };
    socket.onclose = () => this.#drop(socket);
    socket.onerror = () => this.#drop(socket);
  }

  #handle(data: unknown): void {
    if (typeof data !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ServerMessage.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;
    if (!("sid" in message)) return;
    const subscription = this.#subscriptions.get(message.sid);
    if (subscription === undefined) return;
    if ("event" in message) subscription.onEvent(message.event);
    else if ("error" in message) subscription.onError?.(message.error);
    else subscription.onReady?.();
  }

  /** Penjaga sambungan: tanpa `onopen` (handshake) atau tanpa pesan (senyap) selama `ms`, sambungan dilepas. */
  #armSilence(socket: RealtimeSocket, ms: number): void {
    this.#cancelSilence?.();
    this.#cancelSilence = this.#deps.schedule(() => {
      this.#cancelSilence = null;
      this.#drop(socket);
    }, ms);
  }

  /** Lepas sambungan ini (mati, diam, atau ditutup) dan jadwalkan sambungan baru. */
  #drop(socket: RealtimeSocket): void {
    if (this.#socket !== socket) return;
    this.#release(socket);
    this.#setState("reconnecting");
    this.#scheduleReconnect();
  }

  /** Lepas sambungan ini tanpa menjadwalkan yang baru: handler dilepas, penjaga dibatalkan, socket ditutup. */
  #release(socket: RealtimeSocket): void {
    this.#socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    this.#cancelSilence?.();
    this.#cancelSilence = null;
    try {
      socket.close();
    } catch {
      // Sudah tertutup.
    }
  }

  #scheduleReconnect(): void {
    if (this.#cancelRetry !== null || this.#subscriptions.size === 0) return;
    const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.#attempt);
    this.#attempt += 1;
    this.#cancelRetry = this.#deps.schedule(
      () => {
        this.#cancelRetry = null;
        this.#connect();
      },
      base + this.#deps.random() * base * 0.3,
    );
  }

  #clearRetry(): void {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
  }
}

function socketUrl(): string {
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${REALTIME_PATH}`;
}

/** Klien bersama app: WebSocket browser, timer sungguhan, dan sambung ulang saat online atau tab terlihat lagi. */
function browserClient(): RealtimeClient {
  const client = new RealtimeClient({
    createSocket: () => new WebSocket(socketUrl()),
    schedule: (run, ms) => {
      const handle = setTimeout(run, ms);
      return () => clearTimeout(handle);
    },
    random: Math.random,
  });
  window.addEventListener("online", () => client.reconnectNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") client.reconnectNow();
  });
  return client;
}

let shared: RealtimeClient | null = null;

/** Satu klien per tab, dibuat saat pertama dipakai. */
export function realtime(): RealtimeClient {
  shared ??= browserClient();
  return shared;
}

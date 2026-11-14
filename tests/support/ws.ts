/**
 * Klien WebSocket untuk tes: pesan server divalidasi skema bersama (`shared/realtime.ts`) dan ditunggu lewat
 * predikat, tanpa sleep dan tanpa polling.
 */
import type { StoredEvent } from "../../shared/asset-events.ts";
import { ServerMessage } from "../../shared/realtime.ts";

export type Outcome = { kind: "open" } | { kind: "closed"; code: number } | { kind: "error" };

export class TestSocket {
  readonly socket: WebSocket;
  readonly received: ServerMessage[] = [];
  readonly opened: Promise<Outcome>;
  readonly closed: Promise<number>;
  #waiters: Array<{ check: () => boolean; resolve: () => void }> = [];

  constructor(url: string, headers: Record<string, string> = {}) {
    this.socket = new WebSocket(url, { headers });
    this.opened = new Promise((resolve) => {
      this.socket.addEventListener("open", () => resolve({ kind: "open" }));
      this.socket.addEventListener("error", () => resolve({ kind: "error" }));
      this.socket.addEventListener("close", (event) => resolve({ kind: "closed", code: event.code }));
    });
    this.closed = new Promise((resolve) => {
      this.socket.addEventListener("close", (event) => resolve(event.code));
    });
    this.socket.addEventListener("message", (event) => {
      this.received.push(ServerMessage.parse(JSON.parse(String(event.data))));
      this.#waiters = this.#waiters.filter((waiter) => {
        if (!waiter.check()) return true;
        waiter.resolve();
        return false;
      });
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Menunggu sampai pesan yang sudah diterima memenuhi kondisi. */
  until(check: (received: readonly ServerMessage[]) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const waiter = { check: () => check(this.received), resolve };
      if (waiter.check()) resolve();
      else this.#waiters.push(waiter);
    });
  }

  ready(sid: number): Promise<void> {
    return this.until((received) =>
      received.some(
        (message) => "op" in message && message.op === "ready" && "sid" in message && message.sid === sid,
      ),
    );
  }

  /** Event thread (tersimpan dan live) satu langganan, dalam urutan diterima. */
  thread(sid: number): StoredEvent[] {
    return this.received.flatMap((message) =>
      "sid" in message && message.sid === sid && "event" in message && message.event.type === "thread"
        ? [message.event.stored]
        : [],
    );
  }

  /** seq event tersimpan satu langganan, dalam urutan diterima; `ready` ditandai. */
  timeline(sid: number): Array<number | "ready"> {
    return this.received.flatMap((message): Array<number | "ready"> => {
      if (!("sid" in message) || message.sid !== sid) return [];
      if ("op" in message) return ["ready"];
      if ("event" in message && message.event.type === "thread" && message.event.stored.seq !== null) {
        return [message.event.stored.seq];
      }
      return [];
    });
  }
}

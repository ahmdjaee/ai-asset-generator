import type { ConnectionState, SubscribeOptions } from "@/lib/realtime.ts";
import type { RealtimePort } from "@/lib/realtime-context.tsx";
import type { TopicEvent } from "../shared/realtime.ts";

type Subscription = Readonly<{
  topic: string;
  onEvent: (event: TopicEvent) => void;
  options: SubscribeOptions;
}>;

/**
 * Klien realtime tiruan untuk tes komponen dan halaman (tanpa WebSocket): tes memicu `ready`, event, dan perubahan
 * status sambungan sendiri.
 */
export class FakeRealtime implements RealtimePort {
  state: ConnectionState = "open";
  reconnects = 0;
  readonly #subscriptions = new Set<Subscription>();
  readonly #listeners = new Set<(state: ConnectionState) => void>();

  subscribe(topic: string, onEvent: (event: TopicEvent) => void, options: SubscribeOptions = {}): () => void {
    const subscription: Subscription = { topic, onEvent, options };
    this.#subscriptions.add(subscription);
    return () => {
      this.#subscriptions.delete(subscription);
    };
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  reconnectNow(): void {
    this.reconnects += 1;
  }

  /** Topik yang sedang disimak. */
  topics(): string[] {
    return Array.from(this.#subscriptions, (subscription) => subscription.topic);
  }

  /** Server memasang langganan topik ini (seperti setelah (sambung ulang)). */
  ready(topic: string): void {
    for (const subscription of this.#matching(topic)) {
      subscription.options.after?.();
      subscription.options.onReady?.();
    }
  }

  emit(topic: string, event: TopicEvent): void {
    for (const subscription of this.#matching(topic)) subscription.onEvent(event);
  }

  setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.#listeners) listener(state);
  }

  #matching(topic: string): Subscription[] {
    return Array.from(this.#subscriptions).filter((subscription) => subscription.topic === topic);
  }
}

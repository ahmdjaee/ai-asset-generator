/**
 * Saluran event in-process (port dari ai-team `server/agent/bus.ts`): topik per aset dan topik global.
 * Hidup terpisah dari runner, supaya penyimak (hub WebSocket di Tahap 6) tetap bisa mengikuti aset yang sesi Claude-nya
 * sedang tidak berjalan. Penyimak yang error tidak boleh menjatuhkan pengirim.
 */
import type { StoredEvent } from "../../shared/asset-events.ts";
import type { BuildStage } from "../../shared/asset-list.ts";
import type { AssetChange } from "../../shared/realtime.ts";

/**
 * Topik `global` untuk Gudang: daftar aset berubah, atau progres build yang sedang berjalan (live, boleh dibuang saat
 * sambungan padat; nilai terakhir juga ada di daftar aset).
 */
export type GlobalEvent =
  | Readonly<{ type: "asset"; assetId: string; change: AssetChange }>
  | Readonly<{ type: "progress"; assetId: string; stage: BuildStage; pct: number }>;

export class EventBus {
  readonly #listeners = new Map<string, Set<(event: StoredEvent) => void>>();
  readonly #global = new Set<(event: GlobalEvent) => void>();
  readonly #onError: (error: unknown) => void;

  constructor(options: { onError?: (error: unknown) => void } = {}) {
    this.#onError = options.onError ?? (() => undefined);
  }

  subscribe(assetId: string, listener: (event: StoredEvent) => void): () => void {
    let set = this.#listeners.get(assetId);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(assetId, set);
    }
    const listeners = set;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(assetId);
    };
  }

  subscribeGlobal(listener: (event: GlobalEvent) => void): () => void {
    this.#global.add(listener);
    return () => this.#global.delete(listener);
  }

  publish(event: StoredEvent): void {
    for (const listener of [...(this.#listeners.get(event.assetId) ?? [])])
      this.#safely(() => listener(event));
  }

  publishGlobal(event: GlobalEvent): void {
    for (const listener of [...this.#global]) this.#safely(() => listener(event));
  }

  #safely(call: () => void): void {
    try {
      call();
    } catch (error) {
      this.#onError(error);
    }
  }
}

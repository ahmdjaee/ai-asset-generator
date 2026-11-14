/**
 * Status dan thread satu aset di database.
 * - `AssetStore.apply`: muat → `transition()` → simpan status + event `state` dalam SATU transaksi, lalu siarkan
 *   setelah commit. Tool `forge` dan service aset sama-sama memakai jalur ini (AGENTS.md §3).
 * - `EventLog.record`: event thread disimpan (kecuali event live) lalu disiarkan.
 */

import {
  type AssetEvent,
  type AssetStateEvent,
  isLiveOnly,
  type StoredEvent,
} from "../../shared/asset-events.ts";
import type { AssetStats } from "../../shared/asset-stats.ts";
import type { TierBudget, TierId } from "../../shared/limits.ts";
import type { Db } from "../db/client.ts";
import { getAsset, saveAssetState } from "../db/repos/assets.ts";
import { appendEvent } from "../db/repos/events.ts";
import { transact } from "../db/repos/executor.ts";
import { insertVersion } from "../db/repos/versions.ts";
import {
  type AssetAction,
  type AssetState,
  type AssetStateStore,
  buildsLeft,
  type TransitionResult,
  transition,
} from "../domain/status.ts";
import type { EventBus } from "./bus.ts";
import { assetNotFound } from "./errors.ts";

/** Jam yang disuntikkan (ms epoch). */
export type Clock = () => number;

/** Identitas kerja satu aset: folder dan snapshot tier (tidak berubah selama aset hidup). */
export type AssetWorkspace = Readonly<{
  id: string;
  /** `data/assets/<id>`: berisi `work/`, `refs/`, `versions/`, `derived/`. */
  assetDir: string;
  tierId: TierId;
  /** Snapshot budget saat aset dibuat; tidak ikut berubah bila budget global diubah. */
  tier: TierBudget;
}>;

export type StoreDeps = Readonly<{ db: Db; bus: EventBus; now: Clock }>;

export function stateEvent(state: AssetState): AssetStateEvent {
  return {
    type: "state",
    status: state.status,
    runState: state.runState,
    lastError: state.lastError,
    approvedBaseVersion: state.approvedBaseVersion,
    currentVersion: state.currentVersion,
    buildsLeft: buildsLeft(state),
  };
}

function sameState(a: AssetStateEvent, b: AssetStateEvent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class EventLog {
  readonly #deps: StoreDeps;

  constructor(deps: StoreDeps) {
    this.#deps = deps;
  }

  /** Menyimpan event (kecuali live) lalu menyiarkannya. */
  record(assetId: string, event: AssetEvent): StoredEvent {
    const ts = this.#deps.now();
    const stored: StoredEvent = isLiveOnly(event)
      ? { assetId, seq: null, ts, event }
      : appendEvent(this.#deps.db, assetId, event, ts);
    this.#deps.bus.publish(stored);
    return stored;
  }
}

/** Ringkasan versi untuk indeks database (isi lengkapnya tetap di folder versi). */
export type VersionEntry = Readonly<{
  version: number;
  stage: "base" | "textured";
  stats: AssetStats;
  budget: unknown;
  manifest: unknown;
}>;

export class AssetStore implements AssetStateStore {
  readonly assetId: string;
  readonly #deps: StoreDeps;

  constructor(deps: StoreDeps, assetId: string) {
    this.#deps = deps;
    this.assetId = assetId;
  }

  read(): AssetState {
    const asset = getAsset(this.#deps.db, this.assetId);
    if (asset === null) throw assetNotFound(this.assetId);
    return asset.state;
  }

  apply(action: AssetAction): TransitionResult {
    let published: StoredEvent | undefined;
    const result = transact(this.#deps.db, (tx) => {
      const asset = getAsset(tx, this.assetId);
      if (asset === null) throw assetNotFound(this.assetId);
      const outcome = transition(asset.state, action);
      if (!outcome.ok) return outcome;
      const now = this.#deps.now();
      saveAssetState(tx, this.assetId, outcome.state, now);
      const after = stateEvent(outcome.state);
      if (!sameState(stateEvent(asset.state), after)) published = appendEvent(tx, this.assetId, after, now);
      return outcome;
    });
    if (published !== undefined) {
      this.#deps.bus.publish(published);
      this.#deps.bus.publishGlobal({ type: "asset", assetId: this.assetId, change: "updated" });
    }
    return result;
  }

  /** Mencatat versi baru di indeks database. Versi yang sudah tercatat tidak diubah. */
  recordVersion(entry: VersionEntry): void {
    insertVersion(this.#deps.db, {
      assetId: this.assetId,
      n: entry.version,
      stage: entry.stage,
      stats: entry.stats,
      budget: entry.budget,
      manifest: entry.manifest,
      createdAt: this.#deps.now(),
    });
  }
}

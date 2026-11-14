/**
 * Perangkat tes: database SQLite di memori dengan migrasi asli, satu aset, `AssetStore`, dan bus. Dipakai tes forge,
 * sesi aset, dan skenario service supaya gerbang diuji lewat repositori asli.
 */
import type { StoredEvent } from "../../shared/asset-events.ts";
import { DEFAULT_TIERS, type TierId } from "../../shared/limits.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { insertAsset } from "../db/repos/assets.ts";
import type { AssetState } from "../domain/status.ts";
import { AssetStore, type Clock } from "./asset-store.ts";
import { EventBus } from "./bus.ts";

/** Jam palsu: mulai dari `start`, maju hanya lewat `advance`. */
export function fakeClock(start = 1_800_000_000_000): Clock & { advance(ms: number): void } {
  let current = start;
  const clock = () => current;
  return Object.assign(clock, {
    advance(ms: number) {
      current += ms;
    },
  });
}

export type TestStore = Readonly<{
  handle: DatabaseHandle;
  bus: EventBus;
  store: AssetStore;
  /** Event `state` dan lainnya yang disiarkan untuk aset ini. */
  published: StoredEvent[];
}>;

export function openTestStore(
  options: { id?: string; tierId?: TierId; state?: AssetState; now?: Clock } = {},
): TestStore {
  const handle = openDatabase(":memory:");
  const bus = new EventBus({
    onError: (error) => {
      throw error;
    },
  });
  const now = options.now ?? fakeClock();
  const id = options.id ?? "a1";
  const tierId = options.tierId ?? "sedang";
  insertAsset(handle.db, {
    id,
    name: "Aset tes",
    prompt: "peti kayu",
    tierId,
    tier: DEFAULT_TIERS[tierId],
    now: now(),
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  const published: StoredEvent[] = [];
  bus.subscribe(id, (event) => published.push(event));
  return { handle, bus, store: new AssetStore({ db: handle.db, bus, now }, id), published };
}

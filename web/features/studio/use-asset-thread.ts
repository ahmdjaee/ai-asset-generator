import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useClock } from "@/lib/clock.tsx";
import { useRealtime } from "@/lib/realtime-context.tsx";
import type { AssetEvent } from "../../../shared/asset-events.ts";
import { assetKey, fetchEvents, mergeStateEvent } from "./queries.ts";
import { type ThreadSnapshot, ThreadStore } from "./thread-store.ts";

/** Event thread yang mengubah data detail aset: state digabung langsung, versi dan brief baru memuat ulang detail. */
export function applyThreadEvent(client: QueryClient, assetId: string, event: AssetEvent): void {
  switch (event.type) {
    case "state":
      mergeStateEvent(client, assetId, event);
      return;
    case "brief":
    case "submitted":
    case "build_finished":
      void client.invalidateQueries({ queryKey: assetKey(assetId) });
      return;
    default:
      return;
  }
}

/**
 * Thread satu aset: snapshot `ThreadStore` (langganan WebSocket + jendela event HTTP). Pemakai memasang ulang komponen
 * (key) saat aset berganti, karena store dibuat sekali per pemasangan.
 */
export function useAssetThread(assetId: string): Readonly<{
  snapshot: ThreadSnapshot;
  loadOlder: () => Promise<void>;
  retry: () => void;
}> {
  const client = useQueryClient();
  const realtime = useRealtime();
  const clock = useClock();
  const [store] = useState(
    () =>
      new ThreadStore(assetId, {
        realtime,
        fetchEvents: (query) => fetchEvents(assetId, query),
        schedule: (run, ms) => clock.after(ms, run),
        now: () => clock.now(),
        onStored: (stored) => applyThreadEvent(client, assetId, stored.event),
      }),
  );
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const loadOlder = useCallback(() => store.loadOlder(), [store]);
  const retry = useCallback(() => store.retry(), [store]);
  return { snapshot, loadOlder, retry };
}

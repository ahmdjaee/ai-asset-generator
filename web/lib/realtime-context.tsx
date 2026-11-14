import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { type ConnectionState, type RealtimeClient, realtime } from "./realtime.ts";

/** Bagian klien realtime yang dipakai komponen. Tes memasang tiruan lewat `RealtimeProvider`. */
export type RealtimePort = Pick<RealtimeClient, "subscribe" | "onState" | "reconnectNow" | "state">;

const RealtimeContext = createContext<RealtimePort | null>(null);

export function RealtimeProvider({ client, children }: { client: RealtimePort; children: ReactNode }) {
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

/** Klien realtime: dari provider (tes), selain itu satu klien bersama per tab. */
export function useRealtime(): RealtimePort {
  return useContext(RealtimeContext) ?? realtime();
}

/** Keadaan sambungan WebSocket; banner sambung ulang tampil saat `reconnecting`. */
export function useConnectionState(): ConnectionState {
  const client = useRealtime();
  return useSyncExternalStore(
    (listener) => client.onState(listener),
    () => client.state,
  );
}

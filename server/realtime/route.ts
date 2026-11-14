import { upgradeWebSocket } from "@hono/bun";
import type { Hub, HubSocket } from "./hub.ts";

/**
 * `WSContext.raw` dari `@hono/bun` bertipe longgar (`UpgradeWebSocket<any>`); isinya `ServerWebSocket` Bun. Dicek di
 * sini supaya hub hanya menerima objek yang benar-benar punya `send`/`getBufferedAmount`/`close`.
 */
export function asHubSocket(raw: unknown): HubSocket | null {
  if (typeof raw !== "object" || raw === null) return null;
  const send: unknown = Reflect.get(raw, "send");
  const buffered: unknown = Reflect.get(raw, "getBufferedAmount");
  const close: unknown = Reflect.get(raw, "close");
  if (typeof send !== "function" || typeof buffered !== "function" || typeof close !== "function")
    return null;
  return {
    send: (data) => Number(Reflect.apply(send, raw, [data])),
    getBufferedAmount: () => Number(Reflect.apply(buffered, raw, [])),
    close: (code, reason) => {
      Reflect.apply(close, raw, [code, reason]);
    },
  };
}

function rawKey(raw: unknown): object | null {
  return typeof raw === "object" && raw !== null ? raw : null;
}

/**
 * Rute upgrade `/api/ws`. Pagar Host/Origin (`hostOriginGuard`) sudah berjalan sebelum handler ini, jadi upgrade
 * dari situs lain ditolak 403 tanpa pernah menjadi WebSocket. Batas ukuran pesan (`maxPayloadLength`) dan handler
 * `drain` dipasang di opsi `websocket` Bun (`main.ts`).
 */
export function realtimeRoute(hub: Hub) {
  return upgradeWebSocket(() => ({
    onOpen: (_event, ws) => {
      const key = rawKey(ws.raw);
      const socket = asHubSocket(ws.raw);
      if (key === null || socket === null) ws.close(1011, "sambungan tidak dikenal");
      else hub.open(key, socket);
    },
    onMessage: (event, ws) => {
      const key = rawKey(ws.raw);
      if (key !== null) hub.message(key, event.data);
    },
    onClose: (_event, ws) => {
      const key = rawKey(ws.raw);
      if (key !== null) hub.close(key);
    },
  }));
}

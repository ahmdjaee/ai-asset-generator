import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { ServerMessage } from "../../../shared/realtime.ts";

export type ProbeState = "connecting" | "subscribing" | "ok" | "failed";

const PROBE_SID = 1;

/**
 * Halaman uji: membuka WebSocket `/api/ws`, berlangganan topik `global`, lalu menunggu `ready` dari hub realtime.
 * Pesan server divalidasi dengan skema bersama (`shared/realtime.ts`).
 */
export function useRealtimeProbe(): ProbeState {
  const [state, setState] = useState<ProbeState>("connecting");

  useEffect(() => {
    let active = true;
    const socket = api.ws.$ws();
    const finish = (next: ProbeState) => {
      if (!active) return;
      active = false;
      setState(next);
    };
    socket.addEventListener("open", () => {
      if (!active) return;
      setState("subscribing");
      socket.send(JSON.stringify({ op: "sub", sid: PROBE_SID, topic: "global" }));
    });
    socket.addEventListener("message", (event) => {
      const parsed = ServerMessage.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) {
        finish("failed");
        return;
      }
      const message = parsed.data;
      if ("sid" in message && message.sid === PROBE_SID) {
        finish("op" in message && message.op === "ready" ? "ok" : "failed");
      }
    });
    socket.addEventListener("error", () => finish("failed"));
    socket.addEventListener("close", () => finish("failed"));

    return () => {
      active = false;
      // Menutup soket yang belum tersambung memicu error di console browser (terjadi di StrictMode dev),
      // jadi soket seperti itu ditutup segera setelah tersambung.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.close(), { once: true });
      } else {
        socket.close();
      }
    };
  }, []);

  return state;
}

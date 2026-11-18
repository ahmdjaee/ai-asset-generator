import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { invalidateHealth } from "@/lib/health.ts";
import { useRealtime } from "@/lib/realtime-context.tsx";
import { settingsKey } from "@/lib/settings.ts";
import type { TopicEvent } from "../../../shared/realtime.ts";

/** Event topik `global` untuk Pengaturan dan kesehatan; event lain diabaikan (milik `AssetWatcher`). */
export function applyStatusEvent(client: QueryClient, event: TopicEvent): void {
  if (event.type === "settings") void client.invalidateQueries({ queryKey: settingsKey });
  else if (event.type === "auth" || event.type === "runtime") invalidateHealth(client, event.type);
}

/**
 * Penyimak Pengaturan, status akun, dan status runtime untuk seluruh app. Topik global tidak di-replay, jadi setelah
 * (sambung ulang) terpasang ketiganya diambil ulang.
 */
export function StatusWatcher(): null {
  const client = useQueryClient();
  const realtime = useRealtime();
  useEffect(
    () =>
      realtime.subscribe("global", (event) => applyStatusEvent(client, event), {
        onReady: () => {
          void client.invalidateQueries({ queryKey: settingsKey });
          invalidateHealth(client, "auth");
          invalidateHealth(client, "runtime");
        },
      }),
    [client, realtime],
  );
  return null;
}

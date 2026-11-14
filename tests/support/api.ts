/**
 * Perangkat tes API: service asli dengan driver palsu (agent `fake`, runtime `fixture`), database SQLite di memori,
 * folder data sementara berisi pustaka material uji, dan app Hono. Tanpa Docker, tanpa kuota, tanpa jaringan.
 */
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestLibrary } from "../../server/agent/forge/test-builder.ts";
import { createApp } from "../../server/app.ts";
import { createServices, type Services } from "../../server/compose.ts";
import { type DatabaseHandle, openDatabase } from "../../server/db/client.ts";
import type { AssetRecord } from "../../server/db/repos/assets.ts";
import { createLogger } from "../../server/log.ts";
import { API_PORT, WEB_DEV_PORT } from "../../shared/ports.ts";

export type TestApi = Readonly<{
  app: ReturnType<typeof createApp>;
  services: Services;
  handle: DatabaseHandle;
  dataDir: string;
  close(): Promise<void>;
}>;

/** Menghapus folder tes; folder versi read-only (0555) dibuka dulu. */
export async function removeTree(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (info === null) return;
  if (info.isDirectory()) {
    await chmod(path, 0o755);
    for (const name of await readdir(path)) await removeTree(join(path, name));
  }
  await rm(path, { recursive: true, force: true });
}

export async function openTestApi(
  options: Readonly<{ allowedPorts?: readonly number[]; distDir?: string }> = {},
): Promise<TestApi> {
  const dataDir = await mkdtemp(join(tmpdir(), "aag-api-"));
  await createTestLibrary(join(dataDir, "library", "materials"));
  const handle = openDatabase(":memory:");
  const log = createLogger("silent");
  const services = await createServices({
    config: { dataDir, agentDriver: "fake", runtimeDriver: "fixture" },
    db: handle.db,
    log,
  });
  const app = createApp({
    log,
    allowedPorts: options.allowedPorts ?? [API_PORT, WEB_DEV_PORT],
    api: services,
    ...(options.distDir === undefined ? {} : { distDir: options.distDir }),
  });
  return {
    app,
    services,
    handle,
    dataDir,
    async close() {
      await services.close();
      handle.close();
      await removeTree(dataDir);
    },
  };
}

/** Menunggu sampai aset memenuhi kondisi; dicek setiap ada event aset itu (tanpa sleep, tanpa polling). */
export function untilAsset(
  services: Services,
  assetId: string,
  predicate: (record: AssetRecord) => boolean,
): Promise<AssetRecord> {
  return new Promise((resolve) => {
    let done = false;
    const unsubscribe = services.bus.subscribe(assetId, () => check());
    function check(): void {
      if (done) return;
      const record = services.assets.get(assetId);
      if (!predicate(record)) return;
      done = true;
      unsubscribe();
      resolve(record);
    }
    check();
  });
}

export const idleIn =
  (status: AssetRecord["state"]["status"]) =>
  (record: AssetRecord): boolean =>
    record.state.status === status && record.state.runState === "idle";

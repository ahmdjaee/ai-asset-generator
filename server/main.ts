import { existsSync } from "node:fs";
import { join } from "node:path";
import { websocket } from "@hono/bun";
import { HTTP_IDLE_TIMEOUT_S, UPLOAD_MAX_REQUEST_BYTES, WS_MAX_PAYLOAD_BYTES } from "../shared/limits.ts";
import { WEB_DEV_PORT } from "../shared/ports.ts";
import { createApp } from "./app.ts";
import { createServices } from "./compose.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { createLogger } from "./log.ts";
import { ownerForDataDir, removeOrphanJobs } from "./runtime/docker.ts";

const config = loadConfig();
const log = createLogger(config.logLevel);
const database = openDatabase(config.dbPath);
// Pemulihan saat start (job berjalan dibatalkan, aset → interrupted) terjadi di sini, sebelum server menerima request.
const services = await createServices({ config, db: database.db, log });

// Saat `bun run dev`, web dilayani Vite. Build hanya disajikan di mode production dan test.
const hasBuild = existsSync(join(config.distDir, "index.html"));
const distDir = config.mode !== "development" && hasBuild ? config.distDir : undefined;
if (config.mode === "production" && !hasBuild) {
  log.warn({ distDir: config.distDir }, "build web belum ada; jalankan `bun run build`");
}

const app = createApp({ log, allowedPorts: [config.port, WEB_DEV_PORT], distDir, api: services });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: HTTP_IDLE_TIMEOUT_S,
  // Sedikit di atas batas unggahan, supaya `bodyLimit` Hono yang menjawab (JSON 413), bukan Bun.
  maxRequestBodySize: UPLOAD_MAX_REQUEST_BYTES + 1024 * 1024,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    maxPayloadLength: WS_MAX_PAYLOAD_BYTES,
    // Adaptor `@hono/bun` tidak meneruskan `drain`; hub perlu tahu kapan antrean kirim kosong lagi.
    drain: (ws) => services.hub.drain(ws),
  },
});

log.info(
  {
    url: server.url.href,
    mode: config.mode,
    dataDir: config.dataDir,
    web: Boolean(distDir),
    agentDriver: config.agentDriver,
    runtimeDriver: config.runtimeDriver,
  },
  "server berjalan",
);

// Container job yang tertinggal (server mati di tengah job) dibersihkan saat start. Docker yang tidak tersedia
// tidak menghentikan server; status runtime dilaporkan terpisah (Tahap 11). Driver `fixture` tidak memakai Docker.
if (config.runtimeDriver === "docker") {
  void removeOrphanJobs(ownerForDataDir(config.dataDir))
    .then((removed) => {
      if (removed > 0) log.warn({ removed }, "container job yatim dihapus");
    })
    .catch((error: unknown) => log.warn({ err: error }, "gagal membersihkan container job yatim"));
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "server berhenti");
  // WebSocket ditutup dulu: `server.stop()` menunggu sambungan yang masih terbuka.
  services.hub.stop();
  await server.stop();
  await services.close();
  database.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      log.error({ err: error }, "gagal berhenti dengan rapi");
      process.exit(1);
    });
  });
}

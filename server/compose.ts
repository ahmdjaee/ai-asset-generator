/**
 * Akar komposisi: merakit service app dari konfigurasi. Satu-satunya tempat yang memilih driver:
 * - `AGENT_DRIVER`: `sdk` (Claude sungguhan, kuota pemilik) atau `fake` (skenario deterministik);
 * - `RUNTIME_DRIVER`: `docker` (Blender di sandbox + pipeline + Chromium) atau `fixture` (GLB siap pakai).
 * Dipakai `main.ts` dan tes. Pemulihan saat start (`recover()`) dijalankan di sini, sebelum aksi apa pun.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createAssetSession } from "./agent/asset-session.ts";
import { type AssetBuilder, DockerAssetBuilder } from "./agent/forge/builder.ts";
import { FIXTURE_PAIR, FixtureAssetBuilder } from "./agent/forge/fixture-builder.ts";
import { AgentPool } from "./agent/pool.ts";
import type { AgentPort } from "./agent/port.ts";
import { ScenarioAgentPort } from "./agent/scenario-port.ts";
import { defaultScenario } from "./agent/scenarios.ts";
import { sdkAgentPort } from "./agent/sdk-adapter.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db/client.ts";
import { HeavyLane } from "./jobs/heavy-lane.ts";
import { MaterialLibrary } from "./library/materials.ts";
import type { Logger } from "./log.ts";
import { Hub } from "./realtime/hub.ts";
import { Renderer } from "./render/renderer.ts";
import { ownerForDataDir } from "./runtime/docker.ts";
import { runtimeImageTag } from "./runtime/image.ts";
import { AssetQueries } from "./services/asset-queries.ts";
import type { Clock } from "./services/asset-store.ts";
import { AssetService } from "./services/assets.ts";
import { EventBus } from "./services/bus.ts";
import { ExportService } from "./services/exports.ts";
import { ThumbnailService } from "./services/thumbnails.ts";

export type ServicesOptions = Readonly<{
  config: Pick<Config, "dataDir" | "agentDriver" | "runtimeDriver">;
  db: Db;
  log: Logger;
  now?: Clock;
}>;

export type Services = Readonly<{
  assets: AssetService;
  /** Sisi baca untuk API dan hub realtime. */
  queries: AssetQueries;
  /** Hub WebSocket `/api/ws` (detak sudah berjalan). */
  hub: Hub;
  bus: EventBus;
  /** Pool proses Claude; cek kesehatan (`accountInfo`) memakai slot yang sama (`withSlot`). */
  pool: AgentPool;
  /** Thumbnail dan turntable Gudang (dibuat setelah build, atau di latar saat daftar/detail membutuhkannya). */
  thumbnails: ThumbnailService;
  /** Ekspor Web/Unity/Sumber dan ZIP Gudang. */
  exports: ExportService;
  lane: HeavyLane;
  /** Sambungan WebSocket ditutup, sesi Claude ditutup, build dibatalkan, Chromium ditutup. Database ditutup pemanggil. */
  close(): Promise<void>;
}>;

type Runtime = Readonly<{
  builder: AssetBuilder;
  /** Chromium renderer (mode docker); `null` di mode fixture. */
  renderer: Renderer | null;
  close(): Promise<void>;
}>;

async function createRuntime(
  config: ServicesOptions["config"],
  lane: HeavyLane,
  materialsDir: string,
): Promise<Runtime> {
  if (config.runtimeDriver === "fixture") {
    return { builder: new FixtureAssetBuilder(FIXTURE_PAIR), renderer: null, close: async () => undefined };
  }
  const jobsRoot = join(config.dataDir, "jobs");
  await mkdir(jobsRoot, { recursive: true });
  // Chromium baru diluncurkan saat render pertama; image dicek Docker saat job berjalan.
  const renderer = new Renderer();
  const builder = new DockerAssetBuilder({
    lane,
    renderer,
    image: await runtimeImageTag(),
    owner: ownerForDataDir(config.dataDir),
    jobsRoot,
    materialsDir,
  });
  return { builder, renderer, close: () => renderer.close() };
}

export async function createServices(options: ServicesOptions): Promise<Services> {
  const { config, db, log } = options;
  const now = options.now ?? Date.now;
  const bus = new EventBus({ onError: (error) => log.error({ err: error }, "pelanggan event gagal") });
  const pool = new AgentPool();
  const lane = new HeavyLane({ now });
  const library = new MaterialLibrary(join(config.dataDir, "library", "materials"));
  const runtime = await createRuntime(config, lane, library.dir);
  const port: AgentPort =
    config.agentDriver === "fake" ? new ScenarioAgentPort(defaultScenario({ now })) : sdkAgentPort;
  const thumbnails = new ThumbnailService({
    db,
    dataDir: config.dataDir,
    renderer: runtime.renderer,
    onError: (error, context) =>
      log.error({ err: error, assetId: context.assetId, version: context.version }, "thumbnail gagal dibuat"),
    // Web mengambil ulang daftar dan detail, lalu memuat thumbnail yang baru ada.
    onReady: (assetId) => bus.publishGlobal({ type: "asset", assetId, change: "updated" }),
  });
  const exports = new ExportService({
    db,
    dataDir: config.dataDir,
    onError: (error, context) =>
      log.error(
        { err: error, assetId: context.assetId, version: context.version, op: context.op },
        "ekspor gagal",
      ),
  });

  const assets = new AssetService({
    db,
    bus,
    now,
    dataDir: config.dataDir,
    createAgent: (input) =>
      createAssetSession({
        asset: input.asset,
        store: input.store,
        port,
        builder: runtime.builder,
        library,
        emit: input.emit,
        onError: input.onError,
        pool,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      }),
    onError: (error, context) =>
      log.error({ err: error, assetId: context.assetId, op: context.op }, "kesalahan service aset"),
    // Di latar: `ensure` tidak pernah gagal (error dicatat lewat `onError` di atas).
    onVersionCreated: (assetId, version) => void thumbnails.ensure(assetId, version),
    beforeRemoveDir: async (assetId) => {
      await Promise.all([thumbnails.settleAsset(assetId), exports.settleAsset(assetId)]);
    },
  });

  const unsubscribe = lane.on((event) => {
    if (event.type !== "started") return;
    try {
      assets.jobStarted(event.jobId);
    } catch (error) {
      log.error({ err: error, jobId: event.jobId }, "gagal menandai job berjalan");
    }
  });
  assets.recover();

  const queries = new AssetQueries({
    db,
    dataDir: config.dataDir,
    progress: (assetId) => assets.buildProgress(assetId),
    onMissingThumbnail: (assetId, version) => thumbnails.schedule(assetId, version),
  });
  const hub = new Hub({
    bus,
    queries,
    onError: (error, context) => log.error({ err: error, op: context.op }, "kesalahan hub realtime"),
  });
  hub.start();

  return {
    assets,
    queries,
    hub,
    bus,
    pool,
    thumbnails,
    exports,
    lane,
    async close() {
      hub.stop();
      unsubscribe();
      await assets.close();
      await runtime.close();
    },
  };
}

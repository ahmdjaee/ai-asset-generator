/**
 * Matriks tes PLAN §6: `AGENT_DRIVER=fake` × `RUNTIME_DRIVER=docker` (DoD tahap, tanpa kuota). Akar komposisi
 * yang sama dengan `main.ts` (`createServices`): skenario bawaan menjalankan skrip contoh peti di Blender sungguhan,
 * pipeline + Chromium membuat versi, lalu persetujuan → tekstur → selesai.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createServices, type Services } from "../../../server/compose.ts";
import { loadConfig } from "../../../server/config.ts";
import { type DatabaseHandle, openDatabase } from "../../../server/db/client.ts";
import { type AssetRecord, getAsset } from "../../../server/db/repos/assets.ts";
import { listJobs } from "../../../server/db/repos/jobs.ts";
import { listVersionRecords } from "../../../server/db/repos/versions.ts";
import { createLogger } from "../../../server/log.ts";
import { ENABLED, JOBS_ROOT, leftoverJobContainers, requireImage } from "./helpers.ts";

const LIBRARY = join(loadConfig().dataDir, "library", "materials");

describe.skipIf(!ENABLED)("AGENT_DRIVER=fake × RUNTIME_DRIVER=docker", () => {
  let dataDir = "";
  let handle: DatabaseHandle;
  let services: Services;

  beforeAll(async () => {
    await requireImage();
    if ((await stat(LIBRARY).catch(() => null)) === null) {
      throw new Error(`Pustaka material belum ada di ${LIBRARY}; jalankan \`bun run textures:sync\`.`);
    }
    await mkdir(join(JOBS_ROOT, ".."), { recursive: true });
    dataDir = await mkdtemp(join(JOBS_ROOT, "..", "fake-docker-"));
    // Pustaka material pemilik dipakai baca-saja (dipasang read-only di container).
    await mkdir(join(dataDir, "library"), { recursive: true });
    await symlink(LIBRARY, join(dataDir, "library", "materials"));
    handle = openDatabase(":memory:");
    services = await createServices({
      config: { dataDir, agentDriver: "fake", runtimeDriver: "docker" },
      db: handle.db,
      log: createLogger("silent"),
    });
  });

  afterAll(async () => {
    await services.close();
    handle.close();
    const assets = join(dataDir, "assets");
    for (const asset of await readdir(assets).catch(() => [])) {
      for (const version of await readdir(join(assets, asset, "versions")).catch(() => [])) {
        await chmod(join(assets, asset, "versions", version), 0o755);
      }
    }
    await rm(dataDir, { recursive: true, force: true });
    expect(await leftoverJobContainers()).toEqual([]);
  });

  function until(assetId: string, done: (record: AssetRecord) => boolean): Promise<AssetRecord> {
    return new Promise((resolve) => {
      const check = () => {
        const record = getAsset(handle.db, assetId);
        if (record === null || !done(record)) return;
        unsubscribe();
        resolve(record);
      };
      const unsubscribe = services.bus.subscribe(assetId, check);
      check();
    });
  }

  test(
    "prompt → bentuk dasar (Docker) → setujui → tekstur (Docker) → selesai",
    async () => {
      const asset = await services.assets.create({ prompt: "Peti kayu kartun", tierId: "ringan" });
      const review = await until(
        asset.id,
        (record) => record.state.status === "BASE_REVIEW" && record.state.runState === "idle",
      );
      expect(review.state.currentVersion).toBe(1);

      await services.assets.approve(asset.id);
      const final = await until(
        asset.id,
        (record) => record.state.runState === "idle" && record.state.status !== "BASE_REVIEW",
      );
      expect(final.state).toMatchObject({ status: "TEXTURE_REVIEW", currentVersion: 2, lastError: null });
      await services.assets.finish(asset.id);

      expect(listVersionRecords(handle.db, asset.id).map((version) => version.stage)).toEqual([
        "base",
        "textured",
      ]);
      const jobs = listJobs(handle.db, asset.id);
      expect(jobs.map((job) => [job.kind, job.status])).toEqual([
        ["build_base", "succeeded"],
        ["build_textured", "succeeded"],
      ]);
      // Jalur job berat melaporkan job mulai berjalan (lane "started" → jobStarted).
      expect(jobs.every((job) => job.startedAt !== null)).toBe(true);
      expect(services.assets.get(asset.id).state.status).toBe("DONE");
    },
    15 * 60_000,
  );
});

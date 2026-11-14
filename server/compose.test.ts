import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TIERS } from "../shared/limits.ts";
import { createServices, type Services } from "./compose.ts";
import { type DatabaseHandle, openDatabase } from "./db/client.ts";
import { type AssetRecord, getAsset, insertAsset } from "./db/repos/assets.ts";
import { createLogger } from "./log.ts";

let dataDir = "";
let handle: DatabaseHandle;
const opened: Services[] = [];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-compose-"));
  handle = openDatabase(":memory:");
});

afterEach(async () => {
  for (const services of opened.splice(0)) await services.close();
  handle.close();
  await Bun.$`chmod -R u+w ${dataDir}`.quiet();
  await rm(dataDir, { recursive: true, force: true });
});

async function compose(config: Parameters<typeof createServices>[0]["config"]): Promise<Services> {
  const services = await createServices({ config, db: handle.db, log: createLogger("silent") });
  opened.push(services);
  return services;
}

function until(services: Services, assetId: string, done: (record: AssetRecord) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const record = getAsset(handle.db, assetId);
      if (record !== null && done(record)) {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = services.bus.subscribe(assetId, check);
    check();
  });
}

describe("createServices", () => {
  test("driver fake + fixture: aset dibuat dan sampai review bentuk dasar tanpa Docker dan tanpa kuota", async () => {
    const services = await compose({ dataDir, agentDriver: "fake", runtimeDriver: "fixture" });
    const asset = await services.assets.create({ prompt: "Peti kayu", tierId: "ringan" });
    await until(
      services,
      asset.id,
      (record) => record.state.status === "BASE_REVIEW" && record.state.runState === "idle",
    );
    expect(await stat(join(dataDir, "assets", asset.id, "versions", "v1"))).toBeTruthy();
  }, 30_000);

  test("driver sungguhan dirakit tanpa menjalankan Claude, Docker, atau Chromium", async () => {
    const services = await compose({ dataDir, agentDriver: "sdk", runtimeDriver: "docker" });
    expect(services.pool.live).toBe(0);
    expect((await stat(join(dataDir, "jobs"))).isDirectory()).toBe(true);
  });

  test("pemulihan dijalankan saat start: aset yang sedang berjalan menjadi interrupted", async () => {
    insertAsset(handle.db, {
      id: "berjalan",
      name: "Berjalan",
      prompt: "x",
      tierId: "ringan",
      tier: DEFAULT_TIERS.ringan,
      now: 1,
      state: {
        status: "BASE_WORKING",
        runState: "running",
        lastError: null,
        brief: null,
        approvedBaseVersion: null,
        currentVersion: null,
        buildsThisMessage: 1,
      },
    });
    await compose({ dataDir, agentDriver: "fake", runtimeDriver: "fixture" });
    expect(getAsset(handle.db, "berjalan")?.state.runState).toBe("interrupted");
  });
});

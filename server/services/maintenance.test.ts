import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import {
  BACKUPS_KEEP,
  DEFAULT_TIERS,
  EXPORT_CACHE_STALE_MS,
  JOB_DIR_STALE_MS,
  MAINTENANCE_INTERVAL_MS,
} from "../../shared/limits.ts";
import { openDatabase } from "../db/client.ts";
import { getAsset, insertAsset } from "../db/repos/assets.ts";
import { sourceExportFile, UNITY_EXPORT_FILE } from "./exports.ts";
import { backupFileName, Maintenance } from "./maintenance.ts";

const DAY = 24 * 60 * 60_000;
/** 18 Nov 2026 10.00 UTC (`bun test` berjalan di UTC). */
const NOW = Date.UTC(2026, 10, 18, 10);

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-maint-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function touch(path: string, mtimeMs: number, content = "x"): Promise<void> {
  await writeFile(path, content);
  await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
}

async function names(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).sort();
}

function setup(now = NOW) {
  const database = openDatabase(join(dataDir, "app.db"));
  const errors: unknown[] = [];
  const maintenance = new Maintenance({
    backupInto: database.backupInto,
    db: database.db,
    dataDir,
    now: () => now,
    onError: (error) => errors.push(error),
  });
  return { database, maintenance, errors };
}

describe("backup database", () => {
  test("nama file per tanggal lokal", () => {
    expect(backupFileName(NOW)).toBe("app-20261118.db");
  });

  test("VACUUM INTO harian: salinan bisa dibuka; sekali per hari; simpan 7 terbaru, file lain tidak disentuh", async () => {
    const { database, maintenance, errors } = setup();
    const backups = join(dataDir, "backups");
    await mkdir(backups);
    // 8 backup lama + satu file milik pemilik yang tidak cocok polanya.
    for (let day = 1; day <= 8; day++)
      await touch(join(backups, `app-202611${String(day).padStart(2, "0")}.db`), NOW);
    await touch(join(backups, "catatan.txt"), NOW);
    insertAsset(database.db, {
      id: "a1",
      name: "Peti",
      prompt: "peti kayu",
      tierId: "sedang",
      tier: DEFAULT_TIERS.sedang,
      now: NOW,
    });

    const first = await maintenance.runOnce();
    expect(first.backup).toBe("app-20261118.db");
    const kept = await names(backups);
    expect(kept.filter((name) => name.startsWith("app-"))).toHaveLength(BACKUPS_KEEP);
    expect(kept).toContain("app-20261118.db");
    expect(kept).not.toContain("app-20261101.db");
    expect(kept).toContain("catatan.txt");
    expect(kept.some((name) => name.endsWith(".tmp"))).toBe(false);

    const copy = openDatabase(join(backups, "app-20261118.db"));
    expect(getAsset(copy.db, "a1")?.name).toBe("Peti");
    copy.close();

    expect((await maintenance.runOnce()).backup).toBeNull();
    expect(errors).toEqual([]);
    database.close();
  });
});

describe("pembersihan", () => {
  test("folder job usang dihapus, job yang baru dibiarkan; file lain di jobs/ tidak disentuh", async () => {
    const { database, maintenance } = setup();
    const jobs = join(dataDir, "jobs");
    for (const name of ["job-lama", "job-baru"]) await mkdir(join(jobs, name, "out"), { recursive: true });
    await utimes(
      join(jobs, "job-lama"),
      (NOW - JOB_DIR_STALE_MS - 1) / 1000,
      (NOW - JOB_DIR_STALE_MS - 1) / 1000,
    );
    await touch(join(jobs, "bukan-job"), NOW - 10 * DAY);
    const result = await maintenance.runOnce();
    expect(result.jobDirs).toBe(1);
    expect(await names(jobs)).toEqual(["bukan-job", "job-baru"]);
    database.close();
  });

  test("derived: cache ekspor usang, ZIP nama lama, sisa tmp, dan versi yang tidak ada dibuang; thumbnail tetap", async () => {
    const { database, maintenance } = setup();
    insertAsset(database.db, {
      id: "a1",
      name: "Peti baru",
      prompt: "peti",
      tierId: "sedang",
      tier: DEFAULT_TIERS.sedang,
      now: NOW,
    });
    const asset = join(dataDir, "assets", "a1");
    await mkdir(join(asset, "versions", "v1"), { recursive: true });
    await mkdir(join(asset, "versions", "v2"), { recursive: true });
    const v1 = join(asset, "derived", "v1");
    const v2 = join(asset, "derived", "v2");
    const v9 = join(asset, "derived", "v9");
    for (const dir of [v1, v2, v9]) await mkdir(dir, { recursive: true });
    const old = NOW - EXPORT_CACHE_STALE_MS - 1;
    await touch(join(v1, THUMB_FILE), old);
    await touch(join(v1, TURNTABLE_FILE), old);
    await touch(join(v1, UNITY_EXPORT_FILE), old);
    await touch(join(v1, sourceExportFile("Peti baru")), NOW - DAY);
    await touch(join(v1, sourceExportFile("Peti lama")), NOW - DAY);
    await touch(join(v1, ".thumb.webp.abcd.tmp"), NOW - 2 * DAY);
    await touch(join(v2, UNITY_EXPORT_FILE), NOW - DAY);
    await touch(join(v2, ".export-unity.glb.beef.tmp"), NOW);
    await touch(join(v9, THUMB_FILE), NOW);

    const result = await maintenance.runOnce();
    expect(await names(v1)).toEqual([sourceExportFile("Peti baru"), THUMB_FILE, TURNTABLE_FILE].sort());
    // Tmp yang baru bisa jadi sedang ditulis: dibiarkan.
    expect(await names(v2)).toEqual([".export-unity.glb.beef.tmp", UNITY_EXPORT_FILE]);
    expect(await names(join(asset, "derived"))).toEqual(["v1", "v2"]);
    expect(result.derivedFiles).toBe(4);
    database.close();
  });

  test("tanpa folder backups/jobs/assets: tidak gagal", async () => {
    const { database, maintenance, errors } = setup();
    expect(await maintenance.runOnce()).toMatchObject({ jobDirs: 0, derivedFiles: 0 });
    expect(errors).toEqual([]);
    database.close();
  });
});

describe("jadwal", () => {
  test("berjalan saat start lalu tiap interval; stop membatalkan jadwal", async () => {
    const database = openDatabase(join(dataDir, "app.db"));
    const scheduled: Array<{ run: () => Promise<void>; ms: number }> = [];
    const errors: unknown[] = [];
    const maintenance = new Maintenance({
      backupInto: database.backupInto,
      db: database.db,
      dataDir,
      now: () => NOW,
      onError: (error) => errors.push(error),
      schedule: (run, ms) => {
        const entry = { run, ms };
        scheduled.push(entry);
        return () => scheduled.splice(scheduled.indexOf(entry), 1);
      },
    });
    maintenance.start();
    expect(scheduled.map((entry) => entry.ms)).toEqual([0]);
    await scheduled.shift()?.run();
    expect(await names(join(dataDir, "backups"))).toEqual(["app-20261118.db"]);
    expect(scheduled.map((entry) => entry.ms)).toEqual([MAINTENANCE_INTERVAL_MS]);
    await maintenance.stop();
    expect(scheduled).toHaveLength(0);
    expect(errors).toEqual([]);
    database.close();
  });
});

/**
 * Pemeliharaan data (PLAN Tahap 12), dijalankan saat server start lalu setiap `MAINTENANCE_INTERVAL_MS`:
 * - backup database harian `VACUUM INTO data/backups/app-YYYYMMDD.db` (tanggal lokal), simpan `BACKUPS_KEEP` terbaru;
 * - folder job yang tertinggal di `data/jobs/`;
 * - cache usang di `data/assets/<id>/derived/`: ekspor Unity/Sumber yang lama tidak diubah, ZIP Sumber bernama lama
 *   (setelah aset diganti nama), sisa file `.tmp`, dan folder untuk versi yang tidak ada.
 * Thumbnail dan turntable tidak dibuang (dipakai Gudang). Versi (`versions/`) dan aset tidak pernah disentuh.
 */
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  BACKUPS_KEEP,
  EXPORT_CACHE_STALE_MS,
  JOB_DIR_STALE_MS,
  MAINTENANCE_INTERVAL_MS,
  TEMP_FILE_STALE_MS,
} from "../../shared/limits.ts";
import type { Db } from "../db/client.ts";
import { getAsset } from "../db/repos/assets.ts";
import type { Clock } from "./asset-store.ts";
import { sourceExportFile, UNITY_EXPORT_FILE } from "./exports.ts";
import { listVersions } from "./versions.ts";

const BACKUP_FILE = /^app-\d{8}\.db$/;
const JOB_DIR = /^job-/;
const VERSION_DIR = /^v(\d+)$/;
const SOURCE_EXPORT = /^export-source-[0-9a-f]{16}\.zip$/;
const TEMP_FILE = /^\..+\.tmp$/;

/** Menjadwalkan `run` setelah `ms`; hasilnya pembatal. Disuntikkan di tes. */
export type Schedule = (run: () => Promise<void>, ms: number) => () => void;

const realSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(() => void run(), ms);
  // Jadwal pemeliharaan tidak boleh menahan proses tetap hidup.
  timer.unref();
  return () => clearTimeout(timer);
};

export type MaintenanceResult = Readonly<{
  /** Nama backup yang dibuat; `null` bila backup hari ini sudah ada. */
  backup: string | null;
  backupsRemoved: number;
  jobDirs: number;
  derivedFiles: number;
}>;

export type MaintenanceOptions = Readonly<{
  /** `DatabaseHandle.backupInto`: salinan database ke file baru. */
  backupInto: (path: string) => void;
  db: Db;
  dataDir: string;
  now: Clock;
  onError: (error: unknown) => void;
  onDone?: (result: MaintenanceResult) => void;
  schedule?: Schedule;
}>;

/** `app-YYYYMMDD.db` menurut tanggal lokal mesin. */
export function backupFileName(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `app-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.db`;
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Waktu ubah entri tanpa mengikuti symlink; `null` bila tidak ada. */
async function modifiedAt(path: string): Promise<{ ms: number; dir: boolean; file: boolean } | null> {
  const info = await lstat(path).catch(() => null);
  return info === null ? null : { ms: info.mtimeMs, dir: info.isDirectory(), file: info.isFile() };
}

export class Maintenance {
  readonly #options: MaintenanceOptions;
  readonly #schedule: Schedule;
  #cancel: (() => void) | null = null;
  #stopped = false;
  #running: Promise<void> = Promise.resolve();

  constructor(options: MaintenanceOptions) {
    this.#options = options;
    this.#schedule = options.schedule ?? realSchedule;
  }

  /** Jalan sekali segera (di latar), lalu setiap `MAINTENANCE_INTERVAL_MS`. */
  start(): void {
    this.#stopped = false;
    this.#plan(0);
  }

  /** Membatalkan jadwal dan menunggu putaran yang sedang berjalan (database ditutup sesudahnya). */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancel?.();
    this.#cancel = null;
    await this.#running;
  }

  #plan(ms: number): void {
    this.#cancel = this.#schedule(async () => {
      this.#cancel = null;
      this.#running = this.#round();
      await this.#running;
      if (!this.#stopped) this.#plan(MAINTENANCE_INTERVAL_MS);
    }, ms);
  }

  async #round(): Promise<void> {
    try {
      // Dihitung dulu: argumen `onDone?.(…)` tidak dievaluasi bila `onDone` tidak diisi.
      const result = await this.runOnce();
      this.#options.onDone?.(result);
    } catch (error) {
      this.#options.onError(error);
    }
  }

  async runOnce(): Promise<MaintenanceResult> {
    const backups = await this.#backup();
    const jobDirs = await this.#cleanJobs();
    const derivedFiles = await this.#cleanDerived();
    return { ...backups, jobDirs, derivedFiles };
  }

  async #backup(): Promise<{ backup: string | null; backupsRemoved: number }> {
    const dir = join(this.#options.dataDir, "backups");
    await mkdir(dir, { recursive: true });
    const name = backupFileName(this.#options.now());
    let backup: string | null = null;
    if ((await modifiedAt(join(dir, name))) === null) {
      // Atomik: VACUUM ke file sementara di folder yang sama, lalu rename.
      const temp = join(dir, `.${name}.tmp`);
      await rm(temp, { force: true });
      try {
        this.#options.backupInto(temp);
        await rename(temp, join(dir, name));
      } finally {
        await rm(temp, { force: true });
      }
      backup = name;
    }
    const old = (await entries(dir))
      .filter((entry) => BACKUP_FILE.test(entry))
      .sort()
      .reverse()
      .slice(BACKUPS_KEEP);
    for (const entry of old) await rm(join(dir, entry), { force: true });
    return { backup, backupsRemoved: old.length };
  }

  async #cleanJobs(): Promise<number> {
    const root = join(this.#options.dataDir, "jobs");
    let removed = 0;
    for (const entry of await entries(root)) {
      if (!JOB_DIR.test(entry)) continue;
      const path = join(root, entry);
      const info = await modifiedAt(path);
      if (info?.dir !== true || this.#options.now() - info.ms <= JOB_DIR_STALE_MS) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  async #cleanDerived(): Promise<number> {
    const root = join(this.#options.dataDir, "assets");
    let removed = 0;
    for (const assetId of await entries(root)) {
      const assetDir = join(root, assetId);
      const derived = join(assetDir, "derived");
      const versions = new Set(await listVersions(assetDir));
      const asset = getAsset(this.#options.db, assetId, { includeDeleted: true });
      const currentSource = asset === null ? null : sourceExportFile(asset.name);
      for (const entry of await entries(derived)) {
        const version = VERSION_DIR.exec(entry)?.[1];
        if (version === undefined) continue;
        const dir = join(derived, entry);
        if (!versions.has(Number(version))) {
          const files = await entries(dir);
          await rm(dir, { recursive: true, force: true });
          removed += files.length;
          continue;
        }
        for (const name of await entries(dir)) {
          if (await this.#isStale(join(dir, name), name, currentSource)) {
            await rm(join(dir, name), { force: true });
            removed += 1;
          }
        }
      }
    }
    return removed;
  }

  async #isStale(path: string, name: string, currentSource: string | null): Promise<boolean> {
    const info = await modifiedAt(path);
    if (info?.file !== true) return false;
    const age = this.#options.now() - info.ms;
    if (TEMP_FILE.test(name)) return age > TEMP_FILE_STALE_MS;
    const isExport = name === UNITY_EXPORT_FILE || SOURCE_EXPORT.test(name);
    if (!isExport) return false;
    if (SOURCE_EXPORT.test(name) && currentSource !== null && name !== currentSource) return true;
    return age > EXPORT_CACHE_STALE_MS;
  }
}

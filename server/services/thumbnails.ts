/**
 * Thumbnail dan turntable Gudang per versi (`derived/vN/thumb.webp` + `turntable.webp`, PLAN Tahap 10). Dibuat sekali
 * dari `web.glb` (Clay untuk bentuk dasar, Tekstur untuk aset final), selalu di luar request:
 * - setelah build (`ensure`);
 * - untuk versi yang belum punya (versi lama, atau render setelah build gagal), saat daftar/detail memintanya
 *   (`schedule`): antre di latar, satu render sekaligus, jadi build tidak antre di belakang banyak turntable. Versi yang
 *   gagal tidak dicoba lagi lewat antrean ini sampai server dimulai ulang.
 *
 * File baru → `onReady` (server menyiarkan "aset berubah", web mengambil ulang daftar/detail lalu memuat gambarnya).
 * Tanpa renderer (`RUNTIME_DRIVER=fixture`) hanya file yang sudah ada yang tersedia.
 */
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import type { Db } from "../db/client.ts";
import { getVersionRecord, type VersionRecord } from "../db/repos/versions.ts";
import type { Renderer } from "../render/renderer.ts";
import { composeTurntable } from "../render/turntable.ts";
import { assetDirFor } from "./asset-queries.ts";
import { versionDir, writeDerived } from "./versions.ts";

export type TurntableRenderer = Pick<Renderer, "turntable">;

export type ThumbnailDeps = Readonly<{
  db: Db;
  dataDir: string;
  renderer: TurntableRenderer | null;
  onError?: (error: unknown, context: Readonly<{ assetId: string; version: number }>) => void;
  /** Thumbnail dan turntable versi ini baru saja dibuat. */
  onReady?: (assetId: string, version: number) => void;
}>;

type Job = Readonly<{ assetId: string; version: number }>;

const keyOf = (assetId: string, version: number) => `${assetId}/${version}`;

async function isFile(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isFile() === true;
}

/** GLB yang dirender: `web.glb` (lebih kecil, isi sama) bila ada. */
function sourceGlb(record: VersionRecord): string {
  if (record.files.some((file) => file.name === "web.glb")) return "web.glb";
  return record.stage === "base" ? "base.glb" : "final.glb";
}

export class ThumbnailService {
  readonly #deps: ThumbnailDeps;
  readonly #pending = new Map<string, Promise<boolean>>();
  readonly #queue: Job[] = [];
  readonly #queued = new Set<string>();
  /** Gagal dibuat lewat antrean latar; tidak dijadwalkan lagi. */
  readonly #failed = new Set<string>();
  #draining: Promise<void> | null = null;

  constructor(deps: ThumbnailDeps) {
    this.#deps = deps;
  }

  /**
   * `true` bila thumbnail dan turntable versi ini tersedia (dibuat bila perlu). Permintaan bersamaan untuk versi yang
   * sama menunggu render yang sama. Tidak pernah gagal: error dilaporkan ke `onError` dan hasilnya `false`.
   */
  ensure(assetId: string, version: number): Promise<boolean> {
    const key = keyOf(assetId, version);
    const pending = this.#pending.get(key);
    if (pending !== undefined) return pending;
    const task = this.#create(assetId, version)
      .then((result) => {
        if (result === "created") this.#deps.onReady?.(assetId, version);
        return result !== "unavailable";
      })
      .catch((error: unknown) => {
        this.#failed.add(key);
        this.#deps.onError?.(error, { assetId, version });
        return false;
      })
      .finally(() => this.#pending.delete(key));
    this.#pending.set(key, task);
    return task;
  }

  /** Jadwalkan pembuatan di latar untuk versi yang belum punya thumbnail (tanpa menunggu hasilnya). */
  schedule(assetId: string, version: number): void {
    const key = keyOf(assetId, version);
    if (this.#deps.renderer === null || this.#failed.has(key) || this.#queued.has(key)) return;
    if (this.#pending.has(key)) return;
    this.#queued.add(key);
    this.#queue.push({ assetId, version });
    this.#draining ??= this.#drain().finally(() => {
      this.#draining = null;
    });
  }

  /** Sebelum folder aset dihapus: antrean latar aset ini dibuang, render yang sedang berjalan ditunggu. */
  async settleAsset(assetId: string): Promise<void> {
    const mine = (job: Job) => job.assetId === assetId;
    for (const job of this.#queue.filter(mine)) this.#queued.delete(keyOf(job.assetId, job.version));
    this.#queue.splice(0, this.#queue.length, ...this.#queue.filter((job) => !mine(job)));
    const prefix = `${assetId}/`;
    await Promise.all([...this.#pending].filter(([key]) => key.startsWith(prefix)).map(([, task]) => task));
  }

  /** Selesai saat antrean latar kosong (tes). */
  async settled(): Promise<void> {
    while (this.#draining !== null || this.#pending.size > 0) {
      await Promise.all([this.#draining, ...this.#pending.values()]);
    }
  }

  async #drain(): Promise<void> {
    for (let job = this.#queue.shift(); job !== undefined; job = this.#queue.shift()) {
      this.#queued.delete(keyOf(job.assetId, job.version));
      await this.ensure(job.assetId, job.version);
    }
  }

  async #create(assetId: string, version: number): Promise<"ready" | "created" | "unavailable"> {
    const assetDir = assetDirFor(this.#deps.dataDir, assetId);
    const derived = join(assetDir, "derived", `v${version}`);
    const exists = await Promise.all([
      isFile(join(derived, THUMB_FILE)),
      isFile(join(derived, TURNTABLE_FILE)),
    ]);
    if (exists.every(Boolean)) return "ready";
    const renderer = this.#deps.renderer;
    const record = getVersionRecord(this.#deps.db, assetId, version);
    if (renderer === null || record === null) return "unavailable";
    const glb = new Uint8Array(await readFile(join(versionDir(assetDir, version), sourceGlb(record))));
    const output = await renderer.turntable(glb, { mode: record.stage === "base" ? "clay" : "texture" });
    const images = await composeTurntable(output.frames);
    await writeDerived(assetDir, version, TURNTABLE_FILE, images.strip);
    await writeDerived(assetDir, version, THUMB_FILE, images.thumb);
    return "created";
  }
}

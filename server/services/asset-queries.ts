/**
 * Sisi baca aset untuk API dan realtime (PLAN Tahap 6): daftar, detail, halaman thread, replay setelah sambung ulang,
 * dan file versi/lampiran yang boleh disajikan. Tanpa efek samping, kecuali menjadwalkan thumbnail yang belum ada
 * (`onMissingThumbnail`); aksi ada di `AssetService`.
 */
import { lstat, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { AttachmentKind } from "../../shared/agent-events.ts";
import type { StoredEvent } from "../../shared/asset-events.ts";
import {
  type AssetListQuery,
  type BuildProgressView,
  STAGE_FILTER_STATUSES,
} from "../../shared/asset-list.ts";
import type { AssetStats } from "../../shared/asset-stats.ts";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import { EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX, WS_REPLAY_MAX_EVENTS } from "../../shared/limits.ts";
import type { VersionReport } from "../../shared/version-report.ts";
import type { Db } from "../db/client.ts";
import { type AssetRecord, countAssets, getAsset, searchAssets } from "../db/repos/assets.ts";
import { getAttachment, listAttachments } from "../db/repos/attachments.ts";
import { listEvents } from "../db/repos/events.ts";
import { getVersionRecord, listVersionRecords, type VersionRecord } from "../db/repos/versions.ts";
import { buildsLeft } from "../domain/status.ts";
import { CONTACT_SHEET_FILE } from "./build-version.ts";
import { assetNotFound, ServiceError } from "./errors.ts";
import { versionDir } from "./versions.ts";

/** Aset seperti yang dilihat klien (tanpa `sessionId` dan detail internal lain). */
export type AssetView = Readonly<{
  id: string;
  name: string;
  prompt: string;
  tierId: AssetRecord["tierId"];
  tier: AssetRecord["tier"];
  status: AssetRecord["state"]["status"];
  runState: AssetRecord["state"]["runState"];
  lastError: AssetRecord["state"]["lastError"];
  brief: AssetRecord["state"]["brief"];
  approvedBaseVersion: number | null;
  currentVersion: number | null;
  buildsLeft: number;
  createdAt: number;
  updatedAt: number;
}>;

/** Versi terkini untuk info kartu Gudang ("3,4k segitiga · 612 KB"). */
export type CurrentVersionView = Readonly<{
  n: number;
  stage: "base" | "textured";
  triangles: number;
  /** Ukuran `web.glb`; null bila versi tidak punya file itu. */
  webBytes: number | null;
  /** Thumbnail dan turntable sudah dibuat; `false` = belum (dibuat di latar, lalu ada event "aset berubah"). */
  thumbnail: boolean;
}>;

/** Item daftar Gudang. */
export type AssetListItem = AssetView &
  Readonly<{
    current: CurrentVersionView | null;
    /** Jumlah semua versi (dialog hapus di Gudang). */
    versionCount: number;
    /** Progres build yang sedang berjalan ("Tahap 2 · 62%"); null bila tidak ada build. */
    progress: BuildProgressView | null;
  }>;

export type AssetList = Readonly<{
  assets: readonly AssetListItem[];
  /** Semua aset yang belum dihapus, tanpa filter (judul Gudang). */
  total: number;
}>;

export type VersionView = Readonly<
  {
    n: number;
    stage: "base" | "textured";
    stats: AssetStats;
    budgetOk: boolean;
    files: ReadonlyArray<Readonly<{ name: string; bytes: number }>>;
    createdAt: number;
    /** Sama dengan `CurrentVersionView.thumbnail`. */
    thumbnail: boolean;
  } & VersionReport
>;

export type AttachmentView = Readonly<{
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}>;

export type AssetDetail = Readonly<{
  asset: AssetView;
  versions: readonly VersionView[];
  attachments: readonly AttachmentView[];
}>;

export type EventsPage = Readonly<{ events: readonly StoredEvent[]; hasMore: boolean }>;

/** File yang boleh disajikan: path sudah dicek (file biasa, di dalam folder aset). */
export type ServedFile = Readonly<{
  path: string;
  size: number;
  contentType: string;
  /** `immutable`: isi tidak pernah berubah (versi, lampiran). `revalidate`: cache turunan. */
  cache: "immutable" | "revalidate";
  /** Diisi bila file sebaiknya diunduh, bukan ditampilkan. */
  downloadName?: string;
}>;

const CONTENT_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".blend": "application/x-blender",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
  ".py": "text/plain; charset=utf-8",
  ".obj": "model/obj",
  ".stl": "model/stl",
};
/** Ditampilkan langsung di browser; lainnya diunduh. */
const INLINE = new Set([".glb", ".png", ".webp", ".json", ".py"]);

/** File turunan (`derived/vN/`) yang boleh diminta lewat rute file versi. */
const DERIVED_FILES: ReadonlySet<string> = new Set([CONTACT_SHEET_FILE, THUMB_FILE, TURNTABLE_FILE]);

export function assetDirFor(dataDir: string, assetId: string): string {
  const root = resolve(dataDir, "assets");
  const dir = resolve(root, assetId);
  const rel = relative(root, dir);
  if (rel === "" || rel.startsWith("..") || rel.includes(sep)) throw assetNotFound(assetId);
  return dir;
}

export function assetView(record: AssetRecord): AssetView {
  const { state } = record;
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    tierId: record.tierId,
    tier: record.tier,
    status: state.status,
    runState: state.runState,
    lastError: state.lastError,
    brief: state.brief,
    approvedBaseVersion: state.approvedBaseVersion,
    currentVersion: state.currentVersion,
    buildsLeft: buildsLeft(state),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function currentVersionView(record: VersionRecord, thumbnail: boolean): CurrentVersionView {
  return {
    n: record.n,
    stage: record.stage,
    triangles: record.stats.triangles,
    webBytes: record.files.find((file) => file.name === "web.glb")?.bytes ?? null,
    thumbnail,
  };
}

async function isFile(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null))?.isFile() === true;
}

function fileNotFound(): ServiceError {
  return new ServiceError("FILE_NOT_FOUND", "File tidak ditemukan.");
}

/** Path dari luar dicek: file biasa (bukan symlink), dan realpath-nya di dalam `root`. Hasil: realpath + ukuran. */
export async function checkedFile(
  root: string,
  path: string,
): Promise<Readonly<{ path: string; size: number }>> {
  const info = await lstat(path).catch(() => null);
  if (info === null || !info.isFile()) throw fileNotFound();
  const [realRoot, real] = await Promise.all([realpath(root), realpath(path)]);
  if (!real.startsWith(`${realRoot}${sep}`)) throw fileNotFound();
  return { path: real, size: info.size };
}

export class AssetQueries {
  readonly #db: Db;
  readonly #dataDir: string;
  readonly #progress: (assetId: string) => BuildProgressView | null;
  readonly #onMissingThumbnail: (assetId: string, version: number) => void;

  constructor(
    deps: Readonly<{
      db: Db;
      dataDir: string;
      /** Progres build yang sedang berjalan (`AssetService.buildProgress`). */
      progress?: (assetId: string) => BuildProgressView | null;
      /** Versi yang tampil tanpa thumbnail (`ThumbnailService.schedule`: dibuat di latar, bukan di request). */
      onMissingThumbnail?: (assetId: string, version: number) => void;
    }>,
  ) {
    this.#db = deps.db;
    this.#dataDir = deps.dataDir;
    this.#progress = deps.progress ?? (() => null);
    this.#onMissingThumbnail = deps.onMissingThumbnail ?? (() => undefined);
  }

  /** Thumbnail dan turntable versi sudah ada; yang belum dijadwalkan dibuat. */
  async #thumbnail(assetId: string, version: number): Promise<boolean> {
    const dir = join(assetDirFor(this.#dataDir, assetId), "derived", `v${version}`);
    const files = await Promise.all([isFile(join(dir, THUMB_FILE)), isFile(join(dir, TURNTABLE_FILE))]);
    const ready = files.every(Boolean);
    if (!ready) this.#onMissingThumbnail(assetId, version);
    return ready;
  }

  #record(assetId: string): AssetRecord {
    const record = getAsset(this.#db, assetId);
    if (record === null) throw assetNotFound(assetId);
    return record;
  }

  exists(assetId: string): boolean {
    return getAsset(this.#db, assetId) !== null;
  }

  /**
   * Daftar Gudang: cari, filter, dan urut (bawaan: terakhir diubah dulu). Database dan progres dibaca seketika saat
   * dipanggil; yang ditunggu hanya cek file thumbnail.
   */
  async list(query: AssetListQuery = {}): Promise<AssetList> {
    const rows = searchAssets(this.#db, {
      ...(query.q === undefined || query.q === "" ? {} : { text: query.q }),
      ...(query.tier === undefined ? {} : { tierId: query.tier }),
      ...(query.stage === undefined ? {} : { statuses: STAGE_FILTER_STATUSES[query.stage] }),
      ...(query.since === undefined ? {} : { updatedSince: query.since }),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
    }).map(({ asset, current, versionCount }) => ({
      asset,
      current,
      versionCount,
      // Hanya selama Claude bekerja: persen basi tidak tampil bila build berakhir tanpa event (proses mati).
      progress: asset.state.runState === "running" ? this.#progress(asset.id) : null,
    }));
    const total = countAssets(this.#db);
    const assets = await Promise.all(
      rows.map(async ({ asset, current, versionCount, progress }) => ({
        ...assetView(asset),
        current:
          current === null ? null : currentVersionView(current, await this.#thumbnail(asset.id, current.n)),
        versionCount,
        progress,
      })),
    );
    return { assets, total };
  }

  async detail(assetId: string): Promise<AssetDetail> {
    const record = this.#record(assetId);
    const versions = listVersionRecords(this.#db, assetId);
    const attachments = listAttachments(this.#db, assetId);
    return {
      asset: assetView(record),
      versions: await Promise.all(
        versions.map(async ({ assetId: _id, ...version }) => ({
          ...version,
          thumbnail: await this.#thumbnail(assetId, version.n),
        })),
      ),
      attachments: attachments.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        mime: row.mime,
        size: row.size,
        createdAt: row.createdAt,
      })),
    };
  }

  /** Halaman thread: tanpa `before` = event terbaru; dengan `before` = halaman sebelum seq itu. Urut naik. */
  events(assetId: string, query: Readonly<{ before?: number; limit?: number }> = {}): EventsPage {
    this.#record(assetId);
    const limit = Math.min(query.limit ?? EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX);
    // Halaman terbaru = halaman sebelum seq "tak hingga".
    const before = query.before ?? Number.MAX_SAFE_INTEGER;
    const page = listEvents(this.#db, assetId, { before, limit });
    // seq berurutan mulai 1 per aset, jadi ada event lebih lama bila seq pertama > 1.
    return { events: page.events, hasMore: (page.events[0]?.seq ?? 1) > 1 };
  }

  /** Event setelah `after` untuk replay; `"resync"` bila lebih dari `REPLAY_MAX`. */
  replay(assetId: string, after: number, max = WS_REPLAY_MAX_EVENTS): StoredEvent[] | "resync" {
    const collected: StoredEvent[] = [];
    let cursor = after;
    for (;;) {
      const page = listEvents(this.#db, assetId, { after: cursor, limit: EVENTS_PAGE_MAX });
      collected.push(...page.events);
      if (collected.length > max) return "resync";
      // Halaman tidak penuh = sudah sampai akhir. Baris rusak ikut dihitung, supaya tidak berhenti terlalu cepat.
      if (page.rows < EVENTS_PAGE_MAX || page.lastSeq === null) return collected;
      cursor = page.lastSeq;
    }
  }

  /** File versi: hanya nama di manifest versi itu, atau contact sheet di `derived/vN/`. */
  async versionFile(assetId: string, version: number, name: string): Promise<ServedFile> {
    this.#record(assetId);
    const record = getVersionRecord(this.#db, assetId, version);
    if (record === null) throw new ServiceError("VERSION_NOT_FOUND", `Versi v${version} tidak ditemukan.`);
    const assetDir = assetDirFor(this.#dataDir, assetId);
    if (DERIVED_FILES.has(name)) {
      return this.#served(assetDir, join(assetDir, "derived", `v${version}`, name), "revalidate");
    }
    if (!record.files.some((file) => file.name === name)) throw fileNotFound();
    return this.#served(assetDir, join(versionDir(assetDir, version), name), "immutable");
  }

  /** File utama lampiran (gambar ≤1568 px atau model). */
  async attachmentFile(assetId: string, attachmentId: string): Promise<ServedFile> {
    this.#record(assetId);
    const row = getAttachment(this.#db, assetId, attachmentId);
    if (row === null) throw fileNotFound();
    const assetDir = assetDirFor(this.#dataDir, assetId);
    const served = await this.#served(assetDir, join(assetDir, "refs", row.path), "immutable");
    return row.kind === "model" ? { ...served, contentType: row.mime, downloadName: row.name } : served;
  }

  async #served(assetDir: string, path: string, cache: ServedFile["cache"]): Promise<ServedFile> {
    const checked = await checkedFile(assetDir, path);
    const ext = extname(path).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    return {
      ...checked,
      contentType,
      cache,
      ...(INLINE.has(ext) ? {} : { downloadName: path.slice(path.lastIndexOf(sep) + 1) }),
    };
  }
}

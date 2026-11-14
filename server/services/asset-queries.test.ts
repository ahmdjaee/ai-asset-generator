import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssetStats } from "../../shared/asset-stats.ts";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import { DEFAULT_TIERS, EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX } from "../../shared/limits.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { insertAsset, saveAssetState, setSessionId } from "../db/repos/assets.ts";
import { insertAttachment } from "../db/repos/attachments.ts";
import { appendEvent } from "../db/repos/events.ts";
import { insertVersion } from "../db/repos/versions.ts";
import { INITIAL_STATE } from "../domain/status.ts";
import { AssetQueries, assetDirFor } from "./asset-queries.ts";
import { CONTACT_SHEET_FILE } from "./build-version.ts";
import { ServiceError } from "./errors.ts";
import { createVersion, versionDir, writeDerived } from "./versions.ts";

let dataDir = "";
let handle: DatabaseHandle;
let queries: AssetQueries;

const STATS: AssetStats = {
  triangles: 12,
  vertices: 8,
  materials: 0,
  drawCalls: 1,
  textures: [],
  bbox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
  bytes: 100,
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-queries-"));
  handle = openDatabase(":memory:");
  queries = new AssetQueries({ db: handle.db, dataDir });
});

afterEach(async () => {
  handle.close();
  // Folder versi read-only: buka dulu supaya bisa dihapus.
  const versions = join(dataDir, "assets", "a1", "versions");
  for (const name of await readdir(versions).catch(() => [])) await chmod(join(versions, name), 0o755);
  await rm(dataDir, { recursive: true, force: true });
});

function seed(id: string, now = 1): void {
  insertAsset(handle.db, {
    id,
    name: `Aset ${id}`,
    prompt: "peti",
    tierId: "ringan",
    tier: DEFAULT_TIERS.ringan,
    now,
  });
}

async function code(run: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ServiceError) return error.code;
    throw error;
  }
  throw new Error("tidak ditolak");
}

/** Versi v1 asli (write-once) + indeks database-nya. */
async function seedVersion(id: string): Promise<string> {
  const assetDir = assetDirFor(dataDir, id);
  const manifest = await createVersion({
    assetDir,
    files: [
      { name: "base.glb", data: new Uint8Array([0x67, 0x6c, 0x54, 0x46]) },
      { name: "script.py", data: "import bpy\n" },
    ],
  });
  insertVersion(handle.db, {
    assetId: id,
    n: 1,
    stage: "base",
    stats: STATS,
    budget: { ok: true },
    manifest,
    createdAt: 3,
  });
  return assetDir;
}

describe("AssetQueries — daftar dan detail", () => {
  test("daftar terbaru dulu; tampilan aset tanpa sessionId; detail memuat versi dan lampiran", async () => {
    seed("a1", 1);
    seed("a2", 3);
    setSessionId(handle.db, "a1", "sesi-rahasia", 2);
    await seedVersion("a1");
    insertAttachment(handle.db, {
      id: "g1",
      assetId: "a1",
      kind: "image",
      path: "g1.png",
      name: "foto.png",
      mime: "image/png",
      size: 10,
      sha256: "ab",
      createdAt: 4,
    });

    expect((await queries.list()).assets.map((asset) => asset.id)).toEqual(["a2", "a1"]);
    const detail = await queries.detail("a1");
    expect(detail.asset).toMatchObject({ id: "a1", status: "BRIEFING", runState: "idle", buildsLeft: 8 });
    expect(JSON.stringify(detail)).not.toContain("sesi-rahasia");
    expect(detail.versions).toEqual([
      {
        n: 1,
        stage: "base",
        stats: STATS,
        budgetOk: true,
        files: [
          { name: "base.glb", bytes: 4 },
          { name: "script.py", bytes: 11 },
        ],
        validation: null,
        timings: null,
        optimize: null,
        createdAt: 3,
        thumbnail: false,
      },
    ]);
    expect(detail.attachments).toEqual([
      { id: "g1", kind: "image", name: "foto.png", mime: "image/png", size: 10, createdAt: 4 },
    ]);
    expect(await code(() => queries.detail("tidak-ada"))).toBe("ASSET_NOT_FOUND");
    expect(queries.exists("a1")).toBe(true);
    expect(queries.exists("tidak-ada")).toBe(false);
  });
});

describe("AssetQueries — thumbnail versi", () => {
  test("`thumbnail` hanya bila thumbnail dan turntable sudah ada; yang belum dijadwalkan dibuat di latar", async () => {
    const missing: Array<[string, number]> = [];
    const watched = new AssetQueries({
      db: handle.db,
      dataDir,
      onMissingThumbnail: (assetId, version) => missing.push([assetId, version]),
    });
    seed("a1");
    const assetDir = await seedVersion("a1");
    saveAssetState(handle.db, "a1", { ...INITIAL_STATE, currentVersion: 1 }, 5);
    await writeDerived(assetDir, 1, THUMB_FILE, new Uint8Array([1]));
    // Turntable belum ada: kartu belum bisa berputar, jadi belum dianggap siap.
    expect((await watched.list()).assets[0]?.current).toMatchObject({ n: 1, thumbnail: false });
    expect((await watched.detail("a1")).versions[0]?.thumbnail).toBe(false);
    expect(missing).toEqual([
      ["a1", 1],
      ["a1", 1],
    ]);

    await writeDerived(assetDir, 1, TURNTABLE_FILE, new Uint8Array([2]));
    expect((await watched.list()).assets[0]?.current).toMatchObject({ n: 1, thumbnail: true });
    expect((await watched.detail("a1")).versions[0]?.thumbnail).toBe(true);
    expect(missing).toHaveLength(2);
  });
});

describe("AssetQueries — thread dan replay", () => {
  function notices(count: number) {
    seed("a1");
    for (let index = 1; index <= count; index += 1) {
      appendEvent(handle.db, "a1", { type: "notice", text: `n${index}` }, index);
    }
  }

  test("halaman terbaru dulu, lalu halaman lebih lama lewat `before`; hasMore akurat", () => {
    notices(5);
    const latest = queries.events("a1", { limit: 2 });
    expect(latest.events.map((event) => event.seq)).toEqual([4, 5]);
    expect(latest.hasMore).toBe(true);
    const older = queries.events("a1", { before: 4, limit: 2 });
    expect(older.events.map((event) => event.seq)).toEqual([2, 3]);
    const oldest = queries.events("a1", { before: 2, limit: 2 });
    expect(oldest).toMatchObject({ hasMore: false });
    expect(oldest.events.map((event) => event.seq)).toEqual([1]);
    expect(queries.events("a1").events).toHaveLength(Math.min(5, EVENTS_PAGE_DEFAULT));
  });

  test("thread kosong", () => {
    seed("a1");
    expect(queries.events("a1")).toEqual({ events: [], hasMore: false });
  });

  test("replay melewati baris rusak di batas halaman tanpa berhenti lebih awal", () => {
    seed("a1");
    for (let seq = 1; seq <= EVENTS_PAGE_MAX + 10; seq += 1) {
      if (seq === EVENTS_PAGE_MAX) {
        // Baris format lama/rusak tepat di ujung halaman pertama.
        handle.sqlite.run("insert into events (asset_id, seq, type, payload, ts) values (?, ?, ?, ?, ?)", [
          "a1",
          seq,
          "lama",
          '{"type":"lama"}',
          seq,
        ]);
      } else {
        appendEvent(handle.db, "a1", { type: "notice", text: `n${seq}` }, seq);
      }
    }
    const replayed = queries.replay("a1", 0, 10_000);
    if (replayed === "resync") throw new Error("tidak diharapkan resync");
    expect(replayed).toHaveLength(EVENTS_PAGE_MAX + 9);
    expect(replayed.at(-1)?.seq).toBe(EVENTS_PAGE_MAX + 10);
  });

  test("replay setelah `after`; lebih dari batas → resync", () => {
    notices(7);
    expect(queries.replay("a1", 4, 10)).toMatchObject([{ seq: 5 }, { seq: 6 }, { seq: 7 }]);
    expect(queries.replay("a1", 7, 10)).toEqual([]);
    expect(queries.replay("a1", 0, 5)).toBe("resync");
  });
});

describe("AssetQueries — file versi dan lampiran", () => {
  test("hanya file di manifest; tipe konten, cache immutable, unduhan untuk tipe non-tampil", async () => {
    seed("a1");
    const assetDir = await seedVersion("a1");
    const glb = await queries.versionFile("a1", 1, "base.glb");
    expect(glb).toMatchObject({ contentType: "model/gltf-binary", cache: "immutable", size: 4 });
    expect(glb.downloadName).toBeUndefined();
    expect(glb.path).toBe(join(versionDir(assetDir, 1), "base.glb"));
    expect((await queries.versionFile("a1", 1, "script.py")).contentType).toBe("text/plain; charset=utf-8");
    expect(await code(() => queries.versionFile("a1", 1, "manifest.json"))).toBe("FILE_NOT_FOUND");
    expect(await code(() => queries.versionFile("a1", 1, "../../../app.db"))).toBe("FILE_NOT_FOUND");
    expect(await code(() => queries.versionFile("a1", 2, "base.glb"))).toBe("VERSION_NOT_FOUND");
    expect(await code(() => queries.versionFile("x", 1, "base.glb"))).toBe("ASSET_NOT_FOUND");
  });

  test("contact sheet dari derived/; symlink tidak diikuti", async () => {
    seed("a1");
    const assetDir = await seedVersion("a1");
    expect(await code(() => queries.versionFile("a1", 1, CONTACT_SHEET_FILE))).toBe("FILE_NOT_FOUND");
    await writeDerived(assetDir, 1, CONTACT_SHEET_FILE, new Uint8Array([1, 2, 3]));
    expect(await queries.versionFile("a1", 1, CONTACT_SHEET_FILE)).toMatchObject({
      contentType: "image/png",
      cache: "revalidate",
    });
    const secret = join(dataDir, "rahasia.png");
    await writeFile(secret, "x");
    const sheet = join(assetDir, "derived", "v1", CONTACT_SHEET_FILE);
    await rm(sheet);
    await symlink(secret, sheet);
    expect(await code(() => queries.versionFile("a1", 1, CONTACT_SHEET_FILE))).toBe("FILE_NOT_FOUND");
  });

  test("lampiran: gambar tampil, model diunduh dengan nama asli; path di luar folder aset ditolak", async () => {
    seed("a1");
    const refs = join(assetDirFor(dataDir, "a1"), "refs");
    await mkdir(refs, { recursive: true });
    await writeFile(join(refs, "g1.png"), "png");
    await writeFile(join(refs, "m1.stl"), "stl");
    await writeFile(join(dataDir, "assets", "luar.txt"), "rahasia");
    const row = { assetId: "a1", size: 3, sha256: "ab", createdAt: 1 };
    insertAttachment(handle.db, {
      ...row,
      id: "g1",
      kind: "image",
      path: "g1.png",
      name: "foto.png",
      mime: "image/png",
    });
    insertAttachment(handle.db, {
      ...row,
      id: "m1",
      kind: "model",
      path: "m1.stl",
      name: "cetak.stl",
      mime: "model/stl",
    });
    insertAttachment(handle.db, {
      ...row,
      id: "x1",
      kind: "model",
      path: "../../luar.txt",
      name: "x",
      mime: "x",
    });

    const image = await queries.attachmentFile("a1", "g1");
    expect(image).toMatchObject({ contentType: "image/png", cache: "immutable" });
    expect(image.downloadName).toBeUndefined();
    expect(await queries.attachmentFile("a1", "m1")).toMatchObject({
      contentType: "model/stl",
      downloadName: "cetak.stl",
    });
    expect(await code(() => queries.attachmentFile("a1", "x1"))).toBe("FILE_NOT_FOUND");
    expect(await code(() => queries.attachmentFile("a1", "tidak-ada"))).toBe("FILE_NOT_FOUND");
  });

  test("id aset yang keluar dari folder aset ditolak", () => {
    expect(() => assetDirFor(dataDir, "..")).toThrow(ServiceError);
    expect(() => assetDirFor(dataDir, "a/../../b")).toThrow(ServiceError);
    expect(() => assetDirFor(dataDir, "")).toThrow(ServiceError);
  });
});

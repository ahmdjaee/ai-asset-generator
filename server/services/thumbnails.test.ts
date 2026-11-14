import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { AssetStats } from "../../shared/asset-stats.ts";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import { DEFAULT_TIERS, TURNTABLE_FRAME_PX, TURNTABLE_FRAMES } from "../../shared/limits.ts";
import { removeTree } from "../../tests/support/api.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { insertAsset } from "../db/repos/assets.ts";
import { insertVersion } from "../db/repos/versions.ts";
import type { TurntableOptions } from "../render/renderer.ts";
import { assetDirFor } from "./asset-queries.ts";
import { ThumbnailService, type TurntableRenderer } from "./thumbnails.ts";
import { createVersion } from "./versions.ts";

const STATS: AssetStats = {
  triangles: 12,
  vertices: 8,
  materials: 0,
  drawCalls: 1,
  textures: [],
  bbox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
  bytes: 100,
};

let dataDir = "";
let handle: DatabaseHandle;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-thumbs-"));
  handle = openDatabase(":memory:");
  insertAsset(handle.db, {
    id: "a1",
    name: "Peti",
    prompt: "peti",
    tierId: "sedang",
    tier: DEFAULT_TIERS.sedang,
    now: 1,
  });
});

afterEach(async () => {
  handle.close();
  await removeTree(dataDir);
});

async function addVersion(n: number, stage: "base" | "textured", files: readonly string[]): Promise<void> {
  const manifest = await createVersion({
    assetDir: assetDirFor(dataDir, "a1"),
    files: files.map((name) => ({ name, data: `isi ${name}` })),
    meta: { stage },
  });
  insertVersion(handle.db, {
    assetId: "a1",
    n,
    stage,
    stats: STATS,
    budget: { ok: true },
    manifest,
    createdAt: 1,
  });
}

/** Renderer tiruan: frame PNG transparan berukuran benar; mencatat GLB dan mode yang diminta. */
class FakeRenderer implements TurntableRenderer {
  readonly calls: Array<{ glb: string; mode: TurntableOptions["mode"] }> = [];
  failNext = false;
  #release: (() => void) | null = null;
  #gate: Promise<void> | null = null;
  #waiters: Array<{ count: number; resolve: () => void }> = [];

  /** Selesai saat render ke-`count` sudah dimulai. */
  started(count: number): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push({ count, resolve }));
  }

  /** Render berikutnya ditahan sampai `release()`. */
  hold(): void {
    this.#gate = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release?.();
  }

  async turntable(glb: Uint8Array, options: TurntableOptions) {
    this.calls.push({ glb: new TextDecoder().decode(glb), mode: options.mode });
    for (const waiter of this.#waiters.filter((item) => item.count <= this.calls.length)) waiter.resolve();
    this.#waiters = this.#waiters.filter((item) => item.count > this.calls.length);
    if (this.#gate !== null) await this.#gate;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("renderer mati");
    }
    const png = new Uint8Array(
      await sharp({
        create: { ...TURNTABLE_FRAME_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer(),
    );
    return { frames: Array.from({ length: TURNTABLE_FRAMES }, () => png), durationMs: 1 };
  }
}

function derived(version: number, name: string): string {
  return join(assetDirFor(dataDir, "a1"), "derived", `v${version}`, name);
}

describe("ThumbnailService", () => {
  test("dibuat sekali dari web.glb (Clay untuk bentuk dasar, Tekstur untuk aset final)", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    await addVersion(2, "textured", ["final.glb"]);
    const renderer = new FakeRenderer();
    const service = new ThumbnailService({ db: handle.db, dataDir, renderer });

    expect(await service.ensure("a1", 1)).toBe(true);
    expect(await service.ensure("a1", 1)).toBe(true);
    expect(await service.ensure("a1", 2)).toBe(true);
    expect(renderer.calls).toEqual([
      { glb: "isi web.glb", mode: "clay" },
      { glb: "isi final.glb", mode: "texture" },
    ]);
    for (const name of [THUMB_FILE, TURNTABLE_FILE]) {
      expect((await sharp(await readFile(derived(1, name))).metadata()).format).toBe("webp");
    }
  });

  test("permintaan bersamaan menunggu render yang sama", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    const renderer = new FakeRenderer();
    renderer.hold();
    const service = new ThumbnailService({ db: handle.db, dataDir, renderer });
    const first = service.ensure("a1", 1);
    const second = service.ensure("a1", 1);
    expect(second).toBe(first);
    renderer.release();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(renderer.calls).toHaveLength(1);
  });

  test("tanpa renderer (mode fixture): hanya file yang sudah ada; versi atau aset tidak dikenal → false", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    const service = new ThumbnailService({ db: handle.db, dataDir, renderer: null });
    expect(await service.ensure("a1", 1)).toBe(false);
    expect(await stat(derived(1, THUMB_FILE)).catch(() => null)).toBeNull();

    const withRenderer = new ThumbnailService({ db: handle.db, dataDir, renderer: new FakeRenderer() });
    expect(await withRenderer.ensure("a1", 9)).toBe(false);
    expect(await withRenderer.ensure("tidak-ada", 1)).toBe(false);

    // Setelah dibuat (mis. sebelum server pindah ke mode fixture), file yang ada tetap tersedia tanpa renderer.
    expect(await withRenderer.ensure("a1", 1)).toBe(true);
    expect(await service.ensure("a1", 1)).toBe(true);
  });

  test("render gagal → onError dan false; permintaan berikutnya mencoba lagi", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    const renderer = new FakeRenderer();
    renderer.failNext = true;
    const errors: unknown[] = [];
    const service = new ThumbnailService({
      db: handle.db,
      dataDir,
      renderer,
      onError: (error, context) => errors.push([String(error), context]),
    });
    expect(await service.ensure("a1", 1)).toBe(false);
    expect(errors).toEqual([["Error: renderer mati", { assetId: "a1", version: 1 }]]);
    expect(await service.ensure("a1", 1)).toBe(true);
    expect(renderer.calls).toHaveLength(2);
  });

  test("schedule: dibuat di latar satu per satu (urut, tanpa duplikat); onReady hanya setelah file baru dibuat", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    await addVersion(2, "base", ["base.glb", "web.glb"]);
    const renderer = new FakeRenderer();
    renderer.hold();
    const ready: Array<[string, number]> = [];
    const service = new ThumbnailService({
      db: handle.db,
      dataDir,
      renderer,
      onReady: (assetId, version) => ready.push([assetId, version]),
    });
    service.schedule("a1", 1);
    service.schedule("a1", 2);
    service.schedule("a1", 1);
    await renderer.started(1);
    // Render kedua menunggu yang pertama: build tidak pernah antre di belakang banyak turntable.
    expect(renderer.calls).toHaveLength(1);
    renderer.release();
    await service.settled();
    expect(renderer.calls).toHaveLength(2);
    expect(ready).toEqual([
      ["a1", 1],
      ["a1", 2],
    ]);

    service.schedule("a1", 1);
    await service.settled();
    expect([renderer.calls.length, ready.length]).toEqual([2, 2]);
  });

  test("schedule: versi yang gagal tidak dicoba lagi di latar; ensure (setelah build) tetap mencoba", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    const renderer = new FakeRenderer();
    renderer.failNext = true;
    const errors: unknown[] = [];
    const service = new ThumbnailService({
      db: handle.db,
      dataDir,
      renderer,
      onError: (error) => errors.push(error),
    });
    service.schedule("a1", 1);
    await service.settled();
    service.schedule("a1", 1);
    await service.settled();
    expect([renderer.calls.length, errors.length]).toEqual([1, 1]);
    expect(await service.ensure("a1", 1)).toBe(true);

    const fixture = new ThumbnailService({ db: handle.db, dataDir, renderer: null });
    fixture.schedule("a1", 1);
    await fixture.settled();
    expect(renderer.calls).toHaveLength(2);
  });

  test("settleAsset: antrean aset itu dibuang, render yang sedang berjalan ditunggu", async () => {
    await addVersion(1, "base", ["base.glb", "web.glb"]);
    await addVersion(2, "base", ["base.glb", "web.glb"]);
    const renderer = new FakeRenderer();
    renderer.hold();
    const service = new ThumbnailService({ db: handle.db, dataDir, renderer });
    service.schedule("a1", 1);
    service.schedule("a1", 2);
    await renderer.started(1);
    let settled = false;
    const settling = service.settleAsset("a1").then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    renderer.release();
    await settling;
    expect((await stat(derived(1, THUMB_FILE))).isFile()).toBe(true);
    await service.settled();
    expect(renderer.calls).toHaveLength(1);
  });
});

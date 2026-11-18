/** Renderer Chromium + SwiftShader. Butuh browser Playwright; dijalankan lewat `bun run test:pipeline`. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { writeGlb } from "../../server/pipeline/io.ts";
import { processGlb } from "../../server/pipeline/process.ts";
import { texturedDocument } from "../../server/pipeline/test-documents.ts";
import { RENDER_VIEWS } from "../../server/render/protocol.ts";
import { Renderer, type RenderOutput } from "../../server/render/renderer.ts";
import {
  CONTACT_SHEET_MAX_PX,
  RENDER_MAX_GLB_BYTES,
  RENDER_TILE_PX,
  TURNTABLE_FRAME_PX,
  TURNTABLE_FRAMES,
} from "../../shared/limits.ts";
import { compareGolden, decodePng, diffRatio, GOLDEN_MAX_DIFF_RATIO, type Raw } from "./golden.ts";

const FIXTURES = join(import.meta.dir, "../fixtures/glb");
/** Tinggi label di pojok kiri-atas tile; diabaikan saat membandingkan antar-sudut. */
const LABEL_PX = 40;

const renderer = new Renderer();
afterAll(async () => {
  await renderer.close();
});

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(FIXTURES, `${name}.glb`)));
}

async function withoutLabel(png: Uint8Array): Promise<Raw> {
  const cropped = await sharp(png)
    .extract({ left: 0, top: LABEL_PX, width: RENDER_TILE_PX, height: RENDER_TILE_PX - LABEL_PX })
    .png()
    .toBuffer();
  return decodePng(new Uint8Array(cropped));
}

async function expectViewsValid(output: RenderOutput): Promise<void> {
  expect(output.tiles.map((tile) => tile.view)).toEqual([...RENDER_VIEWS]);
  for (const tile of output.tiles) {
    expect(tile.coverage).toBeGreaterThanOrEqual(0.02);
    expect(tile.coverage).toBeLessThanOrEqual(0.8);
    expect(tile.centroid).not.toBeNull();
    const [x, y] = tile.centroid ?? [0, 0];
    expect(Math.abs(x - 0.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(y - 0.5)).toBeLessThanOrEqual(0.1);
  }
  const bodies = await Promise.all(output.tiles.map((tile) => withoutLabel(tile.png)));
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (a === undefined || b === undefined) continue;
      expect(diffRatio(a, b), `${output.tiles[i]?.view} vs ${output.tiles[j]?.view}`).toBeGreaterThan(0.005);
    }
  }
  expect(Math.max(output.sheet.width, output.sheet.height)).toBeLessThanOrEqual(CONTACT_SHEET_MAX_PX);
}

describe("renderer", () => {
  beforeAll(async () => {
    // Pemanasan: peluncuran browser dan bundle halaman tidak dihitung di tes performa.
    await renderer.rendererInfo();
  });

  test("memakai SwiftShader", async () => {
    expect(await renderer.rendererInfo()).toContain("SwiftShader");
  });

  for (const name of ["peti", "kursi", "laras"]) {
    test(`${name}: 6 sudut valid, contact sheet cocok golden`, async () => {
      const output = await renderer.render(await fixture(name), { mode: "clay" });
      await expectViewsValid(output);
      expect(output.sheet).toMatchObject({ width: 1016, height: 680 });
      const golden = await compareGolden(`${name}-clay`, output.sheet.png);
      expect(golden.ratio).toBeLessThanOrEqual(GOLDEN_MAX_DIFF_RATIO);
    });
  }

  test("mode wireframe cocok golden", async () => {
    const output = await renderer.render(await fixture("kursi"), { mode: "wireframe" });
    await expectViewsValid(output);
    expect((await compareGolden("kursi-wireframe", output.sheet.png)).ratio).toBeLessThanOrEqual(
      GOLDEN_MAX_DIFF_RATIO,
    );
  });

  test("halaman render dipakai ulang tanpa menimbun objek GPU (wireframe, clay, tekstur)", async () => {
    const kursi = await fixture("kursi");
    const textured = await writeGlb(await texturedDocument(256));
    // Pemanasan: lingkungan PMREM dan program shader dibuat sekali per halaman.
    await renderer.render(kursi, { mode: "wireframe", views: ["front"] });
    const before = await renderer.gpuMemory();
    expect(before.geometries + before.textures).toBeGreaterThan(0);
    for (const [glb, mode] of [
      [kursi, "wireframe"],
      [kursi, "clay"],
      [textured, "texture"],
      [kursi, "wireframe"],
    ] as const) {
      await renderer.render(glb, { mode, views: ["front"] });
      expect(await renderer.gpuMemory(), mode).toEqual(before);
    }
  });

  test("mode tekstur dari web.glb (meshopt + WebP) cocok golden", async () => {
    const processed = await processGlb(await writeGlb(await texturedDocument(512)), {
      tierId: "sedang",
      stage: "textured",
    });
    const web = processed.web ?? new Uint8Array();
    const output = await renderer.render(web, { mode: "texture", views: ["top", "three_quarter"] });
    expect(output.tiles.map((tile) => tile.view)).toEqual(["top", "three_quarter"]);
    expect(output.sheet).toMatchObject({ width: 680, height: 344 });
    expect((await compareGolden("grid-texture", output.sheet.png)).ratio).toBeLessThanOrEqual(
      GOLDEN_MAX_DIFF_RATIO,
    );
  });

  test("GLB meshopt dan GLB biasa menghasilkan siluet yang sama", async () => {
    const processed = await processGlb(await fixture("kursi"), { tierId: "sedang", stage: "base" });
    const [plain, web] = await Promise.all([
      renderer.render(processed.glb, { views: ["front"] }),
      renderer.render(processed.web ?? new Uint8Array(), { views: ["front"] }),
    ]);
    expect(Math.abs((plain.tiles[0]?.coverage ?? 0) - (web.tiles[0]?.coverage ?? 1))).toBeLessThan(0.002);
    expect(web.triangles).toBe(processed.stats.triangles);
  });

  test("6 sudut ≤ 8 dtk (p95 dari 10 render)", async () => {
    const glb = await fixture("laras");
    const durations: number[] = [];
    for (let run = 0; run < 10; run++) durations.push((await renderer.render(glb)).durationMs);
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(`render 6 sudut: p95 ${p95} ms, median ${durations[4]} ms`);
    expect(p95).toBeLessThanOrEqual(8000);
  }, 120_000);
});

/** Alpha piksel (x, y) gambar RGBA mentah. */
function alphaAt(raw: Raw, x: number, y: number): number {
  return raw.data[(y * raw.width + x) * 4 + 3] ?? -1;
}

/** Bagian gambar yang buram penuh (objek) dan yang tembus sebagian (bayangan dan tepi). */
function alphaShares(raw: Raw): { opaque: number; partial: number } {
  let opaque = 0;
  let partial = 0;
  for (let index = 3; index < raw.data.length; index += 4) {
    const alpha = raw.data[index] ?? 0;
    if (alpha === 255) opaque += 1;
    else if (alpha > 0) partial += 1;
  }
  const total = raw.width * raw.height;
  return { opaque: opaque / total, partial: partial / total };
}

describe("turntable (thumbnail Gudang)", () => {
  test("peti Clay: 24 frame 504×378, latar transparan, bayangan di lantai, berputar; frame 0 cocok golden", async () => {
    const output = await renderer.turntable(await fixture("peti"), { mode: "clay" });
    console.info(`turntable 24 frame: ${output.durationMs} ms`);
    expect(output.frames).toHaveLength(TURNTABLE_FRAMES);
    const raws = await Promise.all(output.frames.map(decodePng));
    for (const raw of raws)
      expect([raw.width, raw.height]).toEqual([TURNTABLE_FRAME_PX.width, TURNTABLE_FRAME_PX.height]);
    const [first, quarter] = [raws[0], raws[TURNTABLE_FRAMES / 4]];
    if (first === undefined || quarter === undefined) throw new Error("frame kurang");
    for (const [x, y] of [
      [0, 0],
      [first.width - 1, 0],
      [0, first.height - 1],
      [first.width - 1, first.height - 1],
    ] as const) {
      expect(alphaAt(first, x, y)).toBe(0);
    }
    const shares = alphaShares(first);
    expect(shares.opaque).toBeGreaterThan(0.05);
    expect(shares.opaque).toBeLessThan(0.6);
    // Bayangan lembut: area tembus sebagian jauh lebih luas daripada tepi antialias saja.
    expect(shares.partial).toBeGreaterThan(0.03);
    expect(diffRatio(first, quarter)).toBeGreaterThan(0.01);
    expect(
      (await compareGolden("peti-turntable-0", output.frames[0] ?? new Uint8Array())).ratio,
    ).toBeLessThanOrEqual(GOLDEN_MAX_DIFF_RATIO);
  }, 120_000);

  test("mode Tekstur dari web.glb (meshopt + WebP): warna material tampil", async () => {
    const processed = await processGlb(await writeGlb(await texturedDocument(512)), {
      tierId: "sedang",
      stage: "textured",
    });
    const output = await renderer.turntable(processed.web ?? new Uint8Array(), { mode: "texture" });
    expect(
      (await compareGolden("grid-turntable-0", output.frames[0] ?? new Uint8Array())).ratio,
    ).toBeLessThanOrEqual(GOLDEN_MAX_DIFF_RATIO);
  }, 120_000);

  test("halaman dipakai ulang tanpa menimbun objek GPU (turntable lalu contact sheet)", async () => {
    const peti = await fixture("peti");
    // Pemanasan: segitiga layar penuh blur VSM dibuat sekali per halaman.
    await renderer.turntable(peti, { mode: "clay" });
    const before = await renderer.gpuMemory();
    await renderer.turntable(peti, { mode: "clay" });
    expect(await renderer.gpuMemory()).toEqual(before);
    await renderer.render(peti, { views: ["front"] });
    expect(await renderer.gpuMemory()).toEqual(before);
  }, 120_000);
});

describe("pemulihan renderer", () => {
  test("browser mati → diluncurkan ulang otomatis", async () => {
    const glb = await fixture("peti");
    await renderer.render(glb, { views: ["front"] });
    const launches = renderer.launches;
    await renderer.simulateCrash();
    const output = await renderer.render(glb, { views: ["front"] });
    expect(output.tiles).toHaveLength(1);
    expect(renderer.launches).toBe(launches + 1);
  });

  test("render yang melewati batas waktu dihentikan, render berikutnya tetap jalan", async () => {
    const glb = await fixture("laras");
    await expect(renderer.render(glb, { timeoutMs: 1 })).rejects.toMatchObject({ code: "RENDER_TIMEOUT" });
    expect((await renderer.render(glb, { views: ["front"] })).tiles).toHaveLength(1);
  });

  test("render dibatalkan lewat AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderer.render(await fixture("laras"), { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "RENDER_CANCELLED",
    });
    const running = new AbortController();
    const pending = renderer.render(await fixture("laras"), { signal: running.signal });
    running.abort();
    await expect(pending).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
  });

  test("GLB rusak → RENDER_FAILED, bukan crash", async () => {
    await expect(renderer.render(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "RENDER_FAILED",
    });
    expect((await renderer.render(await fixture("peti"), { views: ["top"] })).tiles).toHaveLength(1);
  });

  test("kebijakan restart: browser diluncurkan ulang setelah N render dan ditutup saat menganggur", async () => {
    const pending: Array<() => void> = [];
    const recycling = new Renderer({
      recycleAfter: 2,
      idleCloseMs: 60_000,
      schedule: (run) => {
        pending.push(run);
        return () => pending.splice(pending.indexOf(run), 1);
      },
    });
    try {
      const glb = await fixture("peti");
      await recycling.render(glb, { views: ["front"] });
      await recycling.render(glb, { views: ["front"] });
      expect(recycling.launches).toBe(1);
      // Render ketiga melewati batas daur ulang: browser baru.
      await recycling.render(glb, { views: ["front"] });
      expect(recycling.launches).toBe(2);
      // Hanya satu penutupan saat menganggur yang tertunda (render baru membatalkan yang lama).
      expect(pending).toHaveLength(1);
      await pending.shift()?.();
      expect(recycling.running).toBe(false);
      expect((await recycling.render(glb, { views: ["front"] })).tiles).toHaveLength(1);
      expect(recycling.launches).toBe(3);
    } finally {
      await recycling.close();
    }
    expect(pending).toHaveLength(0);
  }, 60_000);

  test("GLB terlalu besar ditolak sebelum dikirim ke browser", async () => {
    await expect(renderer.render(new Uint8Array(RENDER_MAX_GLB_BYTES + 1))).rejects.toMatchObject({
      code: "MODEL_TOO_LARGE",
    });
  });
});

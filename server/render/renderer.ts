/**
 * Satu-satunya pintu ke Chromium renderer (AGENTS.md §3). GLB → tile per sudut → contact sheet, dan GLB → frame
 * turntable (thumbnail Gudang).
 * - Satu browser hidup lama dan satu halaman yang dipakai ulang; render dijalankan satu per satu.
 * - Halaman tidak punya akses jaringan: semua request dilayani `page.route` dari memori (tanpa port terbuka),
 *   request lain diblokir.
 * - Browser atau halaman yang crash dibuat ulang otomatis; satu render dicoba ulang sekali setelah crash.
 * - Kebijakan restart: browser diluncurkan ulang setelah `RENDER_RECYCLE_AFTER` render dan ditutup setelah menganggur
 *   `RENDER_IDLE_CLOSE_MS`; render berikutnya meluncurkannya lagi.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { z } from "zod";
import {
  RENDER_IDLE_CLOSE_MS,
  RENDER_MAX_GLB_BYTES,
  RENDER_RECYCLE_AFTER,
  RENDER_TILE_PX,
  RENDER_TIMEOUT_MS,
  TURNTABLE_FRAME_PX,
  TURNTABLE_FRAMES,
  TURNTABLE_TIMEOUT_MS,
} from "../../shared/limits.ts";
import { Semaphore } from "../jobs/semaphore.ts";
import { type ContactSheet, composeContactSheet } from "./contact-sheet.ts";
import {
  GpuMemory,
  type PageRenderRequest,
  PageRenderResult,
  type PageTurntableRequest,
  PageTurntableResult,
  RENDER_VIEWS,
  type RenderMode,
  type RenderView,
  VIEW_LABELS,
} from "./protocol.ts";

const ORIGIN = "http://aag-render.invalid";
const CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<script type="module" src="/main.js"></script></body></html>`;

export class RenderError extends Error {
  readonly code: "RENDER_TIMEOUT" | "RENDER_CANCELLED" | "RENDER_FAILED" | "MODEL_TOO_LARGE";

  constructor(code: RenderError["code"], message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

export type RenderOptions = Readonly<{
  mode?: RenderMode;
  views?: readonly RenderView[];
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type RenderedTile = Readonly<{
  view: RenderView;
  png: Uint8Array;
  coverage: number;
  centroid: readonly [number, number] | null;
}>;

export type TurntableOptions = Readonly<{
  mode: "clay" | "texture";
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type TurntableOutput = Readonly<{
  /** PNG RGBA per frame (`TURNTABLE_FRAME_PX`), berurutan searah putaran. */
  frames: readonly Uint8Array[];
  durationMs: number;
}>;

export type RenderOutput = Readonly<{
  sheet: ContactSheet;
  tiles: readonly RenderedTile[];
  gridCellM: number;
  triangles: number;
  durationMs: number;
}>;

let bundlePromise: Promise<string> | undefined;

/** Bundle halaman render (three + GLTFLoader + decoder meshopt) dari `page/main.ts`, dibuat sekali per proses. */
function pageBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, "page/main.ts")],
      target: "browser",
      minify: true,
    });
    const output = result.outputs[0];
    if (!result.success || output === undefined) {
      throw new RenderError("RENDER_FAILED", `Bundle halaman render gagal: ${result.logs.join("\n")}`);
    }
    return output.text();
  })();
  return bundlePromise;
}

function dataUrlToBytes(url: string): Uint8Array {
  return new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
}

function checkSize(glb: Uint8Array): void {
  if (glb.byteLength > RENDER_MAX_GLB_BYTES) {
    throw new RenderError("MODEL_TOO_LARGE", `GLB ${glb.byteLength} byte melewati batas renderer`);
  }
}

/** Menjadwalkan `run` setelah `ms`; hasilnya pembatal. Disuntikkan di tes supaya tanpa menunggu waktu nyata. */
export type Schedule = (run: () => Promise<void>, ms: number) => () => void;

const realSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(() => void run().catch(() => undefined), ms);
  // Timer menganggur tidak boleh menahan proses tetap hidup (skrip CLI, tes).
  timer.unref();
  return () => clearTimeout(timer);
};

export type RendererOptions = Readonly<{
  recycleAfter?: number;
  idleCloseMs?: number;
  schedule?: Schedule;
}>;

export class Renderer {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly models = new Map<string, Uint8Array>();
  private readonly pageErrors: string[] = [];
  private readonly lock = new Semaphore(1);
  /** Berapa kali browser diluncurkan (untuk tes dan log). */
  launches = 0;
  private rendersSinceLaunch = 0;
  private cancelIdle: (() => void) | null = null;
  private readonly recycleAfter: number;
  private readonly idleCloseMs: number;
  private readonly schedule: Schedule;

  constructor(options: RendererOptions = {}) {
    this.recycleAfter = options.recycleAfter ?? RENDER_RECYCLE_AFTER;
    this.idleCloseMs = options.idleCloseMs ?? RENDER_IDLE_CLOSE_MS;
    this.schedule = options.schedule ?? realSchedule;
  }

  /** Browser sedang hidup (untuk tes dan log). */
  get running(): boolean {
    return this.browser?.isConnected() === true;
  }

  /** String renderer WebGL, mis. "ANGLE (Google, Vulkan … (SwiftShader …))". */
  async rendererInfo(): Promise<string> {
    const page = await this.ensurePage();
    return z.string().parse(await page.evaluate("window.aagRendererInfo()"));
  }

  /** Geometri dan tekstur di GPU halaman render; harus kembali ke angka semula setelah setiap render. */
  async gpuMemory(): Promise<GpuMemory> {
    const page = await this.ensurePage();
    return GpuMemory.parse(await page.evaluate("window.aagGpuMemory()"));
  }

  async render(glb: Uint8Array, options: RenderOptions = {}): Promise<RenderOutput> {
    checkSize(glb);
    return this.exclusive(() => this.renderOnce(glb, options));
  }

  /**
   * Turntable Gudang: `TURNTABLE_FRAMES` frame PNG berlatar transparan, model diputar penuh di sumbu tegak (kamera
   * dan lampu tetap). Disusun menjadi strip WebP oleh `composeTurntable`.
   */
  async turntable(glb: Uint8Array, options: TurntableOptions): Promise<TurntableOutput> {
    checkSize(glb);
    return this.exclusive(() => this.turntableOnce(glb, options));
  }

  async close(): Promise<void> {
    this.cancelIdle?.();
    this.cancelIdle = null;
    await this.closeBrowser();
  }

  private async closeBrowser(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    await browser?.close();
  }

  /** Khusus tes: mematikan browser seolah crash. */
  async simulateCrash(): Promise<void> {
    await this.browser?.close();
  }

  /** Satu render pada satu waktu; browser atau halaman yang mati di tengah jalan diluncurkan ulang, dicoba sekali lagi. */
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    this.cancelIdle?.();
    this.cancelIdle = null;
    const release = await this.lock.acquire();
    try {
      if (this.rendersSinceLaunch >= this.recycleAfter) await this.closeBrowser();
      try {
        return await run();
      } catch (error) {
        if (error instanceof RenderError || (this.page !== null && this.browser?.isConnected())) throw error;
        return await run();
      }
    } finally {
      this.rendersSinceLaunch += 1;
      release();
      this.scheduleIdleClose();
    }
  }

  /** Menutup browser setelah menganggur; render yang datang lebih dulu membatalkannya. */
  private scheduleIdleClose(): void {
    this.cancelIdle?.();
    this.cancelIdle = this.schedule(async () => {
      this.cancelIdle = null;
      const release = await this.lock.acquire();
      try {
        await this.closeBrowser();
      } finally {
        release();
      }
    }, this.idleCloseMs);
  }

  private async renderOnce(glb: Uint8Array, options: RenderOptions): Promise<RenderOutput> {
    const startedAt = performance.now();
    const views = options.views ?? RENDER_VIEWS;
    const raw = await this.evaluateModel(
      glb,
      {
        timeoutMs: options.timeoutMs ?? RENDER_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (modelUrl) => {
        const request: PageRenderRequest = {
          modelUrl,
          mode: options.mode ?? "clay",
          views,
          tilePx: RENDER_TILE_PX,
          labels: VIEW_LABELS,
        };
        return `window.aagRender(${JSON.stringify(request)})`;
      },
    );
    const parsed = PageRenderResult.safeParse(raw);
    if (!parsed.success) {
      throw new RenderError("RENDER_FAILED", `Hasil halaman render tidak valid: ${parsed.error.message}`);
    }
    const tiles = parsed.data.tiles.map((tile) => ({
      view: tile.view,
      png: dataUrlToBytes(tile.png),
      coverage: tile.coverage,
      centroid: tile.centroid,
    }));
    const sheet = await composeContactSheet(tiles.map((tile) => ({ png: tile.png, size: RENDER_TILE_PX })));
    return {
      sheet,
      tiles,
      gridCellM: parsed.data.gridCellM,
      triangles: parsed.data.triangles,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  private async turntableOnce(glb: Uint8Array, options: TurntableOptions): Promise<TurntableOutput> {
    const startedAt = performance.now();
    const raw = await this.evaluateModel(
      glb,
      {
        timeoutMs: options.timeoutMs ?? TURNTABLE_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (modelUrl) => {
        const request: PageTurntableRequest = {
          modelUrl,
          mode: options.mode,
          frames: TURNTABLE_FRAMES,
          ...TURNTABLE_FRAME_PX,
        };
        return `window.aagTurntable(${JSON.stringify(request)})`;
      },
    );
    const parsed = PageTurntableResult.safeParse(raw);
    if (!parsed.success || parsed.data.frames.length !== TURNTABLE_FRAMES) {
      throw new RenderError("RENDER_FAILED", "Hasil turntable halaman render tidak valid");
    }
    return {
      frames: parsed.data.frames.map(dataUrlToBytes),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  /**
   * Menjalankan satu ekspresi halaman render untuk satu model: model dilayani dari memori lewat token acak, dengan
   * batas waktu dan pembatalan. Halaman yang macet atau dibatalkan dibuang (render berikutnya memakai halaman baru).
   */
  private async evaluateModel(
    glb: Uint8Array,
    options: Readonly<{ timeoutMs: number; signal?: AbortSignal }>,
    expression: (modelUrl: string) => string,
  ): Promise<unknown> {
    if (options.signal?.aborted) throw new RenderError("RENDER_CANCELLED", "Render dibatalkan");
    const page = await this.ensurePage();
    const token = randomBytes(8).toString("hex");
    this.models.set(token, glb);
    this.pageErrors.length = 0;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RenderError("RENDER_TIMEOUT", "Render melewati batas waktu")),
        options.timeoutMs,
      );
      onAbort = () => reject(new RenderError("RENDER_CANCELLED", "Render dibatalkan"));
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });

    try {
      // Ekspresi string: kode server tidak memakai tipe DOM. Isi request dibuat server sendiri (token hex, enum).
      return await Promise.race([page.evaluate(expression(`${ORIGIN}/model/${token}.glb`)), stopped]);
    } catch (error) {
      if (error instanceof RenderError) {
        await this.resetPage();
        throw error;
      }
      const detail = this.pageErrors.length > 0 ? ` (${this.pageErrors.join("; ")})` : "";
      if (this.page === null || !this.browser?.isConnected()) throw error;
      throw new RenderError(
        "RENDER_FAILED",
        `${error instanceof Error ? error.message : String(error)}${detail}`,
      );
    } finally {
      clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
      this.models.delete(token);
    }
  }

  private async resetPage(): Promise<void> {
    const page = this.page;
    this.page = null;
    await page?.close().catch(() => undefined);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const browser = await chromium.launch({ args: CHROMIUM_ARGS });
    this.launches += 1;
    this.rendersSinceLaunch = 0;
    browser.on("disconnected", () => {
      if (this.browser === browser) {
        this.browser = null;
        this.page = null;
      }
    });
    this.browser = browser;
    return browser;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page !== null && !this.page.isClosed() && this.browser?.isConnected()) return this.page;
    const browser = await this.ensureBrowser();
    const bundle = await pageBundle();
    const context = await browser.newContext({ viewport: { width: RENDER_TILE_PX, height: RENDER_TILE_PX } });
    const page = await context.newPage();
    page.on("pageerror", (error) => this.pageErrors.push(error.message));
    page.on("crash", () => {
      if (this.page === page) this.page = null;
    });
    page.on("close", () => {
      void context.close().catch(() => undefined);
    });
    await context.route("**/*", (route) => this.serve(route, bundle));
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction("window.aagReady === true", null, { timeout: RENDER_TIMEOUT_MS });
    this.page = page;
    return page;
  }

  private async serve(route: Route, bundle: string): Promise<void> {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort("blockedbyclient");
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: PAGE_HTML });
    if (url.pathname === "/main.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    const match = /^\/model\/([0-9a-f]{16})\.glb$/.exec(url.pathname);
    const model = match?.[1] === undefined ? undefined : this.models.get(match[1]);
    if (model === undefined) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: "model/gltf-binary", body: Buffer.from(model) });
  }
}

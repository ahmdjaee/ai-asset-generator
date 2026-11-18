/**
 * Status runtime 3D untuk `/api/health/runtime` dan Pengaturan (PLAN Tahap 11), plus aksi "Bangun image".
 * - Cek: Docker terjangkau, image tag sekarang ada, versi Blender, renderer Chromium, jumlah material pustaka.
 * - Hasil di-cache 30 detik; bangun image berjalan di latar (satu sekaligus) dan mengabarkan topik `global`.
 * - Mode `RUNTIME_DRIVER=fixture` tidak memakai Docker: selalu siap.
 */
import type { RuntimeStatus } from "../../shared/health.ts";
import type { Clock } from "./asset-store.ts";
import type { EventBus } from "./bus.ts";
import { ServiceError } from "./errors.ts";

export const RUNTIME_STATUS_CACHE_MS = 30_000;
/** Pesan error build yang ditampilkan (ekor output docker) dipotong ke panjang ini. */
const BUILD_ERROR_MAX_CHARS = 2000;

/** Pemeriksaan nyata; tes menyuntikkan versi palsu. Semua lewat `server/runtime/` dan `server/render/`. */
export type RuntimeChecks = Readonly<{
  dockerVersion(): Promise<string | null>;
  imageTag(): Promise<string>;
  imageExists(tag: string): Promise<boolean>;
  blenderVersion(): Promise<string | null>;
  /** String renderer WebGL; gagal = renderer tidak bisa dipakai. `null` = mode tanpa renderer. */
  rendererInfo: (() => Promise<string>) | null;
  materialsCount(): Promise<number>;
  buildImage(tag: string, signal: AbortSignal): Promise<void>;
}>;

export type RuntimeStatusDeps = Readonly<{
  driver: "docker" | "fixture";
  checks: RuntimeChecks;
  now: Clock;
  bus?: EventBus;
  onError?: (error: unknown, op: string) => void;
}>;

type BuildState = RuntimeStatus["build"];

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > BUILD_ERROR_MAX_CHARS ? `…${text.slice(-BUILD_ERROR_MAX_CHARS)}` : text;
}

export class RuntimeStatusService {
  readonly #deps: RuntimeStatusDeps;
  #cache: RuntimeStatus | undefined;
  #inflight: Promise<RuntimeStatus> | undefined;
  #build: BuildState = { state: "idle", startedAt: null, endedAt: null, error: null };
  #building: Promise<void> | undefined;
  #starting = false;
  readonly #abort = new AbortController();

  constructor(deps: RuntimeStatusDeps) {
    this.#deps = deps;
  }

  async status(options: { fresh?: boolean } = {}): Promise<RuntimeStatus> {
    const cache = this.#cache;
    if (
      options.fresh !== true &&
      cache !== undefined &&
      this.#deps.now() - cache.checkedAt < RUNTIME_STATUS_CACHE_MS
    )
      return { ...cache, build: this.#build };
    this.#inflight ??= this.#check().finally(() => {
      this.#inflight = undefined;
    });
    const result = await this.#inflight;
    this.#cache = result;
    return { ...result, build: this.#build };
  }

  /** Mulai `docker build` di latar. Ditolak bila mode fixture, sedang membangun, atau Docker tidak terjangkau. */
  async buildImage(): Promise<RuntimeStatus> {
    if (this.#deps.driver === "fixture")
      throw new ServiceError("RUNTIME_UNAVAILABLE", "Mode fixture tidak memakai image Docker.");
    // Ditandai sebelum await pertama: dua klik cepat tidak boleh memulai dua build.
    if (this.#starting || this.#building !== undefined)
      throw new ServiceError("RUNTIME_BUSY", "Image sedang dibangun.");
    this.#starting = true;
    try {
      const { checks } = this.#deps;
      if ((await checks.dockerVersion()) === null)
        throw new ServiceError("RUNTIME_UNAVAILABLE", "Docker tidak terjangkau. Nyalakan Docker dulu.");
      const tag = await checks.imageTag();
      this.#build = { state: "building", startedAt: this.#deps.now(), endedAt: null, error: null };
      this.#building = this.#runBuild(tag);
    } finally {
      this.#starting = false;
    }
    this.#changed();
    return this.status();
  }

  /** Server berhenti: build yang berjalan dibatalkan (proses docker build dihentikan). */
  async close(): Promise<void> {
    this.#abort.abort();
    await this.#building;
  }

  async #runBuild(tag: string): Promise<void> {
    try {
      await this.#deps.checks.buildImage(tag, this.#abort.signal);
      this.#build = { state: "idle", startedAt: null, endedAt: this.#deps.now(), error: null };
    } catch (error) {
      this.#deps.onError?.(error, "bangun image runtime");
      this.#build = { state: "failed", startedAt: null, endedAt: this.#deps.now(), error: errorText(error) };
    } finally {
      this.#building = undefined;
      this.#cache = undefined;
      this.#changed();
    }
  }

  #changed(): void {
    this.#deps.bus?.publishGlobal({ type: "runtime" });
  }

  async #check(): Promise<RuntimeStatus> {
    const { checks, driver } = this.#deps;
    const [docker, tag, blender, renderer, materials] = await Promise.all([
      driver === "fixture"
        ? Promise.resolve(null)
        : this.#safe(() => checks.dockerVersion(), null, "cek docker"),
      checks.imageTag(),
      this.#safe(() => checks.blenderVersion(), null, "cek versi blender"),
      this.#renderer(),
      this.#safe(() => checks.materialsCount(), 0, "cek pustaka material"),
    ]);
    const present =
      driver === "docker" && docker !== null
        ? await this.#safe(() => checks.imageExists(tag), false, "cek image")
        : false;
    const dockerOk = driver === "fixture" || docker !== null;
    return {
      driver,
      ready: driver === "fixture" || (dockerOk && present),
      docker: { ok: dockerOk, detail: driver === "fixture" ? null : docker },
      image: { tag, present: driver === "fixture" || present },
      blender,
      renderer,
      materials: { count: materials },
      build: this.#build,
      checkedAt: this.#deps.now(),
    };
  }

  async #renderer(): Promise<RuntimeStatus["renderer"]> {
    const info = this.#deps.checks.rendererInfo;
    if (info === null) return { ok: true, detail: null };
    try {
      return { ok: true, detail: await info() };
    } catch (error) {
      this.#deps.onError?.(error, "cek renderer");
      return { ok: false, detail: null };
    }
  }

  async #safe<T>(check: () => Promise<T>, fallback: T, op: string): Promise<T> {
    try {
      return await check();
    } catch (error) {
      this.#deps.onError?.(error, op);
      return fallback;
    }
  }
}

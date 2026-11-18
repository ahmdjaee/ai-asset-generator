/**
 * Pemeriksa sesi login Claude untuk `/api/health/auth` dan Pengaturan (port dari ai-team `server/routes/health.ts`).
 * - Satu proses Claude Code tanpa pesan menjawab `accountInfo()` dan `supportedModels()`: tanpa panggilan model.
 * - Hasil di-cache 10 menit; permintaan yang datang bersamaan berbagi satu proses.
 * - Kegagalan hanya di-cache 1 menit, supaya login yang baru dilakukan segera terlihat.
 * - Proses memakai slot pool yang sama dengan sesi aset (maksimal 2 proses Claude).
 */
import type { AuthStatus, ModelOption } from "../../shared/health.ts";
import { EFFORT_LEVELS } from "../../shared/settings.ts";
import { buildProbeOptions } from "./options.ts";
import type { AgentPool } from "./pool.ts";
import type { AccountInfo, AgentOptions, AgentPort, ModelInfo } from "./port.ts";

export const AUTH_CACHE_MS = 10 * 60_000;
export const AUTH_FAILURE_CACHE_MS = 60_000;
/** Batas waktu satu pemeriksaan (proses Claude Code yang macet tidak boleh menahan halaman). */
export const AUTH_PROBE_TIMEOUT_MS = 30_000;

export const AUTH_ERROR_MESSAGE =
  "Claude Code tidak bisa dijalankan. Pastikan `claude` terpasang dan ada di PATH.";

export type AccountProbeDeps = Readonly<{
  port: AgentPort;
  pool?: AgentPool;
  now: () => number;
  /** Bawaan: `buildProbeOptions()` (env dari `agentEnv()`). */
  options?: () => AgentOptions;
  /** Timer yang bisa disuntikkan tes. */
  setTimer?: (run: () => void, ms: number) => () => void;
  onError?: (error: unknown) => void;
}>;

/** API key dianggap terpakai bila SDK melaporkan sumber selain "none" (sama dengan `check:auth`). */
export function usesApiKey(info: AccountInfo): boolean {
  return info.apiKeySource !== undefined && info.apiKeySource !== "none";
}

function modelOption(model: ModelInfo): ModelOption {
  const efforts = model.supportsEffort === false ? [] : (model.supportedEffortLevels ?? [...EFFORT_LEVELS]);
  return {
    value: model.value,
    resolvedModel: model.resolvedModel ?? null,
    displayName: model.displayName,
    description: model.description,
    efforts,
  };
}

export function authStatus(info: AccountInfo, models: readonly ModelInfo[], checkedAt: number): AuthStatus {
  if (usesApiKey(info)) return { state: "api_key", checkedAt };
  if (info.email === undefined || info.email === "") return { state: "logged_out", checkedAt };
  return {
    state: "ok",
    email: info.email,
    subscription: info.subscriptionType ?? null,
    organization: info.organization ?? null,
    models: models.map(modelOption),
    checkedAt,
  };
}

const defaultTimer = (run: () => void, ms: number) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

export class AccountProbe {
  readonly #deps: AccountProbeDeps;
  #cache: AuthStatus | undefined;
  #inflight: Promise<AuthStatus> | undefined;

  constructor(deps: AccountProbeDeps) {
    this.#deps = deps;
  }

  /** Hasil terakhir tanpa memeriksa (mis. untuk validasi model di Pengaturan). */
  get cached(): AuthStatus | undefined {
    return this.#cache;
  }

  /** Cache dibuang (mis. giliran gagal karena belum login): pemeriksaan berikutnya menjalankan proses baru. */
  invalidate(): void {
    this.#cache = undefined;
  }

  async status(options: { fresh?: boolean } = {}): Promise<AuthStatus> {
    const cache = this.#cache;
    if (
      options.fresh !== true &&
      cache !== undefined &&
      this.#deps.now() - cache.checkedAt < this.#ttl(cache)
    )
      return cache;
    this.#inflight ??= this.#check().finally(() => {
      this.#inflight = undefined;
    });
    const result = await this.#inflight;
    this.#cache = result;
    return result;
  }

  #ttl(status: AuthStatus): number {
    return status.state === "ok" ? AUTH_CACHE_MS : AUTH_FAILURE_CACHE_MS;
  }

  async #check(): Promise<AuthStatus> {
    const { pool } = this.#deps;
    try {
      return pool === undefined ? await this.#probe() : await pool.withSlot(() => this.#probe());
    } catch (error) {
      this.#deps.onError?.(error);
      return { state: "error", message: AUTH_ERROR_MESSAGE, checkedAt: this.#deps.now() };
    }
  }

  async #probe(): Promise<AuthStatus> {
    const session = this.#deps.port.start((this.#deps.options ?? buildProbeOptions)());
    const setTimer = this.#deps.setTimer ?? defaultTimer;
    let cancel: () => void = () => undefined;
    const timeout = new Promise<never>((_, reject) => {
      cancel = setTimer(
        () => reject(new Error("pemeriksaan akun Claude melewati batas waktu")),
        AUTH_PROBE_TIMEOUT_MS,
      );
    });
    // Penolakan setelah pemeriksaan selesai tidak boleh menjadi promise mengambang.
    timeout.catch(() => undefined);
    try {
      const info = await Promise.race([session.accountInfo(), timeout]);
      // Daftar model hanya berarti untuk akun yang login; tanpa login CLI bisa menolak permintaannya.
      const models =
        usesApiKey(info) || info.email === undefined
          ? []
          : await Promise.race([session.supportedModels(), timeout]);
      return authStatus(info, models, this.#deps.now());
    } finally {
      cancel();
      session.close();
    }
  }
}

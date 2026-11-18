/**
 * Pengaturan app (PLAN Tahap 11) di tabel `settings`, satu baris `app` berisi JSON. Nilai yang tersimpan divalidasi
 * ulang saat dibaca: baris rusak atau dari versi lama diganti bawaan (dan dicatat), supaya app tetap bisa dibuka.
 */
import { findModel } from "../../shared/health.ts";
import type { TierBudget, TierId } from "../../shared/limits.ts";
import { AppSettings, DEFAULT_SETTINGS } from "../../shared/settings.ts";
import type { Db } from "../db/client.ts";
import { getSetting, setSetting } from "../db/repos/settings.ts";
import type { Clock } from "./asset-store.ts";
import type { EventBus } from "./bus.ts";
import { ServiceError } from "./errors.ts";

const KEY = "app";

/** Model yang dikenal (dari `supportedModels()`); `null` = daftar belum bisa dibaca, jadi model tidak dicek. */
export type KnownModels = () => ReadonlyArray<
  Readonly<{ value: string; resolvedModel?: string | null; supportedEffortLevels?: readonly string[] }>
> | null;

export type SettingsServiceDeps = Readonly<{
  db: Db;
  now: Clock;
  bus?: EventBus;
  knownModels?: KnownModels;
  onInvalid?: (error: unknown) => void;
}>;

export class SettingsService {
  readonly #deps: SettingsServiceDeps;

  constructor(deps: SettingsServiceDeps) {
    this.#deps = deps;
  }

  get(): AppSettings {
    const stored = getSetting(this.#deps.db, KEY);
    if (stored === undefined) return DEFAULT_SETTINGS;
    const parsed = AppSettings.safeParse(stored);
    if (parsed.success) return parsed.data;
    this.#deps.onInvalid?.(parsed.error);
    return DEFAULT_SETTINGS;
  }

  /** Budget tier untuk aset baru (disalin ke `tierSnapshot`). */
  tierBudget(tierId: TierId): TierBudget {
    return this.get().tiers[tierId];
  }

  /** Model dan effort untuk proses Claude yang akan dimulai. */
  agent(): Readonly<{ model: string; effort: AppSettings["effort"] }> {
    const { model, effort } = this.get();
    return { model, effort };
  }

  /** `next` sudah lolos `SettingsBody` di batas HTTP; di sini dicek terhadap model yang dikenal. */
  update(next: AppSettings): AppSettings {
    const known = this.#deps.knownModels?.() ?? null;
    if (known !== null) {
      // Id lengkap yang tersimpan (mis. bawaan `claude-opus-5-5`) dicakup alias dari CLI (`opus`).
      const model = findModel(known, next.model);
      if (model === undefined)
        throw new ServiceError("INVALID_SETTINGS", `Model ${next.model} tidak tersedia untuk akun ini.`);
      const efforts = model.supportedEffortLevels;
      // Daftar kosong = model tanpa effort: nilai effort tersimpan diabaikan SDK, jadi tidak dicek.
      if (efforts !== undefined && efforts.length > 0 && !efforts.includes(next.effort))
        throw new ServiceError("INVALID_SETTINGS", `Model ini tidak mendukung effort ${next.effort}.`);
    }
    setSetting(this.#deps.db, KEY, next, this.#deps.now());
    this.#deps.bus?.publishGlobal({ type: "settings" });
    return next;
  }
}

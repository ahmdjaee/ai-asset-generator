import { describe, expect, test } from "bun:test";
import { DEFAULT_TIERS } from "../../shared/limits.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../../shared/settings.ts";
import { openDatabase } from "../db/client.ts";
import { setSetting } from "../db/repos/settings.ts";
import { EventBus } from "./bus.ts";
import { ServiceError } from "./errors.ts";
import { type KnownModels, SettingsService } from "./settings.ts";
import { fakeClock } from "./test-support.ts";

function setup(knownModels?: KnownModels) {
  const handle = openDatabase(":memory:");
  const bus = new EventBus();
  const published: string[] = [];
  bus.subscribeGlobal((event) => published.push(event.type));
  const invalid: unknown[] = [];
  const service = new SettingsService({
    db: handle.db,
    now: fakeClock(),
    bus,
    onInvalid: (error) => invalid.push(error),
    ...(knownModels === undefined ? {} : { knownModels }),
  });
  return { handle, service, published, invalid };
}

const custom: AppSettings = {
  ...DEFAULT_SETTINGS,
  model: "claude-sonnet-5-5",
  effort: "medium",
  defaultTier: "ringan",
  tiers: { ...DEFAULT_TIERS, ringan: { ...DEFAULT_TIERS.ringan, triangles: { target: 1500, max: 2500 } } },
};

describe("SettingsService", () => {
  test("tanpa baris tersimpan → bawaan", () => {
    const { service } = setup();
    expect(service.get()).toEqual(DEFAULT_SETTINGS);
    expect(service.tierBudget("sedang")).toEqual(DEFAULT_TIERS.sedang);
    expect(service.agent()).toEqual({ model: "claude-opus-5-5", effort: "high" });
  });

  test("update menyimpan, memberi tahu topik global, dan dipakai untuk aset dan sesi berikutnya", () => {
    const { service, published } = setup();
    service.update(custom);
    expect(service.get()).toEqual(custom);
    expect(service.tierBudget("ringan").triangles).toEqual({ target: 1500, max: 2500 });
    expect(service.agent()).toEqual({ model: "claude-sonnet-5-5", effort: "medium" });
    expect(published).toEqual(["settings"]);
  });

  test("baris rusak → bawaan dan dicatat, app tetap jalan", () => {
    const { handle, service, invalid } = setup();
    setSetting(handle.db, "app", { model: 5, tiers: "rusak" }, 1);
    expect(service.get()).toEqual(DEFAULT_SETTINGS);
    expect(invalid).toHaveLength(1);
  });

  test("model dan effort dicek terhadap daftar model akun bila tersedia", () => {
    const models = [{ value: "claude-sonnet-5-5", supportedEffortLevels: ["low", "high"] }];
    const { service, published } = setup(() => models);
    const reject = (settings: AppSettings) => {
      try {
        service.update(settings);
      } catch (error) {
        return error instanceof ServiceError ? error.code : "lain";
      }
      return "lolos";
    };
    expect(reject({ ...custom, model: "claude-tidak-ada" })).toBe("INVALID_SETTINGS");
    expect(reject({ ...custom, effort: "medium" })).toBe("INVALID_SETTINGS");
    expect(reject({ ...custom, effort: "high" })).toBe("lolos");
    expect(published).toEqual(["settings"]);
  });

  test("id lengkap yang tersimpan cocok dengan alias yang mencakupnya (`resolvedModel`)", () => {
    const models = [
      { value: "opus", resolvedModel: "claude-opus-5-5", supportedEffortLevels: ["low", "high"] },
    ];
    const { service } = setup(() => models);
    expect(service.update({ ...custom, model: "claude-opus-5-5", effort: "high" }).model).toBe(
      "claude-opus-5-5",
    );
    expect(service.update({ ...custom, model: "opus", effort: "high" }).model).toBe("opus");
    expect(() => service.update({ ...custom, model: "claude-opus-5-5", effort: "medium" })).toThrow(
      ServiceError,
    );
  });

  test("model tanpa effort (daftar kosong) → effort tersimpan tidak dicek", () => {
    const { service } = setup(() => [{ value: "haiku", supportedEffortLevels: [] }]);
    expect(service.update({ ...custom, model: "haiku", effort: "high" }).model).toBe("haiku");
  });

  test("daftar model belum terbaca → model tidak dicek", () => {
    const { service } = setup(() => null);
    expect(service.update({ ...custom, model: "opus" }).model).toBe("opus");
  });
});

import { describe, expect, test } from "bun:test";
import { getAsset } from "../db/repos/assets.ts";
import { listEvents } from "../db/repos/events.ts";
import { listVersionRecords } from "../db/repos/versions.ts";
import { AssetStore, EventLog } from "./asset-store.ts";
import { EventBus, type GlobalEvent } from "./bus.ts";
import { ServiceError } from "./errors.ts";
import { fakeClock, openTestStore } from "./test-support.ts";

describe("AssetStore.apply", () => {
  test("transisi sah: status + event state disimpan dalam satu transaksi, lalu disiarkan", () => {
    const t = openTestStore();
    const global: GlobalEvent[] = [];
    t.bus.subscribeGlobal((event) => global.push(event));
    const result = t.store.apply({ type: "message", text: "halo" });
    expect(result).toMatchObject({ ok: true, state: { runState: "running" } });
    expect(getAsset(t.handle.db, "a1")?.state.runState).toBe("running");
    const stored = listEvents(t.handle.db, "a1").events;
    expect(stored.map((event) => event.event.type)).toEqual(["state"]);
    expect(t.published).toEqual(stored);
    expect(global).toEqual([{ type: "asset", assetId: "a1", change: "updated" }]);
    t.handle.close();
  });

  test("transisi ditolak: tidak ada perubahan, tidak ada event", () => {
    const t = openTestStore();
    const result = t.store.apply({ type: "approve" });
    expect(result).toMatchObject({ ok: false, code: "NOT_IN_REVIEW" });
    expect(listEvents(t.handle.db, "a1").events).toEqual([]);
    expect(t.published).toEqual([]);
    t.handle.close();
  });

  test("keadaan yang tampak sama tidak menghasilkan event state ganda", () => {
    const t = openTestStore();
    t.store.apply({ type: "stop" });
    t.store.apply({ type: "turn_ended", outcome: "success" });
    expect(t.published).toEqual([]);
    t.handle.close();
  });

  test("aset tidak ada → ServiceError ASSET_NOT_FOUND (baca dan terapkan)", () => {
    const t = openTestStore({ id: "ada" });
    const missing = new AssetStore({ db: t.handle.db, bus: t.bus, now: Date.now }, "tidak-ada");
    expect(() => missing.read()).toThrow(ServiceError);
    expect(() => missing.apply({ type: "stop" })).toThrow("tidak ditemukan");
    t.handle.close();
  });

  test("recordVersion menulis indeks versi dengan jam yang disuntikkan", () => {
    const clock = fakeClock(5_000);
    const t = openTestStore({ now: clock });
    t.store.recordVersion({
      version: 1,
      stage: "base",
      stats: {
        triangles: 10,
        vertices: 8,
        materials: 0,
        drawCalls: 1,
        textures: [],
        bbox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
        bytes: 100,
      },
      budget: { ok: true, items: [] },
      manifest: { version: 1, files: [{ name: "base.glb", bytes: 10, sha256: "ab" }] },
    });
    expect(listVersionRecords(t.handle.db, "a1")).toMatchObject([{ n: 1, stage: "base", createdAt: 5_000 }]);
    t.handle.close();
  });
});

describe("EventLog.record", () => {
  test("event thread disimpan dengan seq; event live hanya disiarkan", () => {
    const t = openTestStore();
    const log = new EventLog({ db: t.handle.db, bus: t.bus, now: () => 7 });
    const notice = log.record("a1", { type: "notice", text: "halo" });
    const delta = log.record("a1", { type: "delta", kind: "text", text: "ha" });
    expect(notice).toMatchObject({ seq: 1, ts: 7 });
    expect(delta).toMatchObject({ seq: null, ts: 7 });
    expect(listEvents(t.handle.db, "a1").events.map((event) => event.event.type)).toEqual(["notice"]);
    expect(t.published.map((event) => event.event.type)).toEqual(["notice", "delta"]);
    t.handle.close();
  });
});

describe("EventBus", () => {
  test("topik per aset dan global; berhenti berlangganan; penyimak error tidak menjatuhkan pengirim", () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onError: (error) => errors.push(error) });
    const seen: string[] = [];
    const offA = bus.subscribe("a", (event) => seen.push(`a:${event.event.type}`));
    bus.subscribe("a", () => {
      throw new Error("penyimak rusak");
    });
    bus.subscribe("b", (event) => seen.push(`b:${event.event.type}`));
    const offGlobal = bus.subscribeGlobal((event) => {
      if (event.type === "asset") seen.push(`global:${event.change}`);
    });

    bus.publish({ assetId: "a", seq: 1, ts: 1, event: { type: "notice", text: "x" } });
    bus.publishGlobal({ type: "asset", assetId: "a", change: "created" });
    offA();
    offGlobal();
    bus.publish({ assetId: "a", seq: 2, ts: 2, event: { type: "notice", text: "y" } });
    bus.publishGlobal({ type: "asset", assetId: "a", change: "deleted" });
    bus.publish({ assetId: "b", seq: 1, ts: 3, event: { type: "notice", text: "z" } });

    expect(seen).toEqual(["a:notice", "global:created", "b:notice"]);
    expect(errors).toHaveLength(2);
  });

  test("tanpa onError: error penyimak ditelan", () => {
    const bus = new EventBus();
    bus.subscribe("a", () => {
      throw new Error("x");
    });
    expect(() =>
      bus.publish({ assetId: "a", seq: 1, ts: 1, event: { type: "notice", text: "x" } }),
    ).not.toThrow();
  });
});

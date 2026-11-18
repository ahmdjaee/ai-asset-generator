import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { AuthStatus, RuntimeStatus } from "../../../shared/health.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { AppSettings, DEFAULT_SETTINGS } from "../../../shared/settings.ts";
import { idleIn, openTestApi, type TestApi, untilAsset } from "../../../tests/support/api.ts";
import { SCENARIO_EMAIL } from "../../agent/scenario-port.ts";
import { SCENARIO_MARKERS } from "../../agent/scenarios.ts";

let api: TestApi;

beforeEach(async () => {
  api = await openTestApi();
});

afterEach(async () => {
  await api.close();
});

const SettingsResponse = z.object({ settings: AppSettings });
const ErrorBody = z.object({ code: z.string(), message: z.string() });

function put(body: unknown): Promise<Response> {
  return Promise.resolve(
    api.app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("rute Pengaturan", () => {
  test("GET bawaan; PUT menyimpan; aset baru memakai budget baru, aset lama tetap snapshot-nya", async () => {
    const initial = SettingsResponse.parse(await (await api.app.request("/api/settings")).json());
    expect(initial.settings).toEqual(DEFAULT_SETTINGS);

    const data = new FormData();
    data.append("prompt", "Peti lama");
    data.append("tierId", "ringan");
    const before = z
      .object({ asset: z.object({ id: z.string() }) })
      .parse(await (await api.app.request("/api/assets", { method: "POST", body: data })).json()).asset.id;

    const ringan = { ...DEFAULT_TIERS.ringan, triangles: { target: 1200, max: 1800 } };
    const next = { ...DEFAULT_SETTINGS, defaultTier: "ringan", tiers: { ...DEFAULT_TIERS, ringan } };
    const saved = await put(next);
    expect(saved.status).toBe(200);
    expect(SettingsResponse.parse(await saved.json()).settings.tiers.ringan.triangles.max).toBe(1800);

    const after = new FormData();
    after.append("prompt", "Peti baru");
    after.append("tierId", "ringan");
    const created = z
      .object({ asset: z.object({ id: z.string() }) })
      .parse(await (await api.app.request("/api/assets", { method: "POST", body: after })).json()).asset.id;
    expect(api.services.assets.get(created).tier.triangles).toEqual({ target: 1200, max: 1800 });
    expect(api.services.assets.get(before).tier).toEqual(DEFAULT_TIERS.ringan);
    await untilAsset(api.services, before, idleIn("BASE_REVIEW"));
    await untilAsset(api.services, created, idleIn("BASE_REVIEW"));
  });

  test.each([
    [
      "budget di atas batas aman",
      {
        tiers: {
          ...DEFAULT_TIERS,
          maksimal: { ...DEFAULT_TIERS.maksimal, triangles: { target: 30_000, max: 90_000 } },
        },
      },
    ],
    ["tier hilang", { tiers: { ringan: DEFAULT_TIERS.ringan, sedang: DEFAULT_TIERS.sedang } }],
    ["effort tak dikenal", { effort: "turbo" }],
    ["tier bawaan tak dikenal", { defaultTier: "raksasa" }],
  ])("PUT ditolak 400: %s; pengaturan tidak berubah", async (_label, patch) => {
    const response = await put({ ...DEFAULT_SETTINGS, ...patch });
    expect(response.status).toBe(400);
    expect(ErrorBody.parse(await response.json()).code).toBe("VALIDATION_FAILED");
    expect(api.services.settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  test("model di luar daftar akun ditolak setelah daftar model terbaca", async () => {
    await api.app.request("/api/health/auth");
    const response = await put({ ...DEFAULT_SETTINGS, model: "claude-tidak-ada" });
    expect(response.status).toBe(400);
    expect(ErrorBody.parse(await response.json()).code).toBe("INVALID_SETTINGS");
    // Sonnet palsu hanya mendukung effort sampai high.
    expect((await put({ ...DEFAULT_SETTINGS, model: "claude-sonnet-5-5", effort: "max" })).status).toBe(400);
    expect((await put({ ...DEFAULT_SETTINGS, model: "claude-sonnet-5-5", effort: "high" })).status).toBe(200);
  });
});

describe("rute kesehatan", () => {
  test("/auth: akun palsu login dengan daftar model", async () => {
    const response = await api.app.request("/api/health/auth");
    expect(response.status).toBe(200);
    const { auth } = z.object({ auth: AuthStatus }).parse(await response.json());
    expect(auth).toMatchObject({ state: "ok", email: SCENARIO_EMAIL, subscription: "max" });
    if (auth.state !== "ok") throw new Error("harus ok");
    expect(auth.models.map((model) => model.value)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  test("giliran gagal karena belum login → aset gagal AUTH_REQUIRED, status akun diperiksa ulang", async () => {
    await api.app.request("/api/health/auth");
    const authEvents: string[] = [];
    api.services.bus.subscribeGlobal((event) => {
      if (event.type === "auth") authEvents.push(event.type);
    });
    const data = new FormData();
    data.append("prompt", `Peti ${SCENARIO_MARKERS.loggedOut}`);
    data.append("tierId", "ringan");
    const id = z
      .object({ asset: z.object({ id: z.string() }) })
      .parse(await (await api.app.request("/api/assets", { method: "POST", body: data })).json()).asset.id;
    const failed = await untilAsset(api.services, id, (record) => record.state.runState === "failed");
    expect(failed.state.lastError).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(authEvents).toEqual(["auth"]);
    expect(api.services.account.cached).toBeUndefined();
  });

  test("/runtime: mode fixture selalu siap; bangun image ditolak 409", async () => {
    const { runtime } = z
      .object({ runtime: RuntimeStatus })
      .parse(await (await api.app.request("/api/health/runtime?fresh=1")).json());
    expect(runtime).toMatchObject({
      driver: "fixture",
      ready: true,
      materials: { count: expect.any(Number) },
    });
    const build = await api.app.request("/api/health/runtime/image", { method: "POST" });
    expect(build.status).toBe(409);
    expect(ErrorBody.parse(await build.json()).code).toBe("RUNTIME_UNAVAILABLE");
    expect((await api.app.request("/api/health/runtime?fresh=ya")).status).toBe(400);
  });
});

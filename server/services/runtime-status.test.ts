import { describe, expect, test } from "bun:test";
import { EventBus } from "./bus.ts";
import { ServiceError } from "./errors.ts";
import { RUNTIME_STATUS_CACHE_MS, type RuntimeChecks, RuntimeStatusService } from "./runtime-status.ts";
import { fakeClock } from "./test-support.ts";

type Controls = {
  docker: string | null;
  image: boolean;
  renderer: "ok" | "gagal";
  calls: { docker: number; build: number };
  finishBuild: (error?: Error) => void;
  buildSignal: AbortSignal | undefined;
};

function harness(driver: "docker" | "fixture" = "docker") {
  const controls: Controls = {
    docker: "29.1.0",
    image: false,
    renderer: "ok",
    calls: { docker: 0, build: 0 },
    finishBuild: () => undefined,
    buildSignal: undefined,
  };
  const checks: RuntimeChecks = {
    dockerVersion: async () => {
      controls.calls.docker += 1;
      return controls.docker;
    },
    imageTag: async () => "asset-forge:abc123",
    imageExists: async () => controls.image,
    blenderVersion: async () => "5.2.4",
    rendererInfo:
      driver === "fixture"
        ? null
        : async () => {
            if (controls.renderer === "gagal") throw new Error("chromium tidak ada");
            return "ANGLE (SwiftShader)";
          },
    materialsCount: async () => 24,
    buildImage: (_tag, signal) => {
      controls.calls.build += 1;
      controls.buildSignal = signal;
      return new Promise((resolve, reject) => {
        controls.finishBuild = (error) => (error === undefined ? resolve() : reject(error));
      });
    },
  };
  const bus = new EventBus();
  const events: string[] = [];
  bus.subscribeGlobal((event) => events.push(event.type));
  const errors: string[] = [];
  const clock = fakeClock();
  const service = new RuntimeStatusService({
    driver,
    checks,
    now: clock,
    bus,
    onError: (_error, op) => errors.push(op),
  });
  return { service, controls, events, errors, clock };
}

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof ServiceError ? error.code : "lain";
  }
  return "lolos";
}

describe("RuntimeStatusService — status", () => {
  test("Docker hidup tanpa image → belum siap; semua cek dilaporkan", async () => {
    const h = harness();
    expect(await h.service.status()).toEqual({
      driver: "docker",
      ready: false,
      docker: { ok: true, detail: "29.1.0" },
      image: { tag: "asset-forge:abc123", present: false },
      blender: "5.2.4",
      renderer: { ok: true, detail: "ANGLE (SwiftShader)" },
      materials: { count: 24 },
      build: { state: "idle", startedAt: null, endedAt: null, error: null },
      checkedAt: h.clock(),
    });
  });

  test("Docker mati → belum siap, image tidak diperiksa; renderer gagal dilaporkan tanpa detail mentah", async () => {
    const h = harness();
    h.controls.docker = null;
    h.controls.image = true;
    h.controls.renderer = "gagal";
    const status = await h.service.status();
    expect(status).toMatchObject({ ready: false, docker: { ok: false }, image: { present: false } });
    expect(status.renderer).toEqual({ ok: false, detail: null });
    expect(h.errors).toEqual(["cek renderer"]);
  });

  test("image ada → siap; hasil di-cache 30 detik, `fresh` memeriksa ulang", async () => {
    const h = harness();
    h.controls.image = true;
    expect((await h.service.status()).ready).toBe(true);
    h.clock.advance(RUNTIME_STATUS_CACHE_MS - 1);
    await h.service.status();
    expect(h.controls.calls.docker).toBe(1);
    await h.service.status({ fresh: true });
    expect(h.controls.calls.docker).toBe(2);
  });

  test("mode fixture: tanpa Docker, selalu siap", async () => {
    const h = harness("fixture");
    const status = await h.service.status();
    expect(status).toMatchObject({ driver: "fixture", ready: true, docker: { ok: true, detail: null } });
    expect(h.controls.calls.docker).toBe(0);
    expect(await code(() => h.service.buildImage())).toBe("RUNTIME_UNAVAILABLE");
  });
});

describe("RuntimeStatusService — bangun image", () => {
  test("build berjalan di latar, satu sekaligus; selesai → status diperiksa ulang dan topik global dikabari", async () => {
    const h = harness();
    await h.service.status();
    const started = await h.service.buildImage();
    expect(started.build).toEqual({ state: "building", startedAt: h.clock(), endedAt: null, error: null });
    expect(await code(() => h.service.buildImage())).toBe("RUNTIME_BUSY");
    expect(h.controls.calls.build).toBe(1);
    h.controls.image = true;
    h.controls.finishBuild();
    await h.service.close();
    const done = await h.service.status();
    expect(done).toMatchObject({ ready: true, build: { state: "idle", error: null } });
    expect(h.events).toEqual(["runtime", "runtime"]);
  });

  test("dua klik bersamaan → hanya satu build", async () => {
    const h = harness();
    const results = await Promise.all([
      code(() => h.service.buildImage()),
      code(() => h.service.buildImage()),
    ]);
    expect(results.sort()).toEqual(["RUNTIME_BUSY", "lolos"]);
    expect(h.controls.calls.build).toBe(1);
  });

  test("build gagal → state failed dengan ekor pesan; bisa dicoba lagi", async () => {
    const h = harness();
    await h.service.buildImage();
    h.clock.advance(90_000);
    h.controls.finishBuild(new Error(`docker build gagal (kode 1):\n${"x".repeat(3000)}pip: jaringan putus`));
    await h.service.close();
    const failed = await h.service.status();
    expect(failed.build.state).toBe("failed");
    // Waktu gagal ditampilkan Pengaturan ("Membangun image gagal pukul …").
    expect(failed.build.endedAt).toBe(h.clock());
    expect(failed.build.error?.endsWith("pip: jaringan putus")).toBe(true);
    expect(failed.build.error?.length).toBeLessThanOrEqual(2001);
    expect(h.errors).toEqual(["bangun image runtime"]);
    expect(await code(() => h.service.buildImage())).toBe("lolos");
  });

  test("Docker tidak terjangkau → ditolak tanpa memulai build", async () => {
    const h = harness();
    h.controls.docker = null;
    expect(await code(() => h.service.buildImage())).toBe("RUNTIME_UNAVAILABLE");
    expect(h.controls.calls.build).toBe(0);
  });

  test("server berhenti → build dibatalkan lewat AbortSignal", async () => {
    const h = harness();
    await h.service.buildImage();
    const closing = h.service.close();
    expect(h.controls.buildSignal?.aborted).toBe(true);
    h.controls.finishBuild(new Error("dibatalkan"));
    await closing;
  });
});

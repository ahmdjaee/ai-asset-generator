import { describe, expect, test } from "bun:test";
import { buildProgress } from "./build-progress.ts";
import type { BuildBlock } from "./thread-items.ts";

const BLOCK: BuildBlock = {
  kind: "build",
  key: "e5",
  jobId: "j1",
  stage: "base",
  status: "running",
  version: null,
  code: null,
  startedAt: 20_000,
  endedAt: null,
  scriptStartedAt: 8_000,
};

const rows = (view: ReturnType<typeof buildProgress>) =>
  view.steps.map((step) => [step.label, step.status, step.duration ?? null]);

describe("buildProgress", () => {
  test("berjalan tanpa progres live: sandbox berjalan, sisanya menunggu; lama dihitung dari mulai menulis skrip", () => {
    const view = buildProgress({ block: BLOCK, live: undefined, timings: null, nextVersion: 2, now: 80_000 });
    expect(view.title).toBe("Membuat bentuk dasar v2");
    expect(view.meta).toBe("1 mnt 12 dtk");
    expect(rows(view)).toEqual([
      ["Menulis skrip", "done", "12 dtk"],
      ["Build di sandbox", "running", null],
      ["Optimasi & cek budget", "pending", null],
      ["Render contact sheet", "pending", null],
    ]);
  });

  test("berjalan di optimasi: sandbox selesai dengan lama dari waktu bagian berikutnya terlihat", () => {
    const view = buildProgress({
      block: BLOCK,
      live: { step: "optimasi dan validasi", pct: 65, phases: { sandbox: 21_000, optimize: 68_000 } },
      timings: null,
      nextVersion: null,
      now: 70_000,
    });
    expect(view.title).toBe("Membuat bentuk dasar");
    expect(rows(view)).toEqual([
      ["Menulis skrip", "done", "12 dtk"],
      ["Build di sandbox", "done", "48 dtk"],
      ["Optimasi & cek budget", "running", null],
      ["Render contact sheet", "pending", null],
    ]);
  });

  test("muat ulang di tengah render: bagian lewat tanpa waktu tetap selesai, tanpa lama", () => {
    const view = buildProgress({
      block: { ...BLOCK, scriptStartedAt: null },
      live: { step: "menyimpan versi", pct: 95, phases: { render: 90_000 } },
      timings: null,
      nextVersion: 3,
      now: 95_000,
    });
    expect(view.meta).toBe("1 mnt 15 dtk");
    expect(rows(view)).toEqual([
      ["Menulis skrip", "done", null],
      ["Build di sandbox", "done", null],
      ["Optimasi & cek budget", "done", null],
      ["Render contact sheet", "running", null],
    ]);
  });

  test("selesai: 4 langkah dengan lama dari timings versi", () => {
    const view = buildProgress({
      block: { ...BLOCK, status: "done", version: 1, endedAt: 116_000 },
      live: undefined,
      timings: { runtimeMs: 48_000, pipelineMs: 9_000, renderMs: 30_000, totalMs: 96_000 },
      nextVersion: 2,
      now: 200_000,
    });
    expect(view.title).toBe("Bentuk dasar v1 selesai");
    expect(view.meta).toBe("4 langkah · 1 mnt 48 dtk");
    expect(rows(view)).toEqual([
      ["Menulis skrip", "done", "12 dtk"],
      ["Build di sandbox", "done", "48 dtk"],
      ["Optimasi & cek budget", "done", "9 dtk"],
      ["Render contact sheet", "done", "30 dtk"],
    ]);
  });

  test("aset final selesai tanpa timings (versi lama): langkah tanpa lama", () => {
    const view = buildProgress({
      block: { ...BLOCK, stage: "textured", status: "done", version: 4, endedAt: 50_000 },
      live: undefined,
      timings: null,
      nextVersion: null,
      now: 60_000,
    });
    expect(view.title).toBe("Aset final v4 selesai");
    expect(view.steps.every((step) => step.duration === undefined || step.id === "script")).toBe(true);
  });

  test("gagal: alasan dari kode; validasi gagal berarti sandbox sudah lewat", () => {
    const failed = { ...BLOCK, status: "failed" as const, endedAt: 68_000 };
    const script = buildProgress({
      block: { ...failed, code: "SCRIPT_ERROR" },
      live: undefined,
      timings: null,
      nextVersion: 2,
      now: 70_000,
    });
    expect(script.title).toBe("Build bentuk dasar gagal");
    expect(script.meta).toBe("1 mnt");
    expect(rows(script)).toEqual([
      ["Menulis skrip", "done", "12 dtk"],
      ["Build gagal: skrip error", "failed", null],
    ]);
    const validation = buildProgress({
      block: { ...failed, code: "VALIDATION_FAILED" },
      live: undefined,
      timings: null,
      nextVersion: 2,
      now: 70_000,
    });
    expect(rows(validation).map((row) => row[0])).toEqual([
      "Menulis skrip",
      "Build di sandbox",
      "Build gagal: glTF tidak valid",
    ]);
    const unknown = buildProgress({
      block: { ...failed, code: "X" },
      live: undefined,
      timings: null,
      nextVersion: 2,
      now: 1,
    });
    expect(unknown.steps.at(-1)?.label).toBe("Build gagal: kesalahan tak dikenal");
  });

  test("dihentikan: baris dihentikan setelah menulis skrip", () => {
    const view = buildProgress({
      block: { ...BLOCK, stage: "textured", status: "stopped", endedAt: 40_000 },
      live: undefined,
      timings: null,
      nextVersion: 2,
      now: 90_000,
    });
    expect(view.title).toBe("Build aset final dihentikan");
    expect(view.meta).toBe("32 dtk");
    expect(rows(view)).toEqual([
      ["Menulis skrip", "done", "12 dtk"],
      ["Build dihentikan", "stopped", null],
    ]);
  });
});

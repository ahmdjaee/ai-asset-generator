import { describe, expect, test } from "bun:test";
import { authOk, runtimeImageMissing, runtimeReady, TEST_EMAIL } from "@/test-health.ts";
import { accountProblem, accountSummary, planName, runtimeProblem } from "./health.ts";

describe("masalah akun", () => {
  test("hanya belum login, API key, dan CLI tidak berjalan; belum diketahui = tanpa banner", () => {
    expect(accountProblem(undefined)).toBeNull();
    expect(accountProblem(authOk())).toBeNull();
    expect(accountProblem({ state: "logged_out", checkedAt: 1 })).toBe("logged_out");
    expect(accountProblem({ state: "api_key", checkedAt: 1 })).toBe("api_key");
    expect(accountProblem({ state: "error", message: "x", checkedAt: 1 })).toBe("error");
  });

  test("ringkasan akun untuk chip dan Pengaturan: email dan paket disembunyikan sementara", () => {
    // Permintaan pemilik 2026-11-18: identitas akun (email, jenis paket) tidak ditampilkan dulu.
    expect(accountSummary(authOk())).toEqual({ name: "Akun Claude", detail: "Login lewat Claude Code" });
    expect(JSON.stringify(accountSummary(authOk()))).not.toContain(TEST_EMAIL);
    expect(accountSummary(authOk({ subscription: null })).detail).toBe("Login lewat Claude Code");
    expect(accountSummary({ state: "logged_out", checkedAt: 1 }).name).toBe("Belum login");
    expect(accountSummary({ state: "error", message: "CLI hilang", checkedAt: 1 })).toEqual({
      name: "Claude Code tidak berjalan",
      detail: "CLI hilang",
    });
    expect(accountSummary(undefined).detail).toBe("Memeriksa akun…");
    expect(planName("pro")).toBe("Pro");
    expect(planName("studio")).toBe("Studio");
  });
});

describe("masalah runtime", () => {
  test("urutan: membangun → Docker mati → build gagal → image belum ada; mode fixture selalu siap", () => {
    expect(runtimeProblem(undefined)).toBeNull();
    expect(runtimeProblem(runtimeReady())).toBeNull();
    expect(runtimeProblem(runtimeReady({ driver: "fixture", ready: true }))).toBeNull();
    expect(runtimeProblem(runtimeImageMissing())).toBe("image_missing");
    const failed = { state: "failed" as const, startedAt: null, endedAt: 5, error: "pip gagal" };
    expect(runtimeProblem(runtimeImageMissing({ build: failed }))).toBe("build_failed");
    // Image lama masih ada: build ulang yang gagal tidak menghalangi aset.
    expect(runtimeProblem(runtimeReady({ build: failed }))).toBeNull();
    expect(runtimeProblem(runtimeImageMissing({ docker: { ok: false, detail: null }, build: failed }))).toBe(
      "docker_down",
    );
    expect(
      runtimeProblem(
        runtimeImageMissing({ build: { state: "building", startedAt: 1, endedAt: null, error: null } }),
      ),
    ).toBe("building");
  });
});

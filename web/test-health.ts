/** Data tiruan `/api/health/*` dan `/api/settings` untuk tes web. Email memakai domain `.invalid` (bukan data pemilik). */
import type { AuthStatus, RuntimeStatus } from "../shared/health.ts";
import { type AppSettings, DEFAULT_SETTINGS } from "../shared/settings.ts";

export const TEST_EMAIL = "pemilik@contoh.invalid";
export const CHECKED_AT = Date.UTC(2026, 10, 18, 14, 32);

export function authOk(overrides: Partial<Extract<AuthStatus, { state: "ok" }>> = {}): AuthStatus {
  return {
    state: "ok",
    email: TEST_EMAIL,
    subscription: "max",
    organization: null,
    models: [
      {
        value: "opus",
        resolvedModel: "claude-opus-5-5",
        displayName: "Opus 5.5",
        description: "Paling mampu",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5-5",
        displayName: "Sonnet 5.5",
        description: "Seimbang",
        efforts: ["low", "medium", "high"],
      },
      {
        value: "haiku",
        resolvedModel: "claude-haiku-5-5",
        displayName: "Haiku 5.5",
        description: "Cepat",
        efforts: [],
      },
    ],
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

export function runtimeReady(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    driver: "docker",
    ready: true,
    docker: { ok: true, detail: "29.1.2" },
    image: { tag: "asset-forge:b0609fed0438", present: true },
    blender: "5.2.4",
    renderer: { ok: true, detail: "Chromium headless · SwiftShader" },
    materials: { count: 61 },
    build: { state: "idle", startedAt: null, endedAt: null, error: null },
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

/** Image belum dibangun (Docker hidup). */
export function runtimeImageMissing(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return runtimeReady({
    ready: false,
    image: { tag: "asset-forge:b0609fed0438", present: false },
    ...overrides,
  });
}

export function settingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Jawaban bawaan untuk rute kesehatan dan Pengaturan (dipakai `mockFetch` tes halaman). */
export function healthResponse(path: string): object | undefined {
  if (path === "/api/health/auth") return { auth: authOk() };
  if (path === "/api/health/runtime") return { runtime: runtimeReady() };
  if (path === "/api/settings") return { settings: settingsFixture() };
  return undefined;
}

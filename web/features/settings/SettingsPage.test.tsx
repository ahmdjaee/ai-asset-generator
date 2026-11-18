import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { authOk, runtimeImageMissing, runtimeReady, settingsFixture, TEST_EMAIL } from "@/test-health.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import type { AuthStatus, RuntimeStatus } from "../../../shared/health.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { type AppSettings, AppSettings as AppSettingsSchema } from "../../../shared/settings.ts";
import { effortFor, modelChoices, SettingsPage } from "./SettingsPage.tsx";

const copy = t.settings;

let server: FakeServer;
let auth: AuthStatus;
let runtime: RuntimeStatus;
let settings: AppSettings;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  auth = authOk();
  runtime = runtimeReady();
  settings = settingsFixture();
  server = new FakeServer()
    .on("GET", "/api/health/auth", () => jsonResponse({ auth }))
    .on("GET", "/api/health/runtime", () => jsonResponse({ runtime }))
    .on("GET", "/api/settings", () => jsonResponse({ settings }))
    .on("PUT", "/api/settings", async (request) => {
      settings = AppSettingsSchema.parse(await request.json());
      return jsonResponse({ settings });
    });
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => {
  restoreFetch();
  Reflect.deleteProperty(window, "Notification");
});

function renderPage() {
  renderWithQuery(
    <TooltipProvider>
      <MemoryRouter>
        <main tabIndex={-1}>
          <SettingsPage />
        </main>
        <Toaster />
      </MemoryRouter>
    </TooltipProvider>,
  );
  return userEvent.setup();
}

const section = (name: string) => screen.getByRole("region", { name });
const field = (name: string) => screen.getByRole<HTMLInputElement>("textbox", { name });
const loaded = () => screen.findByRole("button", { name: "Model Opus 5.5" });

describe("Pengaturan", () => {
  test("akun, model/effort, tier bawaan, budget, runtime, dan tema dari server; tanpa bilah simpan", async () => {
    renderPage();
    await loaded();
    const account = section(copy.account.title);
    // Email dan jenis paket disembunyikan sementara (permintaan pemilik); status Terhubung tetap tampil.
    expect(await within(account).findByText(copy.account.connected)).toBeDefined();
    expect(within(account).getByText("Login lewat Claude Code")).toBeDefined();
    expect(within(account).queryByText(TEST_EMAIL)).toBeNull();
    expect(within(account).queryByText(/Paket Max/)).toBeNull();
    // Model tersimpan `claude-opus-5-5` dicakup alias `opus` dari CLI.
    expect(screen.getByRole("button", { name: "Effort Tinggi" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Sedang" }).getAttribute("aria-checked")).toBe("true");
    expect(field("Segitiga target, Sedang").value).toBe("8.000");
    expect(field("Ukuran web.glb maks, Sedang").value).toBe("1,5 MB");
    expect(field("Material, Maksimal").value).toBe("3");
    expect(screen.getByRole("button", { name: "Normal map, Ringan: Tidak ada" })).toBeDefined();
    const checks = await screen.findByRole("list", { name: copy.runtime.checks });
    expect(within(checks).getByText("Server 29.1.2")).toBeDefined();
    expect(within(checks).getByText("61 material CC0 (ambientCG)")).toBeDefined();
    expect(within(section(copy.runtime.title)).getByText(copy.runtime.ready)).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: t.theme.label })).toBeDefined();
    expect(screen.queryByRole("button", { name: copy.save.save })).toBeNull();
  });

  test("budget tidak valid: isian ditandai dan Simpan nonaktif; setelah diperbaiki dirapikan dan disimpan", async () => {
    const user = renderPage();
    await loaded();
    const target = field("Segitiga target, Sedang");
    await user.clear(target);
    await user.type(target, "14.000");
    expect(target.getAttribute("aria-invalid")).toBe("true");
    const error = screen.getByText(copy.assets.errors.order);
    expect(target.getAttribute("aria-describedby")).toBe(error.id);
    expect(screen.getByText(copy.save.invalid)).toBeDefined();
    expect(screen.getByRole("button", { name: copy.save.save })).toHaveProperty("disabled", true);

    await user.clear(target);
    await user.type(target, "9000");
    await user.tab();
    expect(target.value).toBe("9.000");
    expect(target.getAttribute("aria-invalid")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Normal map, Ringan: Tidak ada" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "512 px" }));
    await user.click(screen.getByRole("button", { name: copy.save.save }));
    expect(await screen.findByText(copy.save.saved)).toBeDefined();
    expect(settings.tiers.sedang.triangles).toEqual({ target: 9000, max: 12_000 });
    expect(settings.tiers.ringan.textures).toEqual({ baseColor: 512, normal: 512 });
    expect(settings.model).toBe("claude-opus-5-5");
    await waitFor(() => expect(screen.queryByRole("button", { name: copy.save.save })).toBeNull());
  });

  test("Batal membuang perubahan; Pulihkan bawaan mengembalikan budget tier bawaan", async () => {
    settings = settingsFixture({
      tiers: { ...DEFAULT_TIERS, ringan: { ...DEFAULT_TIERS.ringan, materials: 2 } },
    });
    const user = renderPage();
    await loaded();
    expect(field("Material, Ringan").value).toBe("2");
    await user.click(screen.getByRole("radio", { name: "Maksimal" }));
    expect(screen.getByText(copy.save.pending)).toBeDefined();
    await user.click(screen.getByRole("button", { name: copy.save.cancel }));
    expect(screen.getByRole("radio", { name: "Sedang" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(copy.save.pending)).toBeNull();

    await user.click(screen.getByRole("button", { name: copy.assets.restore }));
    expect(field("Material, Ringan").value).toBe("1");
    await user.click(screen.getByRole("button", { name: copy.save.save }));
    await waitFor(() => expect(settings.tiers).toEqual(DEFAULT_TIERS));
  });

  test("ganti model: effort disesuaikan; model tanpa effort menyembunyikan pilihan effort", async () => {
    settings = settingsFixture({ effort: "xhigh" });
    const user = renderPage();
    await user.click(await screen.findByRole("button", { name: "Model Opus 5.5" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Sonnet 5.5" }));
    expect(await screen.findByRole("button", { name: "Effort Tinggi" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Model Sonnet 5.5" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Haiku 5.5" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Effort/ })).toBeNull());
    await user.click(screen.getByRole("button", { name: copy.save.save }));
    await waitFor(() => expect(settings.model).toBe("haiku"));
  });

  test("akun belum login; runtime gagal dibangun: akhir log dan Bangun ulang image", async () => {
    auth = { state: "logged_out", checkedAt: 1 };
    runtime = runtimeImageMissing({
      build: {
        state: "failed",
        startedAt: null,
        endedAt: Date.UTC(2026, 10, 18, 14, 5),
        error: "a\nb\n\nERROR: gagal",
      },
    });
    let built = false;
    server.on("POST", "/api/health/runtime/image", () => {
      built = true;
      return jsonResponse(
        {
          runtime: runtimeImageMissing({
            build: { state: "building", startedAt: 1, endedAt: null, error: null },
          }),
        },
        202,
      );
    });
    const user = renderPage();
    const account = section(copy.account.title);
    expect(await within(account).findByText(copy.account.loggedOutHint)).toBeDefined();
    expect(within(account).getAllByText(copy.account.loggedOut)).toHaveLength(2);
    const runtimeSection = section(copy.runtime.title);
    expect(await within(runtimeSection).findByText(copy.runtime.log)).toBeDefined();
    expect(within(runtimeSection).getByText(/ERROR: gagal/).textContent).toBe("a\nb\nERROR: gagal");
    expect(within(runtimeSection).getByText("asset-forge:b0609fed0438 belum ada")).toBeDefined();
    expect(within(runtimeSection).getByText(/Membangun image gagal pukul/)).toBeDefined();
    await user.click(within(runtimeSection).getByRole("button", { name: copy.runtime.rebuild }));
    expect(await within(runtimeSection).findByText(copy.runtime.badgeBuilding)).toBeDefined();
    expect(built).toBe(true);
    expect(within(runtimeSection).queryByRole("button", { name: copy.runtime.rebuild })).toBeNull();
  });

  test("notifikasi: tombol izinkan meminta izin; diblokir menampilkan cara membukanya", async () => {
    const requestPermission = mock(async () => "denied" as const);
    Object.defineProperty(window, "Notification", {
      value: { permission: "default", requestPermission },
      configurable: true,
    });
    const user = renderPage();
    await loaded();
    const display = section(copy.display.title);
    await user.click(within(display).getByRole("button", { name: copy.display.allow }));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "Notification", {
      value: { permission: "denied", requestPermission },
      configurable: true,
    });
    await user.click(within(display).getByRole("button", { name: copy.display.allow }));
    expect(await within(display).findByText(copy.display.blocked)).toBeDefined();
    expect(within(display).getByText(copy.display.blockedDescription)).toBeDefined();
  });

  test("pengaturan gagal dimuat → Coba lagi", async () => {
    let fail = true;
    server.on("GET", "/api/settings", () =>
      fail ? jsonResponse({ code: "INTERNAL", message: "Gagal." }, 500) : jsonResponse({ settings }),
    );
    const user = renderPage();
    expect(await screen.findByRole("heading", { name: copy.error.title })).toBeDefined();
    fail = false;
    await user.click(screen.getByRole("button", { name: copy.error.retry }));
    expect(await loaded()).toBeDefined();
    expect(screen.queryByRole("heading", { name: copy.error.title })).toBeNull();
  });
});

describe("pilihan model", () => {
  test("model tersimpan di luar daftar tetap tampil dengan id-nya; effort mengikuti model", () => {
    expect(modelChoices(undefined, "claude-opus-5-5")).toEqual({
      options: [{ value: "claude-opus-5-5", label: "claude-opus-5-5" }],
      selected: "claude-opus-5-5",
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
    expect(modelChoices(authOk(), "claude-sonnet-5-5").selected).toBe("sonnet");
    expect(effortFor(["low", "medium", "high"], "max")).toBe("high");
    expect(effortFor(["low", "medium"], "max")).toBe("medium");
    expect(effortFor([], "max")).toBe("max");
    expect(effortFor(["low", "high"], "low")).toBe("low");
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { authOk, runtimeImageMissing, runtimeReady } from "@/test-health.ts";
import { FakeRealtime } from "@/test-realtime.ts";
import { FakeServer } from "@/test-server.ts";
import { mockFetch, renderWithQuery } from "@/test-utils.tsx";
import type { AuthStatus, RuntimeStatus } from "../../../shared/health.ts";
import { StatusBanners } from "./StatusBanners.tsx";
import { StatusWatcher } from "./StatusWatcher.tsx";

let server: FakeServer;
let realtime: FakeRealtime;
let auth: AuthStatus;
let runtime: RuntimeStatus;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  auth = authOk();
  runtime = runtimeReady();
  server = new FakeServer()
    .on("GET", "/api/health/auth", () => Response.json({ auth }))
    .on("GET", "/api/health/runtime", () => Response.json({ runtime }));
  realtime = new FakeRealtime();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => restoreFetch());

function renderBanners() {
  renderWithQuery(
    <RealtimeProvider client={realtime}>
      <TooltipProvider>
        <MemoryRouter>
          <StatusWatcher />
          <Routes>
            <Route
              path="/"
              element={
                <main tabIndex={-1}>
                  <StatusBanners />
                </main>
              }
            />
            <Route path="/pengaturan" element={<h1>Pengaturan</h1>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </RealtimeProvider>,
  );
  return userEvent.setup();
}

const region = () => screen.getByRole("status", { name: t.banners.status });
const settle = () => waitFor(() => expect(server.calls("GET", "/api/health/runtime")).toHaveLength(1));

describe("banner status", () => {
  test("akun dan runtime baik → region kosong (tetap terpasang untuk pembaca layar)", async () => {
    renderBanners();
    await settle();
    await waitFor(() => expect(server.calls("GET", "/api/health/auth")).toHaveLength(1));
    expect(region().textContent).toBe("");
  });

  test("belum login: petunjuk login; Periksa ulang meminta pemeriksaan baru dan banner hilang setelah login", async () => {
    auth = { state: "logged_out", checkedAt: 1 };
    const user = renderBanners();
    expect(await within(region()).findByText(t.banners.loggedOut)).toBeDefined();
    auth = authOk();
    const recheck = within(region()).getByRole("button", { name: t.banners.recheck });
    recheck.focus();
    await user.click(recheck);
    await waitFor(() => expect(region().textContent).toBe(""));
    expect(server.requests.some((entry) => entry.request.url.includes("fresh=1"))).toBe(true);
    // Tombol yang fokus hilang bersama banner: fokus pindah ke area utama.
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  test("API key dan CLI tidak berjalan memakai nada danger; banner akun di atas banner runtime", async () => {
    auth = { state: "api_key", checkedAt: 1 };
    runtime = runtimeImageMissing();
    renderBanners();
    const apiKey = await within(region()).findByText(t.banners.apiKey);
    const image = await within(region()).findByText(t.banners.imageMissing);
    expect(apiKey.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(apiKey.parentElement?.className).toContain("bg-danger-soft");
    expect(image.parentElement?.className).toContain("bg-warning-soft");
  });

  test("Bangun image: build dimulai di server, banner berganti ke membangun (tanpa tombol), lalu hilang lewat event", async () => {
    runtime = runtimeImageMissing();
    server.on("POST", "/api/health/runtime/image", () => {
      runtime = runtimeImageMissing({
        build: { state: "building", startedAt: 1, endedAt: null, error: null },
      });
      return Response.json({ runtime }, { status: 202 });
    });
    const user = renderBanners();
    await user.click(await within(region()).findByRole("button", { name: t.banners.build }));
    expect(await within(region()).findByText(t.banners.building)).toBeDefined();
    expect(within(region()).queryByRole("button")).toBeNull();
    runtime = runtimeReady();
    act(() => realtime.emit("global", { type: "runtime" }));
    await waitFor(() => expect(region().textContent).toBe(""));
  });

  test("Docker mati → Periksa ulang; build gagal → tautan ke Pengaturan", async () => {
    runtime = runtimeImageMissing({ docker: { ok: false, detail: null } });
    const user = renderBanners();
    expect(await within(region()).findByText(t.banners.dockerDown)).toBeDefined();
    runtime = runtimeImageMissing({
      build: { state: "failed", startedAt: null, endedAt: 2, error: "gagal" },
    });
    await user.click(within(region()).getByRole("button", { name: t.banners.recheck }));
    expect(await within(region()).findByText(t.banners.buildFailed)).toBeDefined();
    await user.click(within(region()).getByRole("link", { name: t.banners.openSettings }));
    expect(await screen.findByRole("heading", { name: "Pengaturan" })).toBeDefined();
  });

  test("event `auth` (giliran gagal karena belum login) mengambil ulang status akun", async () => {
    renderBanners();
    await waitFor(() => expect(server.calls("GET", "/api/health/auth")).toHaveLength(1));
    auth = { state: "logged_out", checkedAt: 2 };
    act(() => realtime.emit("global", { type: "auth" }));
    expect(await within(region()).findByText(t.banners.loggedOut)).toBeDefined();
  });
});

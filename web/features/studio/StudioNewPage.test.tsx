import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { tierSummary } from "@/components/Tier.tsx";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { assetFixture, listFixture, listItemFixture, T0 } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { settingsFixture } from "@/test-health.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { StudioNewPage } from "./StudioNewPage.tsx";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let server: FakeServer;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  server = new FakeServer();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => {
  restoreFetch();
});

function SessionStub() {
  return <p>Sesi terbuka</p>;
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/", Component: StudioNewPage },
      { path: "/studio/:assetId", Component: SessionStub },
    ],
    { initialEntries: ["/"] },
  );
  const clock = new FakeClock(T0);
  renderWithQuery(
    <ClockProvider clock={clock}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </ClockProvider>,
  );
  return { router, clock, user: userEvent.setup() };
}

const prompt = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: t.studio.promptLabel });

describe("Studio · baru", () => {
  test("Terakhir dibuat: empat aset terbaru dengan Badge status dan waktu singkat yang ikut berjalan", async () => {
    server.on(
      "GET",
      "/api/assets",
      listFixture([
        listItemFixture({ id: "lama", name: "Paling lama", updatedAt: T0 - 30 * DAY }),
        listItemFixture({
          id: "b",
          name: "Peti kemas kayu",
          status: "BASE_REVIEW",
          updatedAt: T0 - 12 * MINUTE,
        }),
        listItemFixture({
          id: "a",
          name: "Kanister energi",
          status: "BASE_WORKING",
          runState: "running",
          updatedAt: T0 - 2 * MINUTE,
        }),
        listItemFixture({ id: "c", name: "Peti harta kayu", status: "DONE", updatedAt: T0 - 2 * HOUR }),
        listItemFixture({
          id: "d",
          name: "Lentera",
          status: "TEXTURE_REVIEW",
          runState: "failed",
          updatedAt: T0 - DAY,
        }),
      ]),
    );
    const { clock } = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: t.studio.title })).toBeDefined();
    const recent = screen.getByRole("region", { name: t.studio.recent });
    const cards = await within(within(recent).getByRole("list")).findAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/studio/a",
      "/studio/b",
      "/studio/c",
      "/studio/d",
    ]);
    const [working, review, done, failed] = cards;
    expect(working?.textContent).toBe("Kanister energiMembuat…2 mnt");
    expect(review?.textContent).toBe("Peti kemas kayuPerlu review12 mnt");
    expect(done?.textContent).toBe("Peti harta kayuFinal2 jam");
    expect(failed?.textContent).toBe("LenteraGagal1 hari");
    act(() => clock.advance(MINUTE));
    expect(working?.textContent).toBe("Kanister energiMembuat…3 mnt");
    expect(
      within(recent)
        .getByRole("link", { name: /Buka Gudang/ })
        .getAttribute("href"),
    ).toBe("/gudang");
  });

  test("Terakhir dibuat kosong: ajakan membuat aset pertama", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    renderPage();
    expect(await screen.findByText(t.studio.recentEmpty)).toBeDefined();
  });

  test("daftar gagal dimuat → pesan + Coba lagi memuat ulang", async () => {
    server.on("GET", "/api/assets", () => jsonResponse({ code: "INTERNAL", message: "Galat server." }, 500));
    const { user } = renderPage();
    expect(await screen.findByText(t.studio.recentError)).toBeDefined();
    server.on("GET", "/api/assets", listFixture([listItemFixture({ id: "peti", name: "Peti harta kayu" })]));
    await user.click(screen.getByRole("button", { name: t.studio.retry }));
    expect(await screen.findByRole("link", { name: /Peti harta kayu/ })).toBeDefined();
  });

  test("dibuka setelah aset dihapus dari sesi Studio: fokus di kolom prompt sekali; Back ke entri itu atau dibuka biasa: fokus tidak dipindah", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    const { router } = renderPage();
    await screen.findByRole("heading", { name: t.studio.title });
    expect(document.activeElement).toBe(document.body);
    // Seperti hapus dari sesi: navigasi dari halaman sesi ke Studio baru dengan state fokus.
    await act(() => router.navigate("/studio/peti"));
    expect(await screen.findByText("Sesi terbuka")).toBeDefined();
    await act(() => router.navigate("/", { state: arrivalState("prompt") }));
    await waitFor(() => expect(document.activeElement).toBe(prompt()));
    await act(() => router.navigate("/studio/peti"));
    expect(await screen.findByText("Sesi terbuka")).toBeDefined();
    await act(() => router.navigate(-1));
    await screen.findByRole("heading", { name: t.studio.title });
    expect(document.activeElement).toBe(document.body);
  });

  test("chip contoh mengisi prompt lengkap dan memindah fokus ke composer", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    const { user } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Pohon low-poly" }));
    expect(prompt().value).toBe("Pohon low-poly untuk game mobile");
    expect(document.activeElement).toBe(prompt());
  });

  test("kirim: aset dibuat dengan prompt, tier, dan lampiran, lalu sesinya dibuka", async () => {
    let form: FormData | null = null;
    server.on("GET", "/api/assets", listFixture([]));
    server.on("POST", "/api/assets", async (request) => {
      form = await request.formData();
      return jsonResponse(
        { asset: assetFixture({ id: "baru", status: "BRIEFING", currentVersion: null }) },
        201,
      );
    });
    const { user, router } = renderPage();
    expect(await screen.findByText(tierSummary("sedang", DEFAULT_TIERS.sedang))).toBeDefined();
    const send = screen.getByRole("button", { name: t.composer.send });
    // Prompt kosong: belum bisa dikirim.
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.type(prompt(), "Peti kayu dengan engsel besi");
    await user.click(screen.getByRole("radio", { name: "Maksimal" }));
    expect(screen.getByText(tierSummary("maksimal", DEFAULT_TIERS.maksimal))).toBeDefined();
    await user.upload(
      screen.getByLabelText(t.composer.addImage, { selector: "input" }),
      new File([new Uint8Array([137, 80, 78, 71])], "sketsa.png", { type: "image/png" }),
    );
    expect(screen.getByText("sketsa.png")).toBeDefined();
    await user.type(prompt(), "{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/studio/baru"));
    expect(form).not.toBeNull();
    const sent = form ?? new FormData();
    expect(sent.get("prompt")).toBe("Peti kayu dengan engsel besi");
    expect(sent.get("tierId")).toBe("maksimal");
    expect(sent.getAll("files[]").map((file) => (file instanceof File ? file.name : file))).toEqual([
      "sketsa.png",
    ]);
  });

  test("tier awal dan info budget dari Pengaturan; pilihan di composer tetap menang setelah Pengaturan termuat", async () => {
    const ringan = { ...DEFAULT_TIERS.ringan, triangles: { target: 2500, max: 3000 } };
    server.on("GET", "/api/assets", listFixture([]));
    server.on("GET", "/api/settings", {
      settings: settingsFixture({ defaultTier: "ringan", tiers: { ...DEFAULT_TIERS, ringan } }),
    });
    const { user } = renderPage();
    expect(await screen.findByText(tierSummary("ringan", ringan))).toBeDefined();
    expect(screen.getByRole("radio", { name: "Ringan" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Maksimal" }));
    expect(screen.getByText(tierSummary("maksimal", DEFAULT_TIERS.maksimal))).toBeDefined();
  });

  test("gagal membuat aset: toast berisi pesan server, prompt tetap, halaman tidak berpindah", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    server.on("POST", "/api/assets", () =>
      jsonResponse({ code: "RUNTIME_NOT_READY", message: "Runtime 3D belum siap." }, 503),
    );
    const { user, router } = renderPage();
    await user.type(await screen.findByRole("textbox", { name: t.studio.promptLabel }), "Peti kayu{Enter}");
    const toasts = screen.getByRole("region", { name: /Notifikasi/ });
    expect(await within(toasts).findByText(t.studio.createFailed)).toBeDefined();
    expect(within(toasts).getByText("Runtime 3D belum siap.")).toBeDefined();
    expect(prompt().value).toBe("Peti kayu");
    expect(router.state.location.pathname).toBe("/");
  });
});

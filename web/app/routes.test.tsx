import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { assetFixture, detailFixture, listFixture, listItemFixture } from "@/test-assets.ts";
import { FakeRealtime } from "@/test-realtime.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { createThemeStore, ThemeStoreContext } from "@/theme.ts";
import { PREFERS_LIGHT_QUERY } from "@/theme-script.ts";
import { routes } from "./routes.tsx";

let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  const spy = mockFetch((path) =>
    path === "/api/assets"
      ? jsonResponse(listFixture(["a", "b", "c"].map((id) => listItemFixture({ id, name: `Aset ${id}` }))))
      : jsonResponse({}),
  );
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => {
  restoreFetch();
});

/**
 * Store tema baru untuk setiap tes. Store bawaan browser adalah singleton modul, sehingga pilihan tema dari satu tes
 * (mis. "Terang" di tes menu akun) terbawa ke tes berikutnya.
 */
function freshThemeStore() {
  return createThemeStore({
    storage: window.localStorage,
    media: window.matchMedia(PREFERS_LIGHT_QUERY),
    root: document.documentElement,
    events: window,
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  renderWithQuery(
    <ThemeStoreContext value={freshThemeStore()}>
      <RealtimeProvider client={new FakeRealtime()}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </RealtimeProvider>
    </ThemeStoreContext>,
  );
  return { user: userEvent.setup(), router };
}

const rail = () => screen.getByRole("navigation", { name: "Navigasi utama" });

/** Halaman Studio baru selesai memuat daftar "Terakhir dibuat" (render ulangnya tidak tercampur langkah tes). */
const recentLoaded = () => screen.findByRole("link", { name: /Aset c/ });

describe("kerangka app", () => {
  test("Studio adalah halaman awal: rel dengan Studio aktif, breadcrumb, indikator tahap, judul", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeDefined();
    await recentLoaded();
    expect(within(rail()).getByRole("img", { name: "AI Asset Generate" })).toBeDefined();
    expect(within(rail()).getByRole("link", { name: "Studio" }).getAttribute("aria-current")).toBe("page");
    expect(within(rail()).getByRole("link", { name: "Gudang" }).getAttribute("aria-current")).toBeNull();
    const breadcrumb = screen.getByRole("navigation", { name: "Lokasi halaman" });
    expect(within(breadcrumb).getByRole("link", { name: "Studio" }).getAttribute("href")).toBe("/");
    expect(within(breadcrumb).getByText("Aset baru").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("list", { name: "Tahap aset" })).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    // Header sementara Tahap 0 dan status server sudah tidak ada (Log 2026-11-13).
    expect(screen.queryByText(/Server tersambung/)).toBeNull();
  });

  test("halaman sesi aset tetap bagian dari Studio: item Studio di rel aktif (desain 02)", async () => {
    restoreFetch();
    const spy = mockFetch((path) => {
      if (path === "/api/assets")
        return jsonResponse(listFixture([listItemFixture({ id: "a", name: "Aset a" })]));
      if (path === "/api/assets/a/events") return jsonResponse({ events: [], hasMore: false });
      if (path === "/api/assets/a")
        return jsonResponse(
          detailFixture({ asset: assetFixture({ id: "a", name: "Aset a" }), versions: [] }),
        );
      return jsonResponse({});
    });
    restoreFetch = () => spy.mockRestore();
    renderAt("/studio/a");
    const breadcrumb = await screen.findByRole("navigation", { name: "Lokasi halaman" });
    expect((await within(breadcrumb).findByText("Aset a")).getAttribute("aria-current")).toBe("page");
    const studio = within(rail()).getByRole("link", { name: "Studio" });
    expect(studio.getAttribute("aria-current")).toBe("page");
    expect(studio.className).toContain("bg-bg-active");
    expect(within(rail()).getByRole("link", { name: "Gudang" }).getAttribute("aria-current")).toBeNull();
  });

  test("navigasi rel ke Gudang dan Pengaturan; tombol Pengaturan aktif di halamannya", async () => {
    const { user } = renderAt("/");
    await user.click(within(rail()).getByRole("link", { name: "Gudang" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Gudang" })).toBeDefined();
    await user.click(within(rail()).getByRole("link", { name: "Pengaturan" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pengaturan" })).toBeDefined();
    const settings = within(rail()).getByRole("link", { name: "Pengaturan" });
    expect(settings.getAttribute("aria-current")).toBe("page");
    expect(settings.className).toContain("bg-bg-active");
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeDefined();
  });

  test("Gudang: jumlah aset dari API dan tombol Aset baru ke Studio", async () => {
    const { user, router } = renderAt("/gudang");
    expect(await screen.findByText("3 aset")).toBeDefined();
    await user.click(screen.getByRole("link", { name: "Aset baru" }));
    expect(router.state.location.pathname).toBe("/");
  });

  test("menu akun: chip akun, Pengaturan, dan pilihan tema", async () => {
    const { user, router } = renderAt("/");
    within(rail()).getByRole("button", { name: "Akun" }).focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Akun Claude")).toBeDefined();
    const themes = within(menu).getByRole("group", { name: "Tema" });
    expect(within(themes).getByRole("menuitemradio", { name: "Gelap" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await user.click(within(menu).getByRole("menuitemradio", { name: "Terang" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(within(rail()).getByRole("button", { name: "Akun" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pengaturan" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pengaturan"));
  });

  test("Panduan membuka dialog cara kerja", async () => {
    const { user } = renderAt("/");
    await recentLoaded();
    await user.click(screen.getByRole("button", { name: "Panduan" }));
    const dialog = await screen.findByRole("dialog", { name: "Panduan" });
    expect(within(dialog).getByRole("heading", { name: "Paling cocok" })).toBeDefined();
    expect(within(dialog).getByRole("heading", { name: "Masih terbatas" })).toBeDefined();
  });

  test("tautan lewati-ke-konten adalah elemen pertama yang mendapat fokus", async () => {
    const { user } = renderAt("/");
    await recentLoaded();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Lewati ke konten utama");
    expect(document.activeElement?.getAttribute("href")).toBe("#konten");
  });

  test("alamat yang tidak ada → halaman 404 dengan jalan kembali ke Studio", async () => {
    const { user, router } = renderAt("/tidak-ada");
    expect(await screen.findByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })).toBeDefined();
    await user.click(screen.getByRole("link", { name: "Kembali ke Studio" }));
    expect(router.state.location.pathname).toBe("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeDefined();
    await recentLoaded();
  });
});

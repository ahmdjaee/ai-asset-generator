import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import type { AssetListItemData } from "@/lib/assets.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { assetFixture, listFixture, listItemFixture, T0 } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { ASSET_NAME_MAX_CHARS } from "../../../shared/limits.ts";
import { GudangPage } from "./GudangPage.tsx";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const PETI = listItemFixture({
  id: "peti",
  name: "Peti harta kayu",
  prompt: "Peti harta kayu dengan engsel besi",
  status: "DONE",
  currentVersion: 2,
  versionCount: 2,
  current: { n: 2, stage: "textured", triangles: 3388, webBytes: 612_000, thumbnail: true },
  updatedAt: T0 - 2 * 60 * MINUTE,
});
const LENTERA = listItemFixture({
  id: "lentera",
  name: "Lentera besi",
  prompt: "Lentera gantung",
  tierId: "ringan",
  status: "BASE_REVIEW",
  currentVersion: 1,
  versionCount: 1,
  current: { n: 1, stage: "base", triangles: 950, webBytes: 88_000, thumbnail: true },
  updatedAt: T0 - 12 * MINUTE,
});
const KANISTER = listItemFixture({
  id: "kanister",
  name: "Kanister energi",
  status: "BASE_WORKING",
  runState: "running",
  currentVersion: null,
  progress: { stage: "base", pct: 30 },
  updatedAt: T0,
});

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

/** `GET /api/assets` yang menyaring berdasarkan `q` (nama), seperti server, dan mencatat query-nya. */
function serveList(items: readonly AssetListItemData[]) {
  server.on("GET", "/api/assets", (request) => {
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    return jsonResponse(
      listFixture(
        items.filter((item) => item.name.toLowerCase().includes(q)),
        items.length,
      ),
    );
  });
}

const listQueries = () =>
  server.calls("GET", "/api/assets").map((request) => Object.fromEntries(new URL(request.url).searchParams));

function DetailStub() {
  return <p>Detail aset</p>;
}

function HomeStub() {
  return <p>Studio baru</p>;
}

function SessionStub() {
  return <p>Sesi Studio</p>;
}

/** Tampilan selama loader rute pertama berjalan (tes navigasi tertahan). */
function Hydrating() {
  return null;
}

function renderPage(
  path: string | Readonly<{ pathname: string; search: string; state: unknown }> = "/gudang",
  loader?: () => Promise<null> | null,
) {
  const router = createMemoryRouter(
    [
      { path: "/", Component: HomeStub },
      {
        path: "/gudang",
        Component: GudangPage,
        ...(loader === undefined ? {} : { loader, HydrateFallback: Hydrating }),
      },
      { path: "/gudang/:assetId", Component: DetailStub },
      { path: "/studio/:assetId", Component: SessionStub },
    ],
    { initialEntries: [path] },
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

const results = () => screen.getByRole("list", { name: t.gudang.results });

/** Dialog sudah tertutup, atau ditunggu sampai tertutup (animasi tutup Radix). */
async function dialogClosed() {
  if (screen.queryByRole("dialog") !== null)
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
}

describe("Gudang", () => {
  test("grid: kartu bertautan ke Detail aset, thumbnail versi terkini, info, dan jumlah aset di topbar", async () => {
    serveList([KANISTER, LENTERA, PETI]);
    const { router, user } = renderPage("/gudang?sort=name");
    expect(await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: t.gudang.title })).toBeDefined();
    expect(screen.getByText("3 aset")).toBeDefined();
    const peti = within(results()).getAllByRole("listitem")[2];
    expect(peti?.querySelector("img")?.getAttribute("src")).toBe("/api/assets/peti/versions/2/thumb.webp");
    expect(peti?.textContent).toContain("3,4k segitiga · 612 KB");
    expect(peti?.textContent).toContain("2 jam lalu");
    const kanister = within(results()).getAllByRole("listitem")[0];
    expect(kanister?.querySelector("img")).toBeNull();
    expect(
      within(kanister ?? document.body)
        .getByRole("progressbar")
        .getAttribute("aria-valuenow"),
    ).toBe("30");

    await user.click(screen.getByRole("link", { name: "Peti harta kayu" }));
    expect(await screen.findByText("Detail aset")).toBeDefined();
    expect(router.state.location.pathname).toBe("/gudang/peti");
    // Filter ikut dibawa supaya breadcrumb Detail kembali ke daftar yang sama.
    expect(router.state.location.state).toEqual({ gudangSearch: "?sort=name" });
  });

  test("cari: '/' memfokuskan kolom cari; ketikan masuk URL dan query server", async () => {
    serveList([LENTERA, PETI]);
    const { router, user } = renderPage();
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: t.gudang.search.label });
    expect(search.getAttribute("aria-keyshortcuts")).toBe("/");
    await user.keyboard("/");
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe("");
    // Jumlah hasil diumumkan pembaca layar lewat status yang selalu terpasang (kosong tanpa cari/filter).
    const status = within(screen.getByRole("region", { name: t.gudang.filters })).getByRole("status");
    expect(status.textContent).toBe("");
    await user.keyboard("lentera");
    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 3, name: "Peti harta kayu" })).toBeNull(),
    );
    expect(router.state.location.search).toBe("?q=lentera");
    expect(listQueries().at(-1)).toEqual({ q: "lentera" });
    expect(search.value).toBe("lentera");
    await waitFor(() => expect(status.textContent).toBe(t.gudang.found("1")));
    expect(within(screen.getByRole("region", { name: t.gudang.filters })).getByRole("status")).toBe(status);
  });

  test("mengetik saat navigasi URL belum tiba tidak menghapus huruf yang sudah diketik", async () => {
    serveList([LENTERA, PETI]);
    // Di browser, navigasi router berjalan sebagai transition dan tiba setelah beberapa ketikan. Di sini ditahan lewat
    // loader yang menunggu sampai dilepas, supaya URL tertinggal dari isi kolom seperti saat mengetik cepat.
    let hold: Promise<null> | null = null;
    let release: () => void = () => undefined;
    const { router, user } = renderPage("/gudang", () => hold ?? null);
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: t.gudang.search.label });
    hold = new Promise((resolve) => {
      release = () => resolve(null);
    });
    await user.click(search);
    await user.keyboard("lentera");
    expect(search.value).toBe("lentera");
    expect(router.state.location.search).toBe("");
    release();
    await waitFor(() => expect(router.state.location.search).toBe("?q=lentera"));
    expect(search.value).toBe("lentera");
    // Perubahan dari luar (Hapus filter, tautan rel) tetap menimpa isi kolom.
    hold = null;
    await act(() => router.navigate("/gudang"));
    expect(search.value).toBe("");
  });

  test("ketikan bernilai sama yang navigasinya dirangkum router: Hapus filter tetap mengosongkan kolom", async () => {
    serveList([LENTERA, PETI]);
    let hold: Promise<null> | null = null;
    let release: () => void = () => undefined;
    const { router, user } = renderPage("/gudang", () => hold ?? null);
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const search = screen.getByRole<HTMLInputElement>("searchbox", { name: t.gudang.search.label });
    hold = new Promise((resolve) => {
      release = () => resolve(null);
    });
    await user.click(search);
    // "x", "", "x": navigasi yang belum selesai dibatalkan router, jadi hanya yang terakhir tiba.
    await user.keyboard("x{Backspace}x");
    release();
    await waitFor(() => expect(router.state.location.search).toBe("?q=x"));
    hold = null;
    expect(search.value).toBe("x");
    await user.click(await screen.findByRole("button", { name: t.gudang.empty.clearFilters }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(search.value).toBe("");
  });

  test("dibuka setelah aset dihapus dari Detail aset: fokus di kolom cari", async () => {
    serveList([PETI]);
    renderPage({ pathname: "/gudang", search: "?view=list", state: arrivalState("search") });
    const search = await screen.findByRole("searchbox", { name: t.gudang.search.label });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  test("filter Tier, Tanggal, dan Urutkan dikirim ke server; Tanggal dihitung dari jam yang disuntikkan", async () => {
    serveList([PETI]);
    const { router, user } = renderPage();
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    await user.click(screen.getByRole("button", { name: "Tier Semua" }));
    await user.click(screen.getByRole("menuitemradio", { name: t.tier.sedang }));
    await waitFor(() => expect(listQueries().at(-1)).toEqual({ tier: "sedang" }));
    await user.click(await screen.findByRole("button", { name: "Tanggal Semua" }));
    await user.click(screen.getByRole("menuitemradio", { name: t.gudang.date.week }));
    await waitFor(() =>
      expect(listQueries().at(-1)).toEqual({ tier: "sedang", since: String(T0 - 7 * DAY) }),
    );
    await user.click(await screen.findByRole("button", { name: "Urutkan Terbaru" }));
    await user.click(screen.getByRole("menuitemradio", { name: t.gudang.sort.name }));
    await waitFor(() => expect(listQueries().at(-1)?.sort).toBe("name"));
    expect(router.state.location.search).toBe("?tier=sedang&date=week&sort=name");
  });

  test("tidak ada hasil: Hapus filter mengosongkan kata kunci dan filter, urutan tetap", async () => {
    serveList([PETI]);
    const { router, user } = renderPage("/gudang?q=zzz&tier=ringan&sort=oldest");
    expect(await screen.findByRole("heading", { name: t.gudang.empty.noResults })).toBeDefined();
    const status = within(screen.getByRole("region", { name: t.gudang.filters })).getByRole("status");
    expect(status.textContent).toBe(t.gudang.empty.noResults);
    await user.click(screen.getByRole("button", { name: t.gudang.empty.clearFilters }));
    expect(await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" })).toBeDefined();
    expect(status.textContent).toBe("");
    expect(router.state.location.search).toBe("?sort=oldest");
    expect(screen.getByRole<HTMLInputElement>("searchbox", { name: t.gudang.search.label }).value).toBe("");
  });

  test("belum ada aset: ajakan membuat aset di Studio", async () => {
    serveList([]);
    const { user } = renderPage();
    expect(await screen.findByRole("heading", { name: t.gudang.empty.noAssets })).toBeDefined();
    const links = screen.getAllByRole("link", { name: t.gudang.newAsset });
    expect(links).toHaveLength(2);
    await user.click(links[1] ?? document.body);
    expect(await screen.findByText("Studio baru")).toBeDefined();
  });

  test("gagal dimuat: state error, Coba lagi memuat ulang", async () => {
    let fail = true;
    server.on("GET", "/api/assets", () =>
      fail ? jsonResponse({ code: "INTERNAL", message: "Gagal." }, 500) : jsonResponse(listFixture([PETI])),
    );
    const { user } = renderPage();
    expect(await screen.findByRole("heading", { name: t.gudang.error.title })).toBeDefined();
    fail = false;
    await user.click(screen.getByRole("button", { name: t.gudang.error.retry }));
    expect(await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" })).toBeDefined();
  });

  test("mode pilih: kotak centang per kartu, aset tanpa versi nonaktif, ZIP berisi aset terpilih", async () => {
    serveList([KANISTER, LENTERA, PETI]);
    const { user } = renderPage();
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const toggle = screen.getByRole("button", { name: t.gudang.select.toggle });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("link", { name: "Peti harta kayu" })).toBeNull();
    const kanister = screen.getByRole("checkbox", { name: t.gudang.select.unavailable("Kanister energi") });
    expect(kanister.hasAttribute("disabled")).toBe(true);
    const bar = screen.getByRole("region", { name: t.gudang.select.bar });
    expect(within(bar).getByRole("status").textContent).toBe("0 aset dipilih");
    expect(within(bar).getByRole("button", { name: t.gudang.select.zipWeb }).hasAttribute("disabled")).toBe(
      true,
    );

    // Klik di judul (di mana saja di kartu) memilih.
    await user.click(screen.getByText("Peti harta kayu"));
    expect(
      screen
        .getByRole("checkbox", { name: t.gudang.select.item("Peti harta kayu") })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(bar).getByRole("status").textContent).toBe("1 aset dipilih");
    server.on("POST", "/api/assets/export-zip/prepare", { assets: 1, bytes: 10 });
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const downloaded = () =>
      click.mock.contexts
        .filter((context) => context instanceof HTMLAnchorElement)
        .map((link) => link.getAttribute("href"));
    try {
      await user.click(within(bar).getByRole("button", { name: t.gudang.select.zipUnity }));
      await waitFor(() => expect(downloaded()).toEqual(["/api/assets/export-zip?ids=peti&preset=unity"]));

      await user.click(within(bar).getByRole("button", { name: t.gudang.select.all }));
      expect(within(bar).getByRole("status").textContent).toBe("2 aset dipilih");
      await user.click(within(bar).getByRole("button", { name: t.gudang.select.zipWeb }));
      await waitFor(() =>
        expect(downloaded()).toEqual([
          "/api/assets/export-zip?ids=peti&preset=unity",
          "/api/assets/export-zip?ids=lentera%2Cpeti&preset=web",
        ]),
      );
      const bodies = await Promise.all(
        server.calls("POST", "/api/assets/export-zip/prepare").map((request) => request.json()),
      );
      expect(bodies).toEqual([
        { ids: ["peti"], preset: "unity" },
        { ids: ["lentera", "peti"], preset: "web" },
      ]);
    } finally {
      click.mockRestore();
    }

    await user.click(within(bar).getByRole("button", { name: t.gudang.select.cancel }));
    expect(screen.queryByRole("region", { name: t.gudang.select.bar })).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("link", { name: "Peti harta kayu" })).toBeDefined();
  });

  test("tampilan daftar: baris bertautan, menu aksi per baris; Duplikat memanggil server dan memberi toast", async () => {
    serveList([LENTERA, PETI]);
    server.on("POST", "/api/assets/peti/duplicate", () =>
      jsonResponse({ asset: assetFixture({ id: "salinan", name: "Peti harta kayu (salinan)" }) }, 201),
    );
    const { router, user } = renderPage();
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const list = screen.getByRole("radio", { name: t.gudang.view.list });
    await user.click(list);
    expect(router.state.location.search).toBe("?view=list");
    const row = screen.getByRole("link", { name: "Peti harta kayu" }).closest("article");
    expect(row?.textContent).toContain("Peti harta kayu dengan engsel besi");
    expect(row?.textContent).toContain("3,4k segitiga · 612 KB");

    await user.click(screen.getByRole("button", { name: t.assetActions.menuFor("Peti harta kayu") }));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual([
      t.assetActions.continueInStudio,
      t.assetActions.export,
      t.assetActions.rename,
      t.assetActions.duplicate,
      t.assetActions.delete,
    ]);
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.duplicate }));
    expect(await screen.findByText(t.assetActions.duplicated("Peti harta kayu (salinan)"))).toBeDefined();
    expect(server.calls("POST", "/api/assets/peti/duplicate")).toHaveLength(1);
  });

  test("hapus dari menu baris: dialog konfirmasi, DELETE, baris hilang, fokus ke aset berikutnya", async () => {
    serveList([LENTERA, PETI]);
    server.on("DELETE", "/api/assets/lentera", () => new Response(null, { status: 204 }));
    const { user } = renderPage("/gudang?view=list");
    await screen.findByRole("heading", { level: 3, name: "Lentera besi" });
    await user.click(screen.getByRole("button", { name: t.assetActions.menuFor("Lentera besi") }));
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.delete }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.deleteDialog.title });
    expect(dialog.textContent).toContain("“Lentera besi” beserta 1 versi, lampiran");
    // Fokus awal di Batal, bukan di tombol yang merusak.
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: t.assetActions.deleteDialog.cancel }),
    );

    // Setelah DELETE, daftar dari server tidak lagi memuat aset itu.
    serveList([PETI]);
    await user.click(within(dialog).getByRole("button", { name: t.assetActions.deleteDialog.confirm }));
    await dialogClosed();
    expect(server.calls("DELETE", "/api/assets/lentera")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 3, name: "Lentera besi" })).toBeNull();
    expect(await screen.findByText(t.assetActions.deleted("Lentera besi"))).toBeDefined();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("link", { name: "Peti harta kayu" })),
    );
  });

  test("ganti nama dari menu baris: PATCH berisi nama baru; nama kosong ditolak di dialog", async () => {
    serveList([PETI]);
    const bodies: unknown[] = [];
    server.on("PATCH", "/api/assets/peti", async (request) => {
      const body: unknown = await request.json();
      bodies.push(body);
      const name = typeof body === "object" && body !== null && "name" in body ? String(body.name) : "";
      return jsonResponse({ asset: assetFixture({ id: "peti", name }) });
    });
    const { user } = renderPage("/gudang?view=list");
    await screen.findByRole("heading", { level: 3, name: "Peti harta kayu" });
    const trigger = screen.getByRole("button", { name: t.assetActions.menuFor("Peti harta kayu") });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.rename }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.renameDialog.title });
    const field = within(dialog).getByRole<HTMLInputElement>("textbox", {
      name: t.assetActions.renameDialog.label,
    });
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Peti harta kayu");

    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(within(dialog).getByText(t.assetActions.renameDialog.empty)).toBeDefined();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(server.calls("PATCH", "/api/assets/peti")).toHaveLength(0);

    // Batas nama per code point, sama dengan server: 80 emoji boleh, 81 ditolak di dialog.
    const emoji = "\u{1F4E6}";
    await user.paste(emoji.repeat(ASSET_NAME_MAX_CHARS + 1));
    expect(field.value).toBe(emoji.repeat(ASSET_NAME_MAX_CHARS + 1));
    expect(
      within(dialog).getByText(t.assetActions.renameDialog.tooLong(String(ASSET_NAME_MAX_CHARS))),
    ).toBeDefined();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    await user.keyboard("{Enter}");
    expect(server.calls("PATCH", "/api/assets/peti")).toHaveLength(0);
    await user.clear(field);
    await user.paste(emoji.repeat(ASSET_NAME_MAX_CHARS));
    expect(field.getAttribute("aria-invalid")).toBeNull();
    await user.clear(field);

    await user.type(field, "Peti emas{Enter}");
    await dialogClosed();
    expect(bodies).toEqual([{ name: "Peti emas" }]);
    // Fokus kembali ke menu "…" yang membuka dialog.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await act(async () => undefined);
  });
});

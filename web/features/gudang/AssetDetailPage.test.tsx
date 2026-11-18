import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { arrivalState } from "@/lib/arrival-focus.ts";
import { ClockProvider } from "@/lib/clock.tsx";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { assetFixture, detailFixture, listFixture, T0, versionFixture } from "@/test-assets.ts";
import { FakeClock } from "@/test-clock.ts";
import { FakeRealtime } from "@/test-realtime.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { AssetWatcher } from "../studio/AssetWatcher.tsx";
import { SessionViewerContext } from "../studio/session-viewer.tsx";
import { DetailPanel } from "../viewer/DetailPanel.tsx";
import type { ViewerProps } from "../viewer/Viewer.tsx";
import { AssetDetailPage } from "./AssetDetailPage.tsx";
import { gudangLinkState } from "./link-state.ts";

const HOUR = 60 * 60_000;

const DETAIL = detailFixture({
  asset: assetFixture({
    status: "DONE",
    currentVersion: 2,
    approvedBaseVersion: 1,
    // `bun test` berjalan di zona waktu UTC (bawaan Bun bila TZ tidak diset), jadi jam yang tampil = jam UTC.
    createdAt: Date.UTC(2026, 10, 14, 9, 12),
    updatedAt: T0 - 2 * HOUR,
    brief: {
      summary: "Peti harta kayu bergaya stylized dengan engsel besi",
      category: "Props",
      style: "stylized",
      dimensionsM: { width: 0.65, depth: 0.44, height: 0.53 },
      notes: "origin di dasar",
    },
  }),
  versions: [versionFixture({ n: 1 }), versionFixture({ n: 2, stage: "textured" })],
  attachments: [
    { id: "g1", kind: "image", name: "sketsa-peti.jpg", mime: "image/jpeg", size: 184_000, createdAt: T0 },
    { id: "m1", kind: "model", name: "acuan.glb", mime: "model/gltf-binary", size: 52_000, createdAt: T0 },
  ],
});

let server: FakeServer;
let realtime: FakeRealtime;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  server = new FakeServer();
  realtime = new FakeRealtime();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
  server.on("GET", "/api/assets", listFixture([]));
  server.on("GET", "/api/assets/peti", DETAIL);
});

afterEach(() => {
  restoreFetch();
});

/** Viewer tiruan (tanpa three.js): file yang dibuka dan panel Detail sungguhan. */
function FakeViewer({ src, name, stage = "base", detail }: ViewerProps) {
  return (
    <section aria-label={t.viewer.region}>
      <p>{`${name} · ${stage} · ${src}`}</p>
      {detail === undefined ? null : <DetailPanel data={detail} onCollapse={() => undefined} />}
    </section>
  );
}

function GudangStub() {
  return <p>Daftar Gudang</p>;
}

function SessionStub() {
  return <p>Sesi Studio</p>;
}

/** Detail aset di dalam kerangka app: penyimak perubahan aset (topik global) ikut terpasang, seperti di AppLayout. */
function DetailInApp() {
  return (
    <>
      <AssetWatcher />
      <AssetDetailPage />
    </>
  );
}

function renderPage(state: unknown = gudangLinkState("?tier=sedang&view=list")) {
  const router = createMemoryRouter(
    [
      { path: "/gudang", Component: GudangStub },
      { path: "/gudang/:assetId", Component: DetailInApp },
      { path: "/studio/:assetId", Component: SessionStub },
    ],
    { initialEntries: [{ pathname: "/gudang/peti", state }] },
  );
  renderWithQuery(
    <ClockProvider clock={new FakeClock(T0)}>
      <RealtimeProvider client={realtime}>
        <SessionViewerContext.Provider value={FakeViewer}>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </SessionViewerContext.Provider>
      </RealtimeProvider>
    </ClockProvider>,
  );
  return { router, user: userEvent.setup() };
}

describe("Detail aset", () => {
  test("topbar: breadcrumb kembali ke Gudang dengan filter terakhir, Tier, Badge, Lanjutkan di Studio, Ekspor", async () => {
    const { router, user } = renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" })).toBeDefined();
    const crumbs = screen.getByRole("navigation", { name: t.shell.breadcrumb });
    expect(within(crumbs).getByRole("link", { name: t.gudang.title }).getAttribute("href")).toBe(
      "/gudang?tier=sedang&view=list",
    );
    expect(within(crumbs).getByText("Peti harta kayu").getAttribute("aria-current")).toBe("page");
    const topbar = crumbs.closest("header");
    expect(topbar?.textContent).toContain(t.tier.sedang);
    expect(topbar?.textContent).toContain(t.status.done);
    expect(screen.getByRole("link", { name: t.assetDetail.continueInStudio }).getAttribute("href")).toBe(
      "/studio/peti",
    );
    await user.click(screen.getByRole("link", { name: t.gudang.title }));
    expect(await screen.findByText("Daftar Gudang")).toBeDefined();
    expect(router.state.location.search).toBe("?tier=sedang&view=list");
  });

  test("tanpa state filter (tautan langsung): breadcrumb ke Gudang tanpa filter", async () => {
    renderPage(null);
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    expect(screen.getByRole("link", { name: t.gudang.title }).getAttribute("href")).toBe("/gudang");
  });

  test("panel Info aset: prompt, lampiran, ringkasan brief, tanggal dibuat, waktu diubah, jumlah versi", async () => {
    renderPage();
    const panel = await screen.findByRole("region", { name: t.assetDetail.info });
    const prompt = within(panel).getByRole("region", { name: t.assetDetail.prompt });
    expect(prompt.textContent).toContain("Peti harta kayu dengan engsel besi");
    const attachments = within(prompt).getByRole("list", { name: t.assetDetail.attachments });
    expect(
      within(attachments)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["sketsa-peti.jpg", "acuan.glb"]);
    expect(attachments.querySelector("img")?.getAttribute("src")).toBe("/api/assets/peti/attachments/g1");
    const brief = within(panel).getByRole("region", { name: t.thread.brief.title });
    expect(brief.textContent).toContain("Props · stylized");
    const info = within(panel).getByRole("region", { name: t.assetDetail.infoTitle });
    const rows = Array.from(info.querySelectorAll("dl > div"), (row) => row.textContent);
    expect(rows).toEqual(["Dibuat14 Nov 2026, 09.12", "Diubah2 jam lalu", "Versi2 versi"]);
  });

  test("viewport: versi terkini dengan panel detail dan thumbnail per versi; ganti versi membuka file versi itu", async () => {
    const { user } = renderPage();
    const viewer = await screen.findByRole("region", { name: t.viewer.region });
    expect(viewer.textContent).toContain("Peti harta kayu · final · /api/assets/peti/versions/2/web.glb");
    const versions = within(viewer).getByRole("radiogroup", { name: t.versions.label });
    expect(versions.querySelector("img")?.getAttribute("src")).toBe("/api/assets/peti/versions/1/thumb.webp");
    await user.click(within(versions).getByRole("radio", { name: /v1 · Bentuk dasar/ }));
    await waitFor(() => expect(viewer.textContent).toContain("· base · /api/assets/peti/versions/1/web.glb"));
  });

  test("Ekspor membuka dialog untuk versi yang sedang dilihat; menu “…” tanpa aksi yang sudah jadi tombol", async () => {
    server.on("GET", "/api/assets/peti/export/estimate", { version: 2, presets: [] });
    const { user } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    await user.click(screen.getByRole("button", { name: t.assetActions.menu }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      t.assetActions.rename,
      t.assetActions.duplicate,
      t.assetActions.delete,
    ]);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: t.assetDetail.export }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.exportDialog.title });
    expect(
      await within(dialog).findByRole("button", {
        name: `${t.assetActions.exportDialog.version} v2 · Aset final`,
      }),
    ).toBeDefined();
  });

  test("hapus: konfirmasi lalu kembali ke Gudang (filter terakhir); halaman tidak berkedip ke “tidak ditemukan”", async () => {
    let deleted = false;
    server.on("GET", "/api/assets/peti", () =>
      deleted
        ? jsonResponse({ code: "ASSET_NOT_FOUND", message: "Aset tidak ditemukan." }, 404)
        : jsonResponse(DETAIL),
    );
    server.on("DELETE", "/api/assets/peti", () => {
      deleted = true;
      return new Response(null, { status: 204 });
    });
    const { router, user } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    await user.click(screen.getByRole("button", { name: t.assetActions.menu }));
    await user.click(screen.getByRole("menuitem", { name: t.assetActions.delete }));
    const dialog = await screen.findByRole("dialog", { name: t.assetActions.deleteDialog.title });
    expect(dialog.textContent).toContain("“Peti harta kayu” beserta 2 versi");
    await user.click(within(dialog).getByRole("button", { name: t.assetActions.deleteDialog.confirm }));
    expect(await screen.findByText("Daftar Gudang")).toBeDefined();
    expect(router.state.location.search).toBe("?tier=sedang&view=list");
    // Gudang memindah fokus ke kolom cari (elemen asal sudah hilang; fokus tidak jatuh ke `body`).
    expect(router.state.location.state).toEqual(arrivalState("search"));
    expect(screen.queryByRole("heading", { name: t.assetDetail.notFound.title })).toBeNull();
    expect(await screen.findByText(t.assetActions.deleted("Peti harta kayu"))).toBeDefined();
  });

  test("aset dihapus dari tab lain: state “sudah dihapus” tanpa mengambil detail lagi (pasti 404)", async () => {
    const { user } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" });
    server.on("GET", "/api/assets/peti", () =>
      jsonResponse({ code: "ASSET_NOT_FOUND", message: "Aset tidak ditemukan." }, 404),
    );
    act(() => realtime.emit("global", { type: "asset", assetId: "peti", change: "deleted" }));
    expect(await screen.findByRole("heading", { level: 1, name: t.assetDetail.deleted.title })).toBeDefined();
    expect(server.calls("GET", "/api/assets/peti")).toHaveLength(1);
    await user.click(screen.getByRole("link", { name: t.assetDetail.notFound.back }));
    expect(await screen.findByText("Daftar Gudang")).toBeDefined();
  });

  test("aset tidak ada: state “tidak ditemukan” dengan tautan kembali ke Gudang", async () => {
    server.on("GET", "/api/assets/peti", () =>
      jsonResponse({ code: "ASSET_NOT_FOUND", message: "Aset tidak ditemukan." }, 404),
    );
    const { user } = renderPage();
    expect(
      await screen.findByRole("heading", { level: 1, name: t.assetDetail.notFound.title }),
    ).toBeDefined();
    await user.click(screen.getByRole("link", { name: t.assetDetail.notFound.back }));
    expect(await screen.findByText("Daftar Gudang")).toBeDefined();
  });

  test("gagal dimuat: Coba lagi memuat ulang", async () => {
    let fail = true;
    server.on("GET", "/api/assets/peti", () =>
      fail ? jsonResponse({ code: "INTERNAL", message: "Gagal." }, 500) : jsonResponse(DETAIL),
    );
    const { user } = renderPage();
    expect(await screen.findByRole("heading", { name: t.assetDetail.error.title })).toBeDefined();
    fail = false;
    await user.click(screen.getByRole("button", { name: t.assetDetail.error.retry }));
    expect(await screen.findByRole("heading", { level: 1, name: "Peti harta kayu" })).toBeDefined();
    // Placeholder viewer lazy (live region banner status selalu ada, jadi dicari lewat teksnya).
    if (screen.queryByText(t.viewer.loading) !== null)
      await waitForElementToBeRemoved(() => screen.queryByText(t.viewer.loading));
  });
});

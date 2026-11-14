import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, type NavigateFunction, useNavigate } from "react-router";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { useAssets } from "@/lib/assets.ts";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { detailFixture, listFixture, listItemFixture } from "@/test-assets.ts";
import { FakeRealtime } from "@/test-realtime.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { AssetWatcher, statusToasts } from "./AssetWatcher.tsx";
import { useAssetDeleted, useAssetDetail } from "./queries.ts";

describe("toast perubahan aset", () => {
  test("hanya aset lain yang baru masuk review atau selesai; daftar pertama tidak memberi toast", () => {
    const before = new Map([
      ["a", "BASE_WORKING" as const],
      ["b", "TEXTURE_REVIEW" as const],
      ["c", "BASE_WORKING" as const],
      ["d", "BASE_REVIEW" as const],
      ["f", "BASE_REVIEW" as const],
    ]);
    const now = [
      { id: "a", name: "Lentera", status: "BASE_REVIEW" as const },
      { id: "b", name: "Peti", status: "DONE" as const },
      { id: "c", name: "Dibuka", status: "BASE_REVIEW" as const },
      { id: "d", name: "Tetap", status: "BASE_REVIEW" as const },
      { id: "e", name: "Baru", status: "BASE_REVIEW" as const },
      { id: "f", name: "Direvisi", status: "BASE_WORKING" as const },
    ];
    expect(statusToasts(before, now, "c")).toEqual([
      { kind: "review", assetId: "a", name: "Lentera" },
      { kind: "done", assetId: "b", name: "Peti" },
    ]);
    expect(statusToasts(null, now, null)).toEqual([]);
  });
});

let server: FakeServer;
let realtime: FakeRealtime;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  server = new FakeServer();
  realtime = new FakeRealtime();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
});

afterEach(() => {
  restoreFetch();
});

let navigate: NavigateFunction = () => undefined;

function CaptureNavigate() {
  navigate = useNavigate();
  return null;
}

/** Halaman yang sedang menampilkan aset "peti": detail dari cache dan tanda aset sudah dihapus. */
function DetailProbe() {
  const detail = useAssetDetail("peti");
  const deleted = useAssetDeleted("peti");
  return <p>{`${detail.data?.asset.name ?? "-"} · ${deleted ? "dihapus" : "ada"}`}</p>;
}

/** Menampilkan progres build dari daftar aset di cache (client query yang sama dengan penyimak). */
function ProgressProbe() {
  const assets = useAssets();
  const items = assets.data ?? [];
  return (
    <p>
      {items
        .map(
          (asset) =>
            `${asset.id}:${asset.progress === null ? "-" : `${asset.progress.stage} ${asset.progress.pct}`}`,
        )
        .join(",")}
    </p>
  );
}

function renderWatcher(path: string, extra?: ReactNode) {
  renderWithQuery(
    <RealtimeProvider client={realtime}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <CaptureNavigate />
          <AssetWatcher />
          {extra}
          <Toaster />
        </MemoryRouter>
      </TooltipProvider>
    </RealtimeProvider>,
  );
}

const toasts = () => screen.getByRole("region", { name: /Notifikasi/ });

describe("AssetWatcher", () => {
  test("event global memuat ulang daftar; aset lain yang siap review diberi toast, aset yang dibuka tidak", async () => {
    server.on(
      "GET",
      "/api/assets",
      listFixture([
        listItemFixture({ id: "lentera", name: "Lentera besi", status: "BASE_WORKING", runState: "running" }),
        listItemFixture({ id: "peti", name: "Peti harta kayu", status: "TEXTURE_REVIEW" }),
      ]),
    );
    renderWatcher("/studio/peti");
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(1));
    expect(realtime.topics()).toEqual(["global"]);

    server.on(
      "GET",
      "/api/assets",
      listFixture([
        listItemFixture({ id: "lentera", name: "Lentera besi", status: "BASE_REVIEW" }),
        listItemFixture({ id: "peti", name: "Peti harta kayu", status: "DONE" }),
      ]),
    );
    act(() => realtime.emit("global", { type: "asset", assetId: "lentera", change: "updated" }));
    expect(await within(toasts()).findByText("Lentera besi siap direview")).toBeDefined();
    expect(within(toasts()).queryByText("Peti harta kayu selesai")).toBeNull();
    expect(server.calls("GET", "/api/assets")).toHaveLength(2);
  });

  test("toast aset yang lalu dibuka (mis. aset baru selesai dibangun sebelum navigasi) ditutup", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    renderWatcher("/");
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(1));
    server.on(
      "GET",
      "/api/assets",
      listFixture([
        listItemFixture({ id: "peti", name: "Peti kayu", status: "BRIEFING", runState: "running" }),
      ]),
    );
    act(() => realtime.emit("global", { type: "asset", assetId: "peti", change: "created" }));
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(2));
    server.on(
      "GET",
      "/api/assets",
      listFixture([listItemFixture({ id: "peti", name: "Peti kayu", status: "BASE_REVIEW" })]),
    );
    act(() => realtime.emit("global", { type: "asset", assetId: "peti", change: "updated" }));
    expect(await within(toasts()).findByText("Peti kayu siap direview")).toBeDefined();

    act(() => void navigate("/studio/peti"));
    await waitForElementToBeRemoved(() => within(toasts()).queryByText("Peti kayu siap direview"));
  });

  test("progres build dari topik global masuk ke daftar di cache tanpa mengambil ulang", async () => {
    server.on(
      "GET",
      "/api/assets",
      listFixture([
        listItemFixture({ id: "peti", name: "Peti kayu", status: "BASE_WORKING", runState: "running" }),
      ]),
    );
    renderWatcher("/", <ProgressProbe />);
    expect(await screen.findByText("peti:-")).toBeDefined();
    act(() => realtime.emit("global", { type: "asset_progress", assetId: "peti", stage: "base", pct: 40 }));
    expect(await screen.findByText("peti:base 40")).toBeDefined();
    expect(server.calls("GET", "/api/assets")).toHaveLength(1);
  });

  test("langganan global terpasang ulang (sambung ulang) → daftar diambil lagi", async () => {
    server.on("GET", "/api/assets", listFixture([]));
    renderWatcher("/");
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(1));
    act(() => realtime.ready("global"));
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(2));
  });

  test("aset diubah → detailnya diambil ulang; aset dihapus → ditandai dihapus tanpa mengambil detail (404)", async () => {
    server.on("GET", "/api/assets", listFixture([listItemFixture({ id: "peti", name: "Peti harta kayu" })]));
    server.on("GET", "/api/assets/peti", detailFixture());
    renderWatcher("/gudang/peti", <DetailProbe />);
    expect(await screen.findByText("Peti harta kayu · ada")).toBeDefined();
    act(() => realtime.emit("global", { type: "asset", assetId: "peti", change: "updated" }));
    await waitFor(() => expect(server.calls("GET", "/api/assets/peti")).toHaveLength(2));

    server.on("GET", "/api/assets", listFixture([]));
    server.on("GET", "/api/assets/peti", () =>
      jsonResponse({ code: "ASSET_NOT_FOUND", message: "Aset tidak ditemukan." }, 404),
    );
    act(() => realtime.emit("global", { type: "asset", assetId: "peti", change: "deleted" }));
    // Data terakhir tetap ada (halaman yang sedang menghapus membekukan tampilannya); tanda dihapus menyala.
    expect(await screen.findByText("Peti harta kayu · dihapus")).toBeDefined();
    await waitFor(() => expect(server.calls("GET", "/api/assets")).toHaveLength(3));
    expect(server.calls("GET", "/api/assets/peti")).toHaveLength(2);
  });
});

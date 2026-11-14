import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { EXPORT_ZIP_MAX_ASSETS } from "../../../shared/limits.ts";
import { SelectionBar } from "./SelectionBar.tsx";

const { select } = t.gudang;
const PREPARE = "/api/assets/export-zip/prepare";

let server: FakeServer;
let fetchSpy: ReturnType<typeof mockFetch>;
let click: ReturnType<typeof spyOn<HTMLAnchorElement, "click">>;

beforeEach(() => {
  server = new FakeServer();
  fetchSpy = mockFetch(server.fetch);
  // Tautan unduhan sementara tidak benar-benar diikuti di tes.
  click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchSpy.mockRestore();
  click.mockRestore();
});

function renderBar(count: number) {
  const ids = Array.from({ length: count }, (_, index) => `aset-${index}`);
  const view = renderWithQuery(
    <TooltipProvider>
      <SelectionBar selectedIds={ids} onSelectAll={() => undefined} onCancel={() => undefined} />
      <Toaster />
    </TooltipProvider>,
  );
  return { ...view, bar: screen.getByRole("region", { name: select.bar }), user: userEvent.setup() };
}

/** Tautan unduhan yang diklik (dibuat sementara oleh `downloadUrl`). */
function clickedLinks(): HTMLAnchorElement[] {
  return click.mock.contexts.filter((context) => context instanceof HTMLAnchorElement);
}

describe("bar mode pilih", () => {
  test("melebihi batas ZIP: keterangan batas ikut diumumkan, ZIP nonaktif, Pilih semua tetap aktif", () => {
    const { bar } = renderBar(EXPORT_ZIP_MAX_ASSETS + 1);
    expect(within(bar).getByRole("status").textContent).toBe(
      `${select.count("101")}${select.limit(String(EXPORT_ZIP_MAX_ASSETS))}`,
    );
    for (const name of [select.zipWeb, select.zipUnity]) {
      expect(within(bar).getByRole("button", { name }).hasAttribute("disabled")).toBe(true);
    }
    expect(within(bar).getByRole("button", { name: select.all }).hasAttribute("disabled")).toBe(false);
  });

  test("ZIP: server memeriksa aset dulu (tombol memuat), lalu unduhan dimulai lewat tautan", async () => {
    let release: () => void = () => undefined;
    server.on(
      "POST",
      PREPARE,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ assets: 100, bytes: 1000 }));
        }),
    );
    const { bar, user } = renderBar(EXPORT_ZIP_MAX_ASSETS);
    expect(within(bar).getByRole("status").textContent).toBe(select.count("100"));
    const zip = within(bar).getByRole("button", { name: select.zipUnity });
    await user.click(zip);
    await waitFor(() => expect(zip.getAttribute("aria-busy")).toBe("true"));
    expect(clickedLinks()).toEqual([]);
    const [request] = server.calls("POST", PREPARE);
    const body: unknown = await request?.json();
    expect(body).toEqual({
      ids: Array.from({ length: EXPORT_ZIP_MAX_ASSETS }, (_, index) => `aset-${index}`),
      preset: "unity",
    });

    release();
    await waitFor(() => expect(clickedLinks()).toHaveLength(1));
    const [link] = clickedLinks();
    expect(link?.getAttribute("href")?.startsWith("/api/assets/export-zip?ids=aset-0%2Caset-1%2C")).toBe(
      true,
    );
    expect(link?.getAttribute("href")?.endsWith("&preset=unity")).toBe(true);
    expect(link?.hasAttribute("download")).toBe(true);
    await waitFor(() => expect(zip.getAttribute("aria-busy")).toBeNull());
    expect(document.activeElement).toBe(zip);
  });

  test("pemeriksaan gagal: toast berisi pesan server, tidak ada unduhan, tombol bisa dicoba lagi", async () => {
    server.on("POST", PREPARE, () =>
      jsonResponse(
        { code: "EXPORT_FAILED", message: "Ekspor gagal dibuat. Detailnya ada di log server." },
        500,
      ),
    );
    const { bar, user } = renderBar(2);
    const zip = within(bar).getByRole("button", { name: select.zipWeb });
    await user.click(zip);
    expect(await screen.findByText("Ekspor gagal dibuat. Detailnya ada di log server.")).toBeDefined();
    expect(screen.getByText(select.zipFailed)).toBeDefined();
    expect(clickedLinks()).toEqual([]);
    expect(zip.getAttribute("aria-busy")).toBeNull();
  });

  test("bar ditutup saat pemeriksaan berjalan: unduhan tidak dimulai setelahnya", async () => {
    let release: () => void = () => undefined;
    server.on(
      "POST",
      PREPARE,
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(jsonResponse({ assets: 2, bytes: 10 }));
        }),
    );
    const first = renderBar(2);
    await first.user.click(within(first.bar).getByRole("button", { name: select.zipWeb }));
    await waitFor(() => expect(server.calls("POST", PREPARE)).toHaveLength(1));
    first.unmount();
    release();

    // Pembanding: bar baru mengunduh sampai selesai. Pemeriksaan pertama sudah lama selesai saat itu, jadi tautan
    // ZIP Web pasti sudah diklik bila bar yang ditutup masih memulai unduhan.
    server.on("POST", PREPARE, () => jsonResponse({ assets: 3, bytes: 10 }));
    const second = renderBar(3);
    await second.user.click(within(second.bar).getByRole("button", { name: select.zipUnity }));
    await waitFor(() => expect(clickedLinks()).toHaveLength(1));
    expect(clickedLinks()[0]?.getAttribute("href")).toBe(
      "/api/assets/export-zip?ids=aset-0%2Caset-1%2Caset-2&preset=unity",
    );
  });
});

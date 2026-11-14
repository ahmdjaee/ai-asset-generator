import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { detailFixture, versionFixture } from "@/test-assets.ts";
import { FakeServer } from "@/test-server.ts";
import { jsonResponse, mockFetch, renderWithQuery } from "@/test-utils.tsx";
import { type AssetActionTarget, useAssetActions } from "./AssetActions.tsx";

const TARGET: AssetActionTarget = { id: "peti", name: "Peti harta kayu", version: 2, versionCount: 2 };

let server: FakeServer;
let restoreFetch: () => void = () => undefined;

beforeEach(() => {
  server = new FakeServer();
  const spy = mockFetch(server.fetch);
  restoreFetch = () => spy.mockRestore();
  server.on(
    "GET",
    "/api/assets/peti",
    detailFixture({ versions: [versionFixture({ n: 1 }), versionFixture({ n: 2, stage: "textured" })] }),
  );
  server.on("GET", "/api/assets/peti/export/estimate", (request) => {
    const version = Number(new URL(request.url).searchParams.get("version"));
    return jsonResponse({
      version,
      presets: [
        { preset: "web", fileName: `peti-harta-kayu-v${version}-web.glb`, bytes: 612_000, exact: true },
        {
          preset: "unity",
          fileName: `peti-harta-kayu-v${version}-unity.glb`,
          bytes: 2_400_000,
          exact: false,
        },
        {
          preset: "source",
          fileName: `peti-harta-kayu-v${version}-sumber.zip`,
          bytes: 5_100_000,
          exact: false,
        },
      ],
    });
  });
});

afterEach(() => {
  restoreFetch();
});

function Harness() {
  const actions = useAssetActions();
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => actions.run("export", TARGET, opener.current)}>
        Buka ekspor
      </button>
      {actions.dialogs}
    </>
  );
}

function renderHarness() {
  const router = createMemoryRouter([{ path: "/", Component: Harness }], { initialEntries: ["/"] });
  renderWithQuery(
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>,
  );
  return userEvent.setup();
}

const { exportDialog } = t.assetActions;

async function openExport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Buka ekspor" }));
  return screen.findByRole("dialog", { name: exportDialog.title });
}

describe("dialog ekspor", () => {
  test("versi terpilih + ukuran per preset (pasti atau ≈ perkiraan); nama file mengikuti preset dan versi", async () => {
    const user = renderHarness();
    const dialog = await openExport(user);
    expect(
      await within(dialog).findByRole("button", { name: `${exportDialog.version} v2 · Aset final` }),
    ).toBeDefined();
    const web = within(dialog).getByRole("radio", { name: exportDialog.presets.web.title });
    expect(web.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(web.textContent).toContain("612 KB"));
    expect(
      within(dialog).getByRole("radio", { name: exportDialog.presets.unity.title }).textContent,
    ).toContain("≈ 2,4 MB");
    expect(within(dialog).getByText(exportDialog.fileName("peti-harta-kayu-v2-web.glb"))).toBeDefined();

    await user.click(within(dialog).getByRole("radio", { name: exportDialog.presets.source.title }));
    expect(within(dialog).getByText(exportDialog.fileName("peti-harta-kayu-v2-sumber.zip"))).toBeDefined();

    await user.click(within(dialog).getByRole("button", { name: `${exportDialog.version} v2 · Aset final` }));
    const items = screen.getAllByRole("menuitemradio").map((item) => item.textContent);
    expect(items).toEqual(["v2 · Aset final", "v1 · Bentuk dasar"]);
    await user.click(screen.getByRole("menuitemradio", { name: "v1 · Bentuk dasar" }));
    expect(await screen.findByText(exportDialog.fileName("peti-harta-kayu-v1-sumber.zip"))).toBeDefined();
    await waitFor(() =>
      expect(
        server.calls("GET", "/api/assets/peti/export/estimate").map((request) => new URL(request.url).search),
      ).toEqual(["?version=2", "?version=1"]),
    );
  });

  test("Unduh: file preset diminta, disimpan dengan nama ekspor, dialog tertutup dan fokus kembali ke pembuka", async () => {
    server.on("GET", "/api/assets/peti/export", () => new Response(new Uint8Array([1, 2, 3])));
    const created = spyOn(URL, "createObjectURL").mockImplementation(() => "blob:uji");
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      const user = renderHarness();
      const dialog = await openExport(user);
      await user.click(within(dialog).getByRole("radio", { name: exportDialog.presets.unity.title }));
      await user.click(within(dialog).getByRole("button", { name: exportDialog.download }));
      if (screen.queryByRole("dialog") !== null)
        await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
      const [request] = server.calls("GET", "/api/assets/peti/export");
      expect(new URL(request?.url ?? "http://x").search).toBe("?version=2&preset=unity");
      expect(created).toHaveBeenCalledTimes(1);
      const anchor = click.mock.contexts[0];
      expect(anchor instanceof HTMLAnchorElement ? anchor.download : "").toBe("peti-harta-kayu-v2-unity.glb");
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Buka ekspor" })),
      );
    } finally {
      created.mockRestore();
      click.mockRestore();
    }
  });

  test("ditutup saat unduhan disiapkan: permintaan dibatalkan, file tidak disimpan walau respons tiba saat animasi tutup", async () => {
    // Animasi tutup seperti di browser: Radix Presence menahan isi dialog sampai `animationend`, jadi formulirnya
    // belum dilepas saat dialog ditutup.
    const style = document.createElement("style");
    style.textContent = '[role="dialog"][data-state="closed"] { animation-name: keluar; }';
    document.head.append(style);
    const pending: { request: Request; release: () => void }[] = [];
    server.on(
      "GET",
      "/api/assets/peti/export",
      (request) =>
        new Promise<Response>((resolve) => {
          pending.push({ request, release: () => resolve(new Response(new Uint8Array([1, 2, 3]))) });
        }),
    );
    const created = spyOn(URL, "createObjectURL").mockImplementation(() => "blob:uji");
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      const user = renderHarness();
      const dialog = await openExport(user);
      await user.click(within(dialog).getByRole("button", { name: exportDialog.download }));
      await waitFor(() => expect(pending).toHaveLength(1));
      await user.click(within(dialog).getByRole("button", { name: exportDialog.cancel }));
      expect([dialog.isConnected, dialog.getAttribute("data-state")]).toEqual([true, "closed"]);
      expect(pending[0]?.request.signal.aborted).toBe(true);
      const busy = () =>
        within(dialog).getByRole("button", { name: exportDialog.download }).getAttribute("aria-busy");
      expect(busy()).toBe("true");
      pending[0]?.release();
      await waitFor(() => expect(busy()).toBeNull());
      act(() => {
        dialog.dispatchEvent(new AnimationEvent("animationend", { animationName: "keluar" }));
      });
      expect(dialog.isConnected).toBe(false);

      // Pembanding: unduhan kedua sampai selesai. Respons pertama sudah lama tiba saat itu, jadi file pertama pasti
      // sudah disimpan bila pembatalannya bocor.
      const again = await openExport(user);
      await user.click(within(again).getByRole("button", { name: exportDialog.download }));
      await waitFor(() => expect(pending).toHaveLength(2));
      pending[1]?.release();
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      expect(created).toHaveBeenCalledTimes(1);
    } finally {
      style.remove();
      created.mockRestore();
      click.mockRestore();
    }
  });

  test("setelah unduhan, dialog yang dibuka lagi memuat ulang ukuran (file ekspor kini ada, ukurannya pasti)", async () => {
    let created = false;
    server.on("GET", "/api/assets/peti/export", () => {
      created = true;
      return new Response(new Uint8Array([1, 2, 3]));
    });
    server.on("GET", "/api/assets/peti/export/estimate", () =>
      jsonResponse({
        version: 2,
        presets: [
          { preset: "web", fileName: "peti-harta-kayu-v2-web.glb", bytes: 612_000, exact: true },
          {
            preset: "unity",
            fileName: "peti-harta-kayu-v2-unity.glb",
            bytes: created ? 2_300_000 : 2_400_000,
            exact: created,
          },
          { preset: "source", fileName: "peti-harta-kayu-v2-sumber.zip", bytes: 5_100_000, exact: false },
        ],
      }),
    );
    const objectUrl = spyOn(URL, "createObjectURL").mockImplementation(() => "blob:uji");
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      const user = renderHarness();
      let dialog = await openExport(user);
      const unity = () => within(dialog).getByRole("radio", { name: exportDialog.presets.unity.title });
      await waitFor(() => expect(unity().textContent).toContain("≈ 2,4 MB"));
      await user.click(unity());
      await user.click(within(dialog).getByRole("button", { name: exportDialog.download }));
      if (screen.queryByRole("dialog") !== null)
        await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
      dialog = await openExport(user);
      await waitFor(() => expect(unity().textContent).toContain("2,3 MB"));
      expect(unity().textContent).not.toContain("≈");
    } finally {
      objectUrl.mockRestore();
      click.mockRestore();
    }
  });

  test("ekspor gagal: toast berisi pesan server, dialog tetap terbuka untuk dicoba lagi", async () => {
    server.on("GET", "/api/assets/peti/export", () =>
      jsonResponse({ code: "EXPORT_FAILED", message: "Validator menemukan 2 error." }, 500),
    );
    const user = renderHarness();
    const dialog = await openExport(user);
    await user.click(within(dialog).getByRole("button", { name: exportDialog.download }));
    expect(await screen.findByText("Validator menemukan 2 error.")).toBeDefined();
    expect(screen.getByText(exportDialog.failed)).toBeDefined();
    expect(screen.getByRole("dialog", { name: exportDialog.title })).toBeDefined();
    const download = within(dialog).getByRole("button", { name: exportDialog.download });
    expect(download.getAttribute("aria-busy")).toBeNull();
  });
});

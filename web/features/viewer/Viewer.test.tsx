import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import type { DetailPanelData } from "./DetailPanel.tsx";
import { LazyViewer } from "./LazyViewer.tsx";
import { Viewer } from "./Viewer.tsx";

const v = t.viewer;

const DETAIL: DetailPanelData = {
  tier: "sedang",
  meters: [],
  rows: [],
  versions: [{ version: 1, title: "v1 · Bentuk dasar", meta: "2 mnt lalu" }],
  version: 1,
  onVersionChange: () => undefined,
  validation: { errors: 0, warnings: 0 },
};

const region = () => screen.getByRole("region", { name: v.region });
const button = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => button(name).getAttribute("aria-pressed");
const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked");

/** Elemen di luar pohon React (mis. rel app) yang ditempel ke body; dibuang setelah tiap tes. */
const outside: HTMLElement[] = [];
afterEach(() => {
  for (const element of outside.splice(0)) element.remove();
});

function outsideLink(): HTMLElement {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Rel");
  nav.innerHTML = '<a href="/gudang">Gudang</a>';
  document.body.prepend(nav);
  outside.push(nav);
  return nav;
}

/** Provider tetap sama di setiap `rerender`, supaya Viewer tidak dipasang ulang (lihat AGENTS.md §13). */
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

// happy-dom tidak punya WebGL2 dan Fullscreen API: jalur "WebGL tidak tersedia" dan layar penuh lewat CSS.
describe("Viewer tanpa WebGL", () => {
  test("pesan WebGL tidak tersedia; tanpa kanvas dan gizmo; toolbar dan petunjuk tetap ada", () => {
    renderUi(<Viewer src="/model.glb" name="Peti" />);
    expect(within(region()).getByRole("heading", { name: v.noWebgl.title })).toBeDefined();
    expect(screen.queryByRole("application")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: v.gizmo.label })).toBeNull();
    expect(screen.getByRole("group", { name: v.toolbar })).toBeDefined();
    expect(screen.getByText(v.hint)).toBeDefined();
    expect(within(region()).getByRole("status").textContent).toBe(v.noWebgl.title);
  });

  test("bawaan per tahap: bentuk dasar = Clay + wireframe, aset final = Tekstur tanpa wireframe", () => {
    const base = renderUi(<Viewer src="/dasar.glb" name="Peti" stage="base" />);
    expect(screen.getByRole("radio", { name: v.modes.clay }).getAttribute("aria-checked")).toBe("true");
    expect(pressed(v.wireframe)).toBe("true");
    base.unmount();
    renderUi(<Viewer src="/final.glb" name="Peti" stage="final" />);
    expect(screen.getByRole("radio", { name: v.modes.texture }).getAttribute("aria-checked")).toBe("true");
    expect(pressed(v.wireframe)).toBe("false");
  });

  test("ganti tahap tanpa dipasang ulang (mis. versi final datang): mode dan wireframe ikut bawaan tahap baru", async () => {
    const user = userEvent.setup();
    const view = render(
      <Providers>
        <Viewer src="/dasar.glb" name="Peti" stage="base" />
      </Providers>,
    );
    const toolbar = screen.getByRole("group", { name: v.toolbar });
    await user.click(button(v.grid));
    view.rerender(
      <Providers>
        <Viewer src="/final.glb" name="Peti" stage="final" />
      </Providers>,
    );
    expect(screen.getByRole("group", { name: v.toolbar })).toBe(toolbar);
    expect(checked(v.modes.texture)).toBe("true");
    expect(pressed(v.wireframe)).toBe("false");
    // Pilihan lain milik pemilik tetap.
    expect(pressed(v.grid)).toBe("false");
    view.rerender(
      <Providers>
        <Viewer src="/dasar.glb" name="Peti" stage="base" />
      </Providers>,
    );
    expect(checked(v.modes.clay)).toBe("true");
    expect(pressed(v.wireframe)).toBe("true");
  });

  test("pintasan W, G, L hanya saat fokus di dalam viewer (WCAG 2.1.4); diabaikan saat mengetik", async () => {
    const { user } = renderUi(
      <>
        <label>
          Catatan
          <input />
        </label>
        <Viewer src="/model.glb" name="Peti" />
      </>,
    );
    const link = within(outsideLink()).getByRole("link", { name: "Gudang" });
    // Fokus lewat skrip membuka tooltip (state Radix), jadi dibungkus act.
    act(() => link.focus());
    await user.keyboard("wgl");
    expect([pressed(v.wireframe), pressed(v.grid), pressed(v.light)]).toEqual(["true", "true", "false"]);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard("w");
    expect(pressed(v.wireframe)).toBe("true");

    act(() => button(v.focus).focus());
    await user.keyboard("wgl");
    expect([pressed(v.wireframe), pressed(v.grid), pressed(v.light)]).toEqual(["false", "false", "true"]);
    await user.click(screen.getByRole("textbox", { name: "Catatan" }));
    await user.keyboard("w");
    expect(pressed(v.wireframe)).toBe("false");
  });

  test("layar penuh lewat CSS bila Fullscreen API tidak ada: sisa halaman inert, fokus tetap; Escape keluar", async () => {
    const rail = outsideLink();
    const { user } = renderUi(<Viewer src="/model.glb" name="Peti" />);
    await user.click(button(v.fullscreen));
    expect(region().className).toContain("fixed");
    expect(document.activeElement).toBe(button(v.exitFullscreen));
    expect(rail.closest("[inert]")).not.toBeNull();
    expect(region().closest("[inert]")).toBeNull();
    await user.keyboard("{Escape}");
    expect(region().className).not.toContain("fixed");
    expect(button(v.fullscreen)).toBeDefined();
    expect(rail.closest("[inert]")).toBeNull();
  });

  test("Fullscreen API: keluar sekali saat Escape; viewer dilepas saat layar penuh → halaman dipulihkan dan layar penuh ditutup", async () => {
    const root = document.documentElement;
    let current: Element | null = null;
    const request = mock(async () => {
      current = root;
    });
    const exit = mock(async () => {
      current = null;
    });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => current });
    Object.assign(root, { requestFullscreen: request });
    Object.assign(document, { exitFullscreen: exit });
    try {
      const rail = outsideLink();
      const view = renderUi(<Viewer src="/model.glb" name="Peti" />);
      await view.user.click(button(v.fullscreen));
      expect(request).toHaveBeenCalledTimes(1);
      await view.user.keyboard("{Escape}");
      expect(exit).toHaveBeenCalledTimes(1);

      await view.user.click(button(v.fullscreen));
      expect(rail.closest("[inert]")).not.toBeNull();
      view.unmount();
      expect(exit).toHaveBeenCalledTimes(2);
      expect(rail.closest("[inert]")).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "fullscreenElement");
      Reflect.deleteProperty(root, "requestFullscreen");
      Reflect.deleteProperty(document, "exitFullscreen");
    }
  });

  test("panel Detail bisa ditutup dan dibuka lagi; fokus pindah ke tombol pasangannya", async () => {
    const { user } = renderUi(<Viewer src="/model.glb" name="Peti" detail={DETAIL} />);
    button(t.detailPanel.collapse).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("region", { name: t.detailPanel.title })).toBeNull();
    expect(document.activeElement).toBe(button(t.detailPanel.expand));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: t.detailPanel.title })).toBeDefined();
    expect(document.activeElement).toBe(button(t.detailPanel.collapse));
  });

  test("panel ditutup saat fokus di luar panel (klik Safari tidak memfokus tombol): fokus tidak dipindah", () => {
    renderUi(<Viewer src="/model.glb" name="Peti" detail={DETAIL} />);
    const link = within(outsideLink()).getByRole("link", { name: "Gudang" });
    link.focus();
    fireEvent.click(button(t.detailPanel.collapse));
    expect(button(t.detailPanel.expand)).toBeDefined();
    expect(document.activeElement).toBe(link);
  });

  test("LazyViewer: status memuat selama chunk dimuat, lalu viewer", async () => {
    renderUi(<LazyViewer src="/model.glb" name="Peti" />);
    expect(screen.getByRole("status").textContent).toBe(v.loading);
    expect(await screen.findByRole("region", { name: v.region })).toBeDefined();
  });
});

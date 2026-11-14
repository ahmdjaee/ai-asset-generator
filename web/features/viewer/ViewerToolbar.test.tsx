import { describe, expect, mock, test } from "bun:test";
import { screen } from "@testing-library/react";
import { t } from "@/i18n/id.ts";
import { renderUi } from "@/test-utils.tsx";
import type { PresetId } from "./math.ts";
import type { ViewerSettings } from "./ViewerScene.tsx";
import { type ToolbarAvailability, ViewerToolbar } from "./ViewerToolbar.tsx";

const v = t.viewer;

const SETTINGS: ViewerSettings = {
  mode: "clay",
  wireframe: true,
  grid: true,
  lightFollowsCamera: false,
  autoRotate: false,
};

function renderToolbar({
  availability = { texture: false, uv: true, reducedMotion: false },
  fullscreen = false,
  current = "front",
}: {
  availability?: ToolbarAvailability;
  fullscreen?: boolean;
  current?: PresetId | null;
} = {}) {
  const handlers = {
    onSettingsChange: mock((_patch: Partial<ViewerSettings>) => undefined),
    onPreset: mock((_preset: PresetId) => undefined),
    onFocus: mock(() => undefined),
    onCapture: mock(() => undefined),
    onFullscreen: mock(() => undefined),
  };
  const view = renderUi(
    <ViewerToolbar
      settings={SETTINGS}
      availability={availability}
      fullscreen={fullscreen}
      currentPreset={() => current}
      {...handlers}
    />,
  );
  return { ...view, ...handlers };
}

const radio = (name: string) => screen.getByRole<HTMLButtonElement>("radio", { name });
const button = (name: string) => screen.getByRole("button", { name });

describe("ViewerToolbar", () => {
  test("satu grup berlabel; mode yang tidak didukung model nonaktif; memilih mode memanggil onSettingsChange", async () => {
    const { user, onSettingsChange } = renderToolbar();
    expect(screen.getByRole("group", { name: v.toolbar })).toBeDefined();
    expect(radio(v.modes.texture).disabled).toBe(true);
    expect(radio(v.modes.uv).disabled).toBe(false);
    expect(radio(v.modes.clay).getAttribute("aria-checked")).toBe("true");
    await user.click(radio(v.modes.normal));
    expect(onSettingsChange).toHaveBeenCalledWith({ mode: "normal" });
  });

  test("tanpa UV: mode UV nonaktif; dengan material: Tekstur aktif", () => {
    renderToolbar({ availability: { texture: true, uv: false, reducedMotion: false } });
    expect(radio(v.modes.texture).disabled).toBe(false);
    expect(radio(v.modes.uv).disabled).toBe(true);
  });

  test("W, G, L: aria-pressed mengikuti setelan, klik membalik nilainya", async () => {
    const { user, onSettingsChange } = renderToolbar();
    expect(button(v.wireframe).getAttribute("aria-pressed")).toBe("true");
    expect(button(v.grid).getAttribute("aria-pressed")).toBe("true");
    expect(button(v.light).getAttribute("aria-pressed")).toBe("false");
    await user.click(button(v.wireframe));
    await user.click(button(v.grid));
    await user.click(button(v.light));
    expect(onSettingsChange.mock.calls).toEqual([
      [{ wireframe: false }],
      [{ grid: false }],
      [{ lightFollowsCamera: true }],
    ]);
  });

  test("putar otomatis menyala lewat klik", async () => {
    const { user, onSettingsChange } = renderToolbar();
    await user.click(button(v.autoRotate));
    expect(onSettingsChange).toHaveBeenCalledWith({ autoRotate: true });
  });

  test("animasi dikurangi: putar otomatis menyebut alasannya, aria-disabled, klik diabaikan", async () => {
    const { user, onSettingsChange } = renderToolbar({
      availability: { texture: false, uv: true, reducedMotion: true },
    });
    const spin = button(v.autoRotateReduced);
    expect(spin.getAttribute("aria-disabled")).toBe("true");
    await user.click(spin);
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  test("menu Sudut menandai sudut kamera sekarang; memilih sudut memanggil onPreset", async () => {
    const { user, onPreset } = renderToolbar({ current: "front" });
    await user.click(button(v.angle.tooltip));
    const front = await screen.findByRole("menuitemradio", { name: v.angle.presets.front });
    expect(front.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("menuitemradio", { name: `${v.angle.presets.iso} ${v.angle.defaultHint}` }),
    ).toBeDefined();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
    await user.click(screen.getByRole("menuitemradio", { name: v.angle.presets.top }));
    expect(onPreset).toHaveBeenCalledWith("top");
  });

  test("ikon Sudut sama dengan Icon/axis-3d FigCraft: siku sumbu + satu diagonal utuh", () => {
    renderToolbar();
    const paths = button(v.angle.tooltip).querySelectorAll("svg")[0]?.querySelectorAll("path") ?? [];
    expect(Array.from(paths, (path) => path.getAttribute("d"))).toEqual(["M4 4v16h16", "m4 20 7-7"]);
  });

  test("sudut di luar sudut cepat: tidak ada pilihan yang ditandai", async () => {
    const { user } = renderToolbar({ current: null });
    await user.click(button(v.angle.tooltip));
    await screen.findByRole("menu");
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(0);
  });

  test("Fokus, Ambil gambar, Layar penuh memanggil handler masing-masing", async () => {
    const { user, onFocus, onCapture, onFullscreen } = renderToolbar();
    await user.click(button(v.focus));
    await user.click(button(v.capture));
    await user.click(button(v.fullscreen));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onFullscreen).toHaveBeenCalledTimes(1);
  });

  test("saat layar penuh tombolnya menjadi Keluar dari layar penuh", () => {
    renderToolbar({ fullscreen: true });
    expect(button(v.exitFullscreen)).toBeDefined();
    expect(screen.queryByRole("button", { name: v.fullscreen })).toBeNull();
  });
});

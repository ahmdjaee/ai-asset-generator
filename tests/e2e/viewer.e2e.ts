import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import {
  angleDistance,
  KEYBOARD_DOLLY_FACTOR,
  KEYBOARD_ROTATE_STEP,
  PRESET_IDS,
  PRESETS,
  type PresetId,
  shortestAzimuth,
} from "../../web/features/viewer/math.ts";
import type { ViewerProbeSnapshot } from "../../web/features/viewer/test-hook.ts";
import { t, tSmoke } from "../../web/i18n/id.ts";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  compareGolden,
  decodePng,
  diffRatio,
  GOLDEN_MAX_DIFF_RATIO,
  type GoldenSuite,
} from "../pipeline/golden.ts";
import {
  collectConsoleProblems,
  collectExternalRequests,
  contrastRatio,
  focusRingProblems,
  saveScreenshot,
  seriousA11yViolations,
  tokenRgb,
} from "./helpers.ts";

/** Rel 64 px + area viewport desain (FigCraft #1151, 976×848). */
const VIEWPORT = { width: 1040, height: 848 };
const RAIL = 64;
const VIEWER_GOLDENS: GoldenSuite = {
  dir: "viewer",
  updateCommand: "bunx playwright test tests/e2e/viewer.e2e.ts",
};
const v = t.viewer;

type Theme = "dark" | "light";

async function openViewer(page: Page, query = "", theme: Theme = "dark"): Promise<void> {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, value), {
    key: THEME_STORAGE_KEY,
    value: theme,
  });
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/_viewer${query}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await waitIdle(page);
}

function snapshot(page: Page): Promise<ViewerProbeSnapshot> {
  return page.evaluate(() => {
    const probe = window.__viewer;
    if (!probe) throw new Error("window.__viewer belum terpasang");
    return probe.snapshot();
  });
}

/** Menunggu model siap dan kamera berhenti (sinyal dari test hook, bukan sleep). */
async function waitIdle(page: Page): Promise<ViewerProbeSnapshot> {
  await page.waitForFunction(() => {
    const state = window.__viewer?.snapshot();
    return state?.ready === true && !state.moving;
  });
  return snapshot(page);
}

const angleTrigger = (page: Page) => page.getByRole("button", { name: v.angle.tooltip });

/**
 * Menu tertutup penuh: Radix mengembalikan fokus ke pemicu lewat `setTimeout`. Membuka menu lagi sebelum itu membuat
 * fokus yang tertunda menarik fokus keluar dari menu baru, dan menu langsung tertutup.
 */
async function expectMenuClosed(page: Page): Promise<void> {
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(angleTrigger(page)).toBeFocused();
}

async function choosePreset(page: Page, preset: PresetId): Promise<ViewerProbeSnapshot> {
  await angleTrigger(page).click();
  await page.getByRole("menuitemradio", { name: v.angle.presets[preset] }).click();
  await expectMenuClosed(page);
  return waitIdle(page);
}

function expectAngles(state: ViewerProbeSnapshot, preset: PresetId): void {
  const expected = PRESETS[preset];
  expect(angleDistance(state.azimuth, expected.azimuth)).toBeLessThan(1e-3);
  expect(Math.abs(state.polar - expected.polar)).toBeLessThan(1e-3);
  expect(state.preset).toBe(preset);
}

const canvasArea = (page: Page) => page.getByRole("application", { name: v.canvas("Peti harta kayu") });
const viewerStatus = (page: Page) => page.getByRole("region", { name: v.region }).getByRole("status");

/** Menjalankan `action` lalu menunggu minimal satu frame baru dan kamera diam (perubahan sudah tergambar). */
async function afterFrame(page: Page, action: () => Promise<void>): Promise<ViewerProbeSnapshot> {
  const before = (await snapshot(page)).frames;
  await action();
  await expect.poll(async () => (await snapshot(page)).frames).toBeGreaterThan(before);
  return waitIdle(page);
}

/** Menahan unduhan GLB sampai fungsi yang dikembalikan dipanggil: state memuat bisa diperiksa tanpa sleep. */
async function holdModelRequests(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*.glb", async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** Potongan area model (kiri tengah viewer, tidak tertutup toolbar, panel, dan gizmo). */
async function modelPixels(page: Page) {
  return decodePng(await page.screenshot({ clip: { x: RAIL + 120, y: 140, width: 480, height: 520 } }));
}

async function capturePng(page: Page): Promise<Buffer> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: v.capture }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("peti-harta-kayu.png");
  const path = await file.path();
  return readFile(path);
}

test.describe("viewer 3D", () => {
  test("sudut cepat lewat menu Sudut tepat ±1e-3; Bawah menyembunyikan lantai", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const external = collectExternalRequests(page);
    await openViewer(page);
    expectAngles(await snapshot(page), "iso");
    for (const preset of PRESET_IDS) {
      const state = await choosePreset(page, preset);
      expectAngles(state, preset);
      expect(state.floorVisible).toBe(preset !== "bottom");
      expect(state.gridVisible).toBe(preset !== "bottom");
      // Menu menandai sudut yang sedang dipakai.
      await angleTrigger(page).click();
      await expect(page.getByRole("menuitemradio", { name: v.angle.presets[preset] })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await page.keyboard.press("Escape");
      await expectMenuClosed(page);
    }
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
  });

  test("menu Sudut terbuka: pemicunya tampil terbuka (bg/hover, text/primary) walau kursor di item menu", async ({
    page,
  }) => {
    await openViewer(page);
    const rgb = async (token: string) => `rgb(${(await tokenRgb(page, token)).join(", ")})`;
    await angleTrigger(page).click();
    // State desain #1151: kursor di item Bawah, jadi gaya hover pemicu tidak ikut berlaku.
    await page.getByRole("menuitemradio", { name: v.angle.presets.bottom }).hover();
    await expect(angleTrigger(page)).toHaveCSS("background-color", await rgb("--color-bg-hover"));
    await expect(angleTrigger(page)).toHaveCSS("color", await rgb("--color-text-primary"));
  });

  test("gizmo: klik dan keyboard membuka sudut sumbu; satu pemberhentian Tab, panah berpindah", async ({
    page,
  }) => {
    await openViewer(page);
    await page.getByRole("button", { name: v.gizmo.axes.py }).click();
    expectAngles(await waitIdle(page), "top");
    await page.getByRole("button", { name: v.gizmo.axes.pz }).click();
    expectAngles(await waitIdle(page), "front");

    const gizmo = page.getByRole("toolbar", { name: v.gizmo.label });
    await gizmo.getByRole("button", { name: v.gizmo.axes.px }).focus();
    // Roving focus Radix memindah fokus lewat setTimeout: tunggu tiap pindah sebelum menekan panah berikutnya.
    for (const next of ["py", "pz", "nx"] as const) {
      await page.keyboard.press("ArrowRight");
      await expect(gizmo.getByRole("button", { name: v.gizmo.axes[next] })).toBeFocused();
    }
    await page.keyboard.press("Enter");
    expectAngles(await waitIdle(page), "left");
    // Roving tabindex: hanya satu bulatan yang bisa dicapai dengan Tab.
    await expect(gizmo.locator('button[tabindex="0"]')).toHaveCount(1);
  });

  test("F membingkai ulang model setelah zoom (±2%); panah, Shift + panah, dan +/− di kanvas", async ({
    page,
  }) => {
    await openViewer(page);
    const canvas = canvasArea(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error("kanvas tidak terlihat");
    const start = await snapshot(page);
    await page.mouse.move(box.x + 300, box.y + 400);
    await page.mouse.wheel(0, -800);
    // Roda diproses di frame berikutnya; tunggu jaraknya berubah dulu, baru tunggu kamera diam.
    await expect.poll(async () => (await snapshot(page)).distance).toBeLessThan(start.distance * 0.99);
    const zoomed = await waitIdle(page);
    expect(zoomed.distance).toBeLessThan(zoomed.fitDistance * 0.9);
    await canvas.focus();
    await page.keyboard.press("f");
    const framed = await waitIdle(page);
    expect(Math.abs(framed.distance - framed.fitDistance) / framed.fitDistance).toBeLessThan(0.02);

    await page.keyboard.press("ArrowLeft");
    const left = await waitIdle(page);
    expect(angleDistance(left.azimuth, framed.azimuth + KEYBOARD_ROTATE_STEP)).toBeLessThan(1e-3);
    await page.keyboard.press("ArrowUp");
    const up = await waitIdle(page);
    expect(up.polar - left.polar).toBeCloseTo(KEYBOARD_ROTATE_STEP, 3);
    await page.keyboard.press("+");
    const closer = await waitIdle(page);
    expect(closer.distance / up.distance).toBeCloseTo(1 - KEYBOARD_DOLLY_FACTOR, 3);
    await page.keyboard.press("-");
    const farther = await waitIdle(page);
    expect(farther.distance / closer.distance).toBeCloseTo(1 + KEYBOARD_DOLLY_FACTOR, 3);

    // Shift + panah menggeser model ke arah panah (sama dengan Shift + seret), tanpa memutar.
    await page.keyboard.press("Shift+ArrowLeft");
    const panLeft = await waitIdle(page);
    expect(panLeft.centerOnScreen[0]).toBeLessThan(farther.centerOnScreen[0] - 5);
    expect(Math.abs(panLeft.centerOnScreen[1] - farther.centerOnScreen[1])).toBeLessThan(1);
    expect(panLeft.azimuth).toBeCloseTo(farther.azimuth, 6);
    await page.keyboard.press("Shift+ArrowUp");
    const panUp = await waitIdle(page);
    expect(panUp.centerOnScreen[1]).toBeLessThan(panLeft.centerOnScreen[1] - 5);
    expect(Math.abs(panUp.centerOnScreen[0] - panLeft.centerOnScreen[0])).toBeLessThan(1);
    expect(panUp.polar).toBeCloseTo(panLeft.polar, 6);
  });

  test("Ctrl/Alt/Meta + tombol di kanvas milik browser (zoom halaman, kembali): tidak ditangkap", async ({
    page,
  }) => {
    await openViewer(page);
    const before = await snapshot(page);
    const prevented = await canvasArea(page).evaluate((element) =>
      [
        { key: "-", ctrlKey: true },
        { key: "=", ctrlKey: true },
        { key: "+", metaKey: true },
        { key: "ArrowLeft", altKey: true },
      ].map((init) => {
        const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(prevented).toEqual([false, false, false, false]);
    const after = await snapshot(page);
    expect(after.frames).toBe(before.frames);
    expect(after.distance).toBe(before.distance);
  });

  test("pintasan huruf hanya saat fokus di dalam viewer (WCAG 2.1.4); klik kanvas memfokusnya", async ({
    page,
  }) => {
    await openViewer(page);
    const wire = page.getByRole("button", { name: v.wireframe });
    await expect(wire).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("navigation", { name: t.nav.label }).getByRole("link").first().focus();
    await page.keyboard.press("w");
    await expect(wire).toHaveAttribute("aria-pressed", "true");
    expect((await snapshot(page)).wireframe).toBe(true);
    await canvasArea(page).click();
    await expect(canvasArea(page)).toBeFocused();
    await page.keyboard.press("w");
    await expect(wire).toHaveAttribute("aria-pressed", "false");
  });

  test("R menyalakan dan mematikan putar otomatis; menyeret menghentikannya", async ({ page }) => {
    await openViewer(page);
    const spin = page.getByRole("button", { name: v.autoRotate });
    await expect(spin).toHaveAttribute("aria-pressed", "false");
    const start = await snapshot(page);
    await canvasArea(page).focus();
    await page.keyboard.press("r");
    await expect(spin).toHaveAttribute("aria-pressed", "true");
    // Searah prototipe (OrbitControls.autoRotate): azimuth berkurang.
    await expect
      .poll(async () => shortestAzimuth(start.azimuth, (await snapshot(page)).azimuth) - start.azimuth)
      .toBeLessThan(-0.05);
    await page.keyboard.press("r");
    await expect(spin).toHaveAttribute("aria-pressed", "false");
    const stopped = await waitIdle(page);
    expect(stopped.autoRotate).toBe(false);

    await spin.click();
    await expect(spin).toHaveAttribute("aria-pressed", "true");
    const box = await canvasArea(page).boundingBox();
    if (!box) throw new Error("kanvas tidak terlihat");
    await page.mouse.move(box.x + 300, box.y + 420);
    await page.mouse.down();
    await page.mouse.move(box.x + 340, box.y + 420, { steps: 4 });
    await page.mouse.up();
    await expect(spin).toHaveAttribute("aria-pressed", "false");
    expect((await waitIdle(page)).autoRotate).toBe(false);
  });

  test("animasi dikurangi: putar otomatis tidak tersedia, transisi sudut instan", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openViewer(page);
    const spin = page.getByRole("button", { name: v.autoRotateReduced });
    await expect(spin).toBeDisabled();
    await canvasArea(page).focus();
    await page.keyboard.press("r");
    // Tetap bisa difokus dan diklik (aria-disabled, supaya alasannya terbaca), tetapi tidak berbuat apa-apa.
    await spin.click({ force: true });
    // Setelan tersembunyi pun tidak berubah: setelah sistem mengizinkan animasi lagi, viewer tetap diam.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.getByRole("button", { name: v.autoRotate })).toHaveAttribute("aria-pressed", "false");
    expect((await snapshot(page)).autoRotate).toBe(false);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(spin).toBeDisabled();
    const before = await snapshot(page);
    const after = await choosePreset(page, "back");
    expectAngles(after, "back");
    // Tanpa transisi: kamera langsung di tujuan, hanya beberapa frame (pindah + tidur).
    expect(after.frames - before.frames).toBeLessThanOrEqual(4);
  });

  test("W, Grid, dan mode tampilan mengubah gambar; Tekstur nonaktif untuk bentuk dasar", async ({
    page,
  }) => {
    await openViewer(page, "?model=peti&final=1");
    const modes = page.getByRole("radiogroup", { name: v.modes.label });
    await expect(modes.getByRole("radio", { name: v.modes.texture })).toHaveAttribute("aria-checked", "true");
    const shots = new Map<string, Awaited<ReturnType<typeof modelPixels>>>();
    shots.set("texture", await modelPixels(page));
    for (const mode of ["clay", "uv", "normal"] as const) {
      await modes.getByRole("radio", { name: v.modes[mode] }).click();
      expect((await waitIdle(page)).mode).toBe(mode);
      shots.set(mode, await modelPixels(page));
    }
    const names = [...shots.keys()];
    for (const [index, a] of names.entries()) {
      for (const b of names.slice(index + 1)) {
        const first = shots.get(a);
        const second = shots.get(b);
        if (!first || !second) throw new Error("tangkapan hilang");
        expect(diffRatio(first, second), `${a} vs ${b}`).toBeGreaterThan(0.05);
      }
    }

    const beforeWire = await modelPixels(page);
    await page.keyboard.press("w");
    await expect(page.getByRole("button", { name: v.wireframe })).toHaveAttribute("aria-pressed", "true");
    expect((await waitIdle(page)).wireframe).toBe(true);
    expect(diffRatio(beforeWire, await modelPixels(page))).toBeGreaterThan(0.02);

    await page.keyboard.press("g");
    await expect(page.getByRole("button", { name: v.grid })).toHaveAttribute("aria-pressed", "false");
    const hidden = await waitIdle(page);
    expect(hidden.gridVisible).toBe(false);
    expect(hidden.floorVisible).toBe(true);

    // Ganti ke versi bentuk dasar: Tekstur nonaktif (GLB tanpa material); mode dan wireframe kembali ke bawaan bentuk
    // dasar (Clay + wireframe), sedangkan grid tetap pilihan pemilik.
    await page.getByRole("radio", { name: /v1 · Bentuk dasar/ }).click();
    await expect(modes.getByRole("radio", { name: v.modes.texture })).toBeDisabled();
    await expect(modes.getByRole("radio", { name: v.modes.clay })).toHaveAttribute("aria-checked", "true");
    const base = await waitIdle(page);
    expect([base.mode, base.wireframe, base.grid]).toEqual(["clay", true, false]);
    await expect(page.getByRole("button", { name: v.light })).toHaveAttribute("aria-pressed", "false");
  });

  test("W dan ganti mode berulang tidak menimbun objek GPU", async ({ page }) => {
    await openViewer(page, "?model=peti&final=1");
    const modes = page.getByRole("radiogroup", { name: v.modes.label });
    const wire = page.getByRole("button", { name: v.wireframe });
    const cycle = async () => {
      for (const mode of ["clay", "uv", "normal", "texture"] as const) {
        const state = await afterFrame(page, () => modes.getByRole("radio", { name: v.modes[mode] }).click());
        expect(state.mode).toBe(mode);
      }
      for (const on of [true, false]) {
        expect((await afterFrame(page, () => wire.click())).wireframe).toBe(on);
      }
    };
    // Putaran pertama membuat material, pola kotak UV, dan program shader tiap mode sekali.
    await cycle();
    const warm = (await snapshot(page)).memory;
    await cycle();
    await cycle();
    expect((await snapshot(page)).memory).toEqual(warm);
  });

  test("L: cahaya utama ikut kamera", async ({ page }) => {
    await openViewer(page, "?panel=0");
    const fixed = await choosePreset(page, "front");
    await page.keyboard.press("l");
    await expect(page.getByRole("button", { name: v.light })).toHaveAttribute("aria-pressed", "true");
    const following = await choosePreset(page, "back");
    // Dari belakang, lampu ikut pindah ke sisi belakang model (z negatif); lampu tetap ada di depan (z positif).
    expect(fixed.keyLight[2]).toBeGreaterThan(0);
    expect(following.keyLight[2]).toBeLessThan(0);
  });

  test("diam = 0 frame selama 10 detik (jam palsu)", async ({ page }) => {
    await page.clock.install();
    await openViewer(page);
    await page.clock.pauseAt(Date.now() + 60_000);
    const before = await snapshot(page);
    await page.clock.runFor(10_000);
    const after = await snapshot(page);
    expect(after.frames).toBe(before.frames);
    expect(after.moving).toBe(false);
  });

  test("panel Detail: model di tengah area kiri panel; panel bisa ditutup dan dibuka", async ({ page }) => {
    await openViewer(page);
    const free = VIEWPORT.width - RAIL - (16 + 280 + 0);
    const withPanel = await snapshot(page);
    expect(Math.abs(withPanel.centerOnScreen[0] - free / 2)).toBeLessThan(2);
    await page.getByRole("button", { name: t.detailPanel.collapse }).click();
    await expect(page.getByRole("button", { name: t.detailPanel.expand })).toBeVisible();
    await expect
      .poll(async () => (await snapshot(page)).centerOnScreen[0])
      .toBeCloseTo((VIEWPORT.width - RAIL) / 2, 0);
    await page.getByRole("button", { name: t.detailPanel.expand }).click();
    await expect(page.getByRole("region", { name: t.detailPanel.title })).toBeVisible();
  });

  test("ganti versi di panel Detail: kanvas dan konteks WebGL tetap, sudut dan jarak relatif kamera terbawa", async ({
    page,
  }) => {
    await openViewer(page, "?final=1");
    await choosePreset(page, "right");
    await canvasArea(page).focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("+");
    const before = await waitIdle(page);
    const canvas = await page.locator("canvas").elementHandle();
    if (!canvas) throw new Error("kanvas tidak ada");

    await page.getByRole("radio", { name: new RegExp(tSmoke.viewerPage.versionBase) }).click();
    await page.waitForFunction(() => window.__viewer?.snapshot().mode === "clay");
    const after = await waitIdle(page);
    expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.locator("canvas")).toHaveCount(1);
    expect(angleDistance(after.azimuth, before.azimuth)).toBeLessThan(1e-3);
    expect(Math.abs(after.polar - before.polar)).toBeLessThan(1e-3);
    expect(after.distance / after.fitDistance).toBeCloseTo(before.distance / before.fitDistance, 3);
  });

  test("klik dua kali memfokus titik permukaan; Shift + seret menggeser tanpa memutar", async ({ page }) => {
    await openViewer(page, "?panel=0");
    const start = await snapshot(page);
    const box = await canvasArea(page).boundingBox();
    if (!box) throw new Error("kanvas tidak terlihat");
    await page.mouse.dblclick(box.x + start.centerOnScreen[0], box.y + start.centerOnScreen[1]);
    const focused = await waitIdle(page);
    expect(
      Math.hypot(...focused.target.map((value, index) => value - (start.target[index] ?? 0))),
    ).toBeGreaterThan(0.01);
    expect(focused.distance / start.distance).toBeCloseTo(0.7, 3);

    await page.keyboard.press("f");
    const framed = await waitIdle(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(box.x + 300, box.y + 420);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 420, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    const panned = await waitIdle(page);
    expect(Math.abs(panned.azimuth - framed.azimuth)).toBeLessThan(1e-6);
    expect(
      Math.hypot(...panned.target.map((value, index) => value - (framed.target[index] ?? 0))),
    ).toBeGreaterThan(0.01);
  });

  test("layar penuh: sisa halaman inert (Tab tidak masuk ke rel); Escape keluar", async ({ page }) => {
    await openViewer(page);
    const rail = page.getByRole("navigation", { name: t.nav.label, includeHidden: true });
    const railInert = () => rail.evaluate((element) => element.closest("[inert]") !== null);
    expect(await railInert()).toBe(false);
    await page.getByRole("button", { name: v.fullscreen }).click();
    await expect(page.getByRole("button", { name: v.exitFullscreen })).toBeVisible();
    await expect(page.getByRole("button", { name: v.exitFullscreen })).toBeFocused();
    await expect(page.getByRole("region", { name: v.region })).toHaveCSS("position", "fixed");
    const box = await page.getByRole("region", { name: v.region }).boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height });
    expect(await railInert()).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: v.fullscreen })).toBeVisible();
    await expect(page.getByRole("region", { name: v.region })).toHaveCSS("position", "relative");
    expect(await railInert()).toBe(false);
  });

  test("WebGL terputus saat kanvas difokus: pesan diumumkan, fokus ke Muat ulang; muat ulang menampilkan state memuat lalu fokus ke kanvas", async ({
    page,
  }) => {
    const problems = collectConsoleProblems(page);
    await openViewer(page);
    await canvasArea(page).focus();
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(page.getByRole("heading", { name: v.contextLost.title })).toBeVisible();
    await expect(page.getByRole("button", { name: v.contextLost.reload })).toBeFocused();
    await expect(viewerStatus(page)).toHaveText(v.contextLost.title);
    const release = await holdModelRequests(page);
    await page.keyboard.press("Enter");
    await expect(canvasArea(page)).toBeFocused();
    await expect(viewerStatus(page)).toHaveText(v.loading);
    release();
    expectAngles(await waitIdle(page), "iso");
    await expect(viewerStatus(page)).toHaveText("");
    expect(problems).toEqual([]);
  });

  test("GLB rusak: pesan error diumumkan + coba lagi; gagal lagi → fokus kembali ke Coba lagi", async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto("/_viewer?model=rusak");
    const retry = page.getByRole("button", { name: v.error.retry });
    await expect(page.getByRole("heading", { name: v.error.title })).toBeVisible();
    await expect(retry).toBeVisible();
    await expect(viewerStatus(page)).toHaveText(v.error.title);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(retry).toBeFocused();
    await expect(viewerStatus(page)).toHaveText(v.error.title);
  });

  for (const theme of ["dark", "light"] as const) {
    const label = theme === "dark" ? "gelap" : "terang";

    test(`tema ${label}: axe 0 masalah serius (juga dengan menu Sudut), cincin fokus di setiap Tab`, async ({
      page,
    }) => {
      const problems = collectConsoleProblems(page);
      await openViewer(page, "", theme);
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `viewer-${label}.png`);
      await angleTrigger(page).click();
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `viewer-menu-sudut-${label}.png`);
      await page.keyboard.press("Escape");
      await page.goto(`/_viewer`);
      await waitIdle(page);
      const { stops, problems: rings } = await focusRingProblems(page);
      expect(stops).toBeGreaterThanOrEqual(14);
      expect(rings).toEqual([]);
      expect(problems).toEqual([]);
    });

    test(`tema ${label}: bulatan negatif gizmo kontras ≥3:1 (WCAG 1.4.11), hover terisi warna sumbu`, async ({
      page,
    }) => {
      await openViewer(page, "", theme);
      const background = await tokenRgb(page, "--color-bg-viewport");
      const gizmo = page.getByRole("toolbar", { name: v.gizmo.label });
      for (const [id, axis] of [
        ["nx", "x"],
        ["ny", "y"],
        ["nz", "z"],
      ] as const) {
        const head = gizmo.getByRole("button", { name: v.gizmo.axes[id] });
        // Bulatan di dalam tombol (dekoratif, tanpa role).
        const ring = head.locator("span");
        const color = await tokenRgb(page, `--color-axis-${axis}`);
        const css = `rgb(${color.join(", ")})`;
        await expect(ring).toHaveCSS("opacity", "1");
        await expect(ring).toHaveCSS("border-top-color", css);
        expect(contrastRatio(color, background), id).toBeGreaterThanOrEqual(3);
        await head.hover();
        await expect(ring).toHaveCSS("background-color", css);
      }
    });

    // Golden: satu tes per sudut (7 × 2 tema). Animasi dikurangi hanya mempercepat transisi; gambarnya sama.
    for (const preset of PRESET_IDS) {
      test(`golden ${preset}, tema ${label} (Ambil gambar → PNG)`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await openViewer(page, "?model=peti&final=1&panel=0", theme);
        expectAngles(await choosePreset(page, preset), preset);
        const png = await capturePng(page);
        const { width, height } = await sharp(png).metadata();
        expect({ width, height }).toEqual({ width: VIEWPORT.width - RAIL, height: VIEWPORT.height });
        // Disimpan setengah ukuran supaya repo tetap kecil; perbandingan tetap pixelmatch ambang 0,1.
        const small = await sharp(png)
          .resize({ width: Math.round((VIEWPORT.width - RAIL) / 2) })
          .png()
          .toBuffer();
        const result = await compareGolden(`${theme}-${preset}`, new Uint8Array(small), VIEWER_GOLDENS);
        expect(result.ratio, `${theme}-${preset}`).toBeLessThanOrEqual(GOLDEN_MAX_DIFF_RATIO);
      });
    }
  }
});

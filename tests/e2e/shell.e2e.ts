import { expect, type Locator, type Page, test } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  collectConsoleProblems,
  focusRingProblems,
  saveScreenshot,
  seriousA11yViolations,
} from "./helpers.ts";

// Resolusi sama dengan ekspor desain (1440×900 @2x = 2880×1800), supaya screenshot bisa dibandingkan langsung.
test.use({ deviceScaleFactor: 2 });

async function startWithTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

type Box = { x: number; y: number; width: number; height: number };

/** Posisi dan ukuran elemen harus sama dengan FigCraft (toleransi 0,5 px untuk pembulatan). */
async function expectBox(locator: Locator, expected: Partial<Box>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  for (const [key, value] of Object.entries(expected) as Array<[keyof Box, number]>) {
    expect(box?.[key], `${key}`).toBeCloseTo(value, 0);
  }
}

const rail = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });

test.describe("kerangka app sesuai FigCraft", { tag: "@smoke" }, () => {
  test("geometri rel dan topbar Studio sama dengan desain (#746, #747)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeVisible();
    await expectBox(rail(page), { x: 0, y: 0, width: 64, height: 900 });
    // Lebar pakai rel 63 px (garis kanan 1 px), jadi semua item di tengah 63 px seperti di FigCraft (NavItem x 3,5).
    await expectBox(rail(page).getByRole("img", { name: "AI Asset Generate" }), {
      x: 15.5,
      y: 12,
      width: 32,
      height: 32,
    });
    await expectBox(rail(page).getByRole("link", { name: "Studio" }), {
      x: 3.5,
      y: 64,
      width: 56,
      height: 52,
    });
    await expectBox(rail(page).getByRole("link", { name: "Gudang" }), {
      x: 3.5,
      y: 120,
      width: 56,
      height: 52,
    });
    await expectBox(rail(page).getByRole("link", { name: "Pengaturan" }), {
      x: 15.5,
      y: 812,
      width: 32,
      height: 32,
    });
    await expectBox(rail(page).getByRole("button", { name: "Akun" }), {
      x: 17.5,
      y: 860,
      width: 28,
      height: 28,
    });
    await expectBox(page.locator("header").first(), { x: 64, y: 0, width: 1376, height: 52 });
    // Indikator tahap di tengah area konten topbar (padding 20/16 menggeser 2 px dari tengah layar).
    const stepper = await page.getByRole("list", { name: "Tahap aset" }).boundingBox();
    expect((stepper?.x ?? 0) + (stepper?.width ?? 0) / 2).toBeCloseTo(754, 0);
    await expectBox(page.getByRole("link", { name: "Studio" }).last(), { x: 84 });
    const guide = await page.getByRole("button", { name: "Panduan" }).boundingBox();
    expect((guide?.x ?? 0) + (guide?.width ?? 0)).toBeCloseTo(1424, 0);
    expect(guide?.height).toBeCloseTo(30, 0);
    // Judul 44 px di bawah topbar, kolom konten 720 px di tengah area utama (x 392).
    await expectBox(page.getByRole("heading", { level: 1 }), { y: 96 });
    const subtitle = await page.getByText("Jelaskan bentuknya").boundingBox();
    expect(subtitle?.width).toBeLessThanOrEqual(540);
  });

  test("geometri topbar Gudang (#1295)", async ({ page }) => {
    await page.goto("/gudang");
    const title = page.getByRole("heading", { level: 1, name: "Gudang" });
    await expect(title).toBeVisible();
    await expectBox(title, { x: 88 });
    // Gudang kosong juga punya tombol "Aset baru" di Empty state; yang diukur tombol di topbar.
    const newAsset = await page.locator("header").getByRole("link", { name: "Aset baru" }).boundingBox();
    expect((newAsset?.x ?? 0) + (newAsset?.width ?? 0)).toBeCloseTo(1424, 0);
    expect(newAsset?.height).toBeCloseTo(30, 0);
    await expect(page.getByText(/^\d+ aset$/)).toBeVisible();
  });

  test("keyboard: urutan Tab rel → topbar, lewati-ke-konten memindahkan fokus ke konten", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const order: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? "";
        }),
      );
    }
    expect(order).toEqual([
      "Lewati ke konten utama",
      "Studio",
      "Gudang",
      "Pengaturan",
      "Akun",
      "Studio",
      "Panduan",
    ]);
    await page.goto("/");
    await page.keyboard.press("Tab");
    // Saat fokus, tautan lewati tampil sebagai Button Secondary sm: tinggi 30, padding 10, satu baris.
    const skip = page.getByRole("link", { name: "Lewati ke konten utama" });
    await expect(skip).toBeInViewport();
    const box = await skip.boundingBox();
    expect(box?.height).toBeCloseTo(30, 0);
    expect(await skip.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("10px");
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("tooltip pemicu tidak muncul lagi saat menu ditutup dengan mouse, tetapi muncul setelah Escape", async ({
    page,
  }) => {
    // Jam palsu yang dijeda: jeda buka tooltip (400 ms) dimajukan dengan runFor, tanpa menunggu waktu nyata.
    await page.clock.install({ time: new Date("2026-01-01T08:00:00") });
    await page.clock.pauseAt(new Date("2026-01-01T08:00:01"));
    await page.goto("/");
    const trigger = rail(page).getByRole("button", { name: "Akun" });
    await trigger.click();
    await page.getByRole("menuitemradio", { name: "Terang" }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    await page.mouse.move(720, 450);
    await page.clock.runFor(1000);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // Fokus yang kembali lewat keyboard (`:focus-visible`) tetap membuka tooltip, seperti fokus Tab biasa.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await page.clock.runFor(1000);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("Akun");
  });

  test("lebar 1024 px tetap layak: tanpa gulir horizontal, topbar utuh", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const path of ["/", "/gudang", "/pengaturan"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
    }
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Tahap aset" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Panduan" })).toBeInViewport({ ratio: 1 });
    await saveScreenshot(page, "studio-1024-gelap.png");
  });
});

for (const theme of ["dark", "light"] as const) {
  const label = theme === "dark" ? "gelap" : "terang";

  test.describe(`kerangka app, tema ${label}`, { tag: "@smoke" }, () => {
    test.beforeEach(async ({ page }) => {
      await startWithTheme(page, theme);
    });

    test("Studio, Gudang, Pengaturan: axe 0 masalah serius, screenshot untuk dibandingkan dengan desain", async ({
      page,
    }) => {
      const problems = collectConsoleProblems(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `studio-${label}.png`);

      await rail(page).getByRole("link", { name: "Gudang" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Gudang" })).toBeVisible();
      await expect(page.getByText(/^\d+ aset$/)).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `gudang-${label}.png`);

      await rail(page).getByRole("link", { name: "Pengaturan" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Pengaturan" })).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `pengaturan-${label}.png`);
      expect(problems).toEqual([]);
    });

    test("Tab di Studio, Gudang, Pengaturan: setiap pemberhentian punya cincin fokus yang tergambar", async ({
      page,
    }) => {
      for (const path of ["/", "/gudang", "/pengaturan"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const { stops, problems } = await focusRingProblems(page);
        expect(problems, path).toEqual([]);
        // Rel (lewati, Studio, Gudang, Pengaturan, Akun) + minimal satu kontrol halaman.
        expect(stops, path).toBeGreaterThanOrEqual(6);
      }
    });

    test("menu akun dan dialog Panduan: axe 0 masalah serius", async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto("/");
      await rail(page).getByRole("button", { name: "Akun" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByText("Akun Claude")).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `menu-akun-${label}.png`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Panduan" }).click();
      const dialog = page.getByRole("dialog", { name: "Panduan" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeFocused();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `panduan-${label}.png`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      expect(problems).toEqual([]);
    });
  });
}

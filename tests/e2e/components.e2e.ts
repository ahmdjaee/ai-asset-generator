import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  collectConsoleProblems,
  collectExternalRequests,
  focusRingProblem,
  focusRingProblems,
  saveScreenshot,
  seriousA11yViolations,
  settleAnimations,
  tokenRgb,
} from "./helpers.ts";

/** Memasang pilihan tema sebelum halaman dimuat. */
async function startWithTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

for (const theme of ["dark", "light"] as const) {
  const label = theme === "dark" ? "gelap" : "terang";

  test.describe(`galeri komponen, tema ${label}`, { tag: "@smoke" }, () => {
    test.beforeEach(async ({ page }) => {
      await startWithTheme(page, theme);
    });

    test("semua komponen dalam state-nya: axe 0 masalah serius, tanpa error console", async ({ page }) => {
      const problems = collectConsoleProblems(page);
      const external = collectExternalRequests(page);
      await page.goto("/_komponen");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { level: 1, name: "Galeri komponen" })).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Kartu aset", exact: true }).getByRole("article"),
      ).toHaveCount(3);
      // Komponen Gudang Tahap 10 ikut diperiksa axe: kartu mode pilih, cari, filter, kotak centang, kartu pilihan.
      const selectCards = page.getByRole("region", { name: "Kartu aset · mode pilih" });
      await expect(selectCards.getByRole("checkbox")).toHaveCount(3);
      await expect(selectCards.getByRole("checkbox", { checked: true })).toHaveCount(1);
      await expect(selectCards.getByRole("checkbox", { disabled: true })).toHaveCount(1);
      await expect(page.getByRole("searchbox", { name: "Cari aset" })).toBeVisible();
      await expect(page.getByRole("radiogroup", { name: "Format" })).toBeVisible();
      // Komponen Studio Tahap 9 ikut diperiksa axe: kartu pertanyaan, dock, thread, panel Detail, banner.
      await expect(page.getByRole("region", { name: "Gaya peti seperti apa?" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Claude sedang bekerja" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Proses berpikir · 12 dtk" })).toBeVisible();
      await expect(page.getByText("glTF valid · 0 error · 2 peringatan")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Koneksi ke server terputus" })).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `komponen-${label}.png`, { fullPage: true });
      expect(problems).toEqual([]);
      expect(external).toEqual([]);
    });

    test("state visual memakai token: pilihan terpilih, field error, kontrol nonaktif, kartu saat hover", async ({
      page,
    }) => {
      await page.goto("/_komponen");
      await expect(page.getByRole("heading", { level: 1, name: "Galeri komponen" })).toBeVisible();
      const rgb = async (token: string) => `rgb(${(await tokenRgb(page, token)).join(", ")})`;
      const style = (
        locator: Locator,
        property: "backgroundColor" | "borderTopColor" | "boxShadow" | "opacity",
      ) => locator.evaluate((element, name) => getComputedStyle(element)[name], property);

      const tier = page.getByRole("radiogroup", { name: "Tier" }).getByRole("radio", { checked: true });
      expect(await style(tier, "backgroundColor")).toBe(await rgb("--color-bg-elevated"));
      // Tailwind 4 menyusun box-shadow berlapis (lapisan kosong transparan); yang dicek lapisan garis dalamnya.
      expect(await style(tier, "boxShadow")).toContain(
        `${await rgb("--color-border-strong")} 0px 0px 0px 1px inset`,
      );
      const version = page
        .getByRole("region", { name: "Pemilih versi" })
        .getByRole("radiogroup", { name: "Versi" })
        .getByRole("radio", { checked: true });
      expect(await style(version, "backgroundColor")).toBe(await rgb("--color-bg-active"));

      const invalid = page
        .getByRole("textbox", { name: "Nama aset" })
        .and(page.locator("[aria-invalid=true]"));
      expect(await style(invalid, "borderTopColor")).toBe(await rgb("--color-danger-text"));
      expect(await style(page.getByRole("button", { name: "Nonaktif" }).first(), "opacity")).toBe("0.45");
      expect(await style(page.getByRole("textbox", { name: "Nama terkunci" }), "opacity")).toBe("0.45");

      const card = page
        .getByRole("region", { name: "Kartu aset", exact: true })
        .getByRole("article")
        .filter({ hasText: "Peti harta kayu" });
      expect(await style(card, "borderTopColor")).toBe(await rgb("--color-border-default"));
      await card.hover();
      await settleAnimations(page);
      expect(await style(card, "borderTopColor")).toBe(await rgb("--color-border-strong"));
    });

    test("setiap pemberhentian Tab punya cincin fokus 2 px accent-ring yang tergambar", async ({ page }) => {
      await page.goto("/_komponen");
      await expect(page.getByRole("heading", { level: 1, name: "Galeri komponen" })).toBeVisible();
      const { stops, problems } = await focusRingProblems(page);
      expect(problems).toEqual([]);
      expect(stops).toBeGreaterThan(20);
    });

    test("overlay terbuka (tooltip, menu, dialog, toast): axe 0 masalah serius, keyboard berjalan", async ({
      page,
    }) => {
      const problems = collectConsoleProblems(page);
      await page.goto("/_komponen");

      // Tooltip dengan pintasan muncul saat tombol mendapat fokus keyboard (Tab dari tombol sebelumnya). Fokus lewat
      // skrip saja tidak membuka tooltip (lihat `TooltipProvider`).
      await page.getByRole("button", { name: "Opsi lainnya" }).first().focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Grid lantai" }).first()).toBeFocused();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toContainText("Grid lantai");
      await expect(tooltip).toContainText("G");
      expect(await seriousA11yViolations(page)).toEqual([]);

      // Menu: dibuka dengan Enter, item dipilih dengan panah, ditutup dengan Escape.
      await page.getByRole("button", { name: "Buka menu" }).focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Arsipkan" })).toHaveAttribute("aria-disabled", "true");
      expect(await seriousA11yViolations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(page.getByRole("button", { name: "Buka menu" })).toBeFocused();

      // Dialog: fokus awal di tombol Batal, Escape menutup dan mengembalikan fokus.
      const opener = page.getByRole("button", { name: "Hapus aset…" });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Hapus aset?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Batal" })).toBeFocused();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `dialog-${label}.png`);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();

      // Toast: tiga jenis tampil di kanan bawah dan bisa ditutup.
      await page.getByRole("button", { name: "Toast sukses" }).click();
      await page.getByRole("button", { name: "Toast gagal" }).click();
      await page.getByRole("button", { name: "Toast info" }).click();
      await expect(page.getByRole("region", { name: /Notifikasi/ }).getByText("Aset diekspor")).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: /Notifikasi/ })
          .getByRole("listitem")
          .filter({ hasText: "Build gagal" }),
      ).toBeVisible();
      expect(await seriousA11yViolations(page)).toEqual([]);
      await saveScreenshot(page, `toast-${label}.png`);

      // Toast dijangkau keyboard (pintasan sonner Alt+T, lalu Tab); cincin fokus toast dan tombol tutupnya terlihat.
      const ring = await tokenRgb(page, "--color-accent-ring");
      await page.keyboard.press("Alt+KeyT");
      await page.keyboard.press("Tab");
      expect(await focusRingProblem(page, ring)).toBeNull();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Tutup notifikasi" }).first()).toBeFocused();
      expect(await focusRingProblem(page, ring)).toBeNull();

      const toasts = page.getByRole("region", { name: /Notifikasi/ }).getByRole("listitem");
      await expect(toasts).toHaveCount(3);
      await page.getByRole("button", { name: "Tutup notifikasi" }).first().click();
      await expect(toasts).toHaveCount(2);

      // Kartu aset saat hover: garis menguat dan chip 360° muncul.
      const card = page
        .getByRole("region", { name: "Kartu aset", exact: true })
        .getByRole("article")
        .filter({ hasText: "Peti harta kayu" });
      await card.hover();
      await expect(card.getByText("360°")).toBeVisible();
      expect(problems).toEqual([]);
    });
  });
}

/** Warna piksel (r, g, b) di titik tertentu dari screenshot sebuah elemen. */
async function pixelAt(target: Locator, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(await target.screenshot({ animations: "disabled" }))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const index = (y * info.width + x) * info.channels;
  return [data[index] ?? -1, data[index + 1] ?? -1, data[index + 2] ?? -1];
}

for (const theme of ["dark", "light"] as const) {
  test(`meter budget memakai warna token nada, tema ${theme === "dark" ? "gelap" : "terang"}`, {
    tag: "@smoke",
  }, async ({ page }) => {
    await startWithTheme(page, theme);
    await page.goto("/_komponen");
    // Nada per meter di galeri, dikenali dari nilai yang dibacakan (`aria-valuetext`).
    const expected: Record<string, string> = {
      "3.388 / 8.000": "--color-accent-solid",
      "164 KB / 1,5 MB": "--color-accent-solid",
      "10.900 / 12.000 maks": "--color-warning-text",
      "1,7 MB / 1,5 MB maks": "--color-danger-text",
    };
    // Meter bagian "Statistik dan meter budget"; panel Detail di bagian Studio punya meternya sendiri.
    const meters = page.getByRole("region", { name: "Statistik dan meter budget" }).getByRole("meter");
    await expect(meters).toHaveCount(Object.keys(expected).length);
    for (const meter of await meters.all()) {
      const valueText = (await meter.getAttribute("aria-valuetext")) ?? "";
      const token = expected[valueText];
      expect(token, `meter "${valueText}" tidak dikenal`).toBeDefined();
      await meter.scrollIntoViewIfNeeded();
      // Titik di dalam isi (rasio terkecil di galeri 0,11 ≈ 23 px), baris tengah trek 4 px.
      const actual = await pixelAt(meter, 8, 2);
      const want = await tokenRgb(page, token ?? "");
      for (const [index, channel] of actual.entries()) {
        expect(
          Math.abs(channel - (want[index] ?? 0)),
          `${valueText} ${token} ${actual} vs ${want}`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });
}

/** Durasi animasi/transisi terhitung terpanjang (detik) dari elemen, atau leluhur terdekatnya yang cocok `closest`. */
async function motionSeconds(target: Locator, closest?: string) {
  return target.evaluate((element, selector) => {
    const node = selector ? (element.closest(selector) ?? element) : element;
    const style = getComputedStyle(node);
    const longest = (value: string) =>
      Math.max(...value.split(",").map((part) => Number.parseFloat(part) || 0));
    return { animation: longest(style.animationDuration), transition: longest(style.transitionDuration) };
  }, closest);
}

test.describe("animasi dikurangi", { tag: "@smoke" }, () => {
  test("tanpa preferensi: dialog beranimasi (kontrol untuk tes di bawah)", async ({ page }) => {
    await page.goto("/_komponen");
    await page.getByRole("button", { name: "Hapus aset…" }).click();
    const motion = await motionSeconds(page.getByRole("dialog", { name: "Hapus aset?" }));
    expect(motion.animation).toBeGreaterThan(0.05);
  });

  test.describe("prefers-reduced-motion: reduce", () => {
    test.use({ reducedMotion: "reduce" });

    test("dialog, spinner tombol, dan toast tidak beranimasi", async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto("/_komponen");
      await page.getByRole("button", { name: "Hapus aset…" }).click();
      expect((await motionSeconds(page.getByRole("dialog", { name: "Hapus aset?" }))).animation).toBeLessThan(
        0.001,
      );
      await page.keyboard.press("Escape");

      // Spinner tombol memuat berhenti setelah satu putaran super singkat.
      const spinner = page.getByRole("button", { name: "Menyimpan…" }).first().locator("svg");
      const spin = await spinner.evaluate((element) => {
        const style = getComputedStyle(element);
        return { duration: Number.parseFloat(style.animationDuration), count: style.animationIterationCount };
      });
      expect(spin.duration).toBeLessThan(0.001);
      expect(spin.count).toBe("1");

      // Toast sonner: gaya bawaan sonner sendiri mematikan transisi saat animasi dikurangi.
      await page.getByRole("button", { name: "Toast sukses" }).click();
      const toast = await motionSeconds(
        page
          .getByRole("region", { name: /Notifikasi/ })
          .getByRole("listitem")
          .filter({ hasText: "Aset diekspor" }),
      );
      expect(toast.transition).toBe(0);
      expect(problems).toEqual([]);
    });
  });
});

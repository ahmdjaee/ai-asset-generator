import { expect, type Page, test } from "@playwright/test";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  collectConsoleProblems,
  collectExternalRequests,
  nonBackgroundRatio,
  seriousA11yViolations,
} from "./helpers.ts";

/** Memasang pilihan tema sebelum halaman dimuat (berlaku juga saat reload). */
async function startWithTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`tema ${theme === "dark" ? "gelap" : "terang"}`, { tag: "@smoke" }, () => {
    test.beforeEach(async ({ page }) => {
      await startWithTheme(page, theme);
    });

    test("halaman uji: tombol, streamdown, kanvas R3F, dan WebSocket berjalan tanpa error", async ({
      page,
    }) => {
      const problems = collectConsoleProblems(page);
      const external = collectExternalRequests(page);
      await page.goto("/_smoke");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { level: 1, name: "Halaman uji internal" })).toBeVisible();

      await expect(page.getByRole("button", { name: "Kirim" })).toHaveCount(2);

      const markdown = page.getByRole("region", { name: "Markdown (streamdown)" });
      await expect(markdown.getByRole("heading", { level: 3, name: "Contoh markdown" })).toBeVisible();
      await expect(markdown.getByRole("listitem")).toHaveCount(3);
      await expect(markdown.getByText("streamdown", { exact: true })).toBeVisible();

      const canvas = page.getByRole("img", { name: "Kubus uji di kanvas 3D" }).locator("canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(() => nonBackgroundRatio(canvas), { timeout: 15_000 }).toBeGreaterThan(0.02);

      await expect(page.getByRole("status").filter({ hasText: "Realtime tersambung" })).toBeVisible();

      expect(await seriousA11yViolations(page)).toEqual([]);
      expect(problems).toEqual([]);
      // Font, kanvas 3D, dan markdown tidak mengambil apa pun dari CDN.
      expect(external).toEqual([]);
    });

    test("kerangka app: rel navigasi dan topbar sesuai desain", async ({ page }) => {
      const problems = collectConsoleProblems(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Lokasi halaman" })).toBeVisible();
      await expect(page.getByText(/Server tersambung/)).toHaveCount(0);

      // Tautan Gudang di rel (halaman Studio juga punya tautan "Buka Gudang").
      const railGudang = page
        .getByRole("navigation", { name: "Navigasi utama" })
        .getByRole("link", { name: "Gudang" });
      await railGudang.click();
      await expect(page).toHaveURL(/\/gudang$/);
      await expect(page.getByRole("heading", { level: 1, name: "Gudang" })).toBeVisible();
      await expect(railGudang).toHaveAttribute("aria-current", "page");

      expect(await seriousA11yViolations(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test.describe("tema dan rute", { tag: "@smoke" }, () => {
  test("pilihan tema di Pengaturan diterapkan dan bertahan setelah muat ulang", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/pengaturan");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("radio", { name: "Terang" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "Terang" })).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("radio", { name: "Terang" })).toHaveAttribute("aria-checked", "true");

    // Radix memilih saat fokus pindah karena panah ditekan (fokus dipindah lewat setTimeout), jadi tombol ditahan
    // sampai pilihan berubah, seperti tekanan tombol manusia.
    await page.getByRole("radio", { name: "Terang" }).focus();
    await page.keyboard.down("ArrowLeft");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.up("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Gelap" })).toHaveAttribute("aria-checked", "true");
    expect(problems).toEqual([]);
  });

  test("tema ikut sistem mengikuti prefers-color-scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await startWithTheme(page, "light");
    await page.goto("/pengaturan");
    await page.getByRole("radio", { name: "Sistem" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("alamat yang tidak ada menampilkan halaman 404", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    await page.goto("/tidak-ada");
    await expect(page.getByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })).toBeVisible();
    await page.getByRole("link", { name: "Kembali ke Studio" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Mau buat aset 3D apa?" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("API yang tidak ada menjawab 404 berformat { code, message }", async ({ request }) => {
    const response = await request.get("/api/tidak-ada");
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Alamat API tidak ditemukan." });
  });
});

/**
 * Pengaturan dan state khusus (Tahap 11) terhadap server mode palsu (`AGENT_DRIVER=fake` × `RUNTIME_DRIVER=fixture`):
 * - Pengaturan: budget tidak valid → Simpan nonaktif; budget tersimpan dipakai info tier Studio; notifikasi diizinkan.
 * - Banner akun dan runtime: status kesehatan disimulasikan dengan mencegat `/api/health/*` (akun palsu selalu login
 *   dan runtime fixture selalu siap).
 * - Giliran gagal: penanda `[keluar]` (belum login), `[batas]` (batas pemakaian), `[mati]` (proses mati) → blok di
 *   thread dan kartu dock Coba lagi.
 * File ini membuat aset dan mengubah Pengaturan server bersama, jadi masuk project `aset` (`ASSET_TESTS`).
 */
import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../shared/settings.ts";
import { t } from "../../web/i18n/id.ts";
import { collectConsoleProblems, saveScreenshot, seriousA11yViolations } from "./helpers.ts";

// Resolusi sama dengan ekspor desain (1440×900 @2x), supaya screenshot bisa dibandingkan langsung.
test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "default" });

// Pengaturan server dipakai bersama semua tes: selalu kembali ke bawaan, juga bila tes gagal di tengah.
test.afterAll(async ({ request }) => {
  const response = await request.put("/api/settings", { data: DEFAULT_SETTINGS });
  expect(response.ok()).toBe(true);
});

const field = (page: Page, name: string) => page.getByRole("textbox", { name });
const thread = (page: Page) => page.getByRole("region", { name: t.thread.label });
const dockCard = (page: Page, title: string) => page.getByRole("region", { name: title });
const banners = (page: Page) => page.getByRole("status", { name: t.banners.status });

async function createAsset(page: Page, prompt: string) {
  await page.goto("/");
  const prompter = page.getByRole("textbox", { name: t.studio.promptLabel });
  await prompter.fill(prompt);
  await prompter.press("Enter");
  await page.waitForURL(/\/studio\/[^/]+$/);
}

/** Status kesehatan tiruan untuk banner; `checkedAt` tetap supaya tampilan stabil. */
async function fakeHealth(page: Page, health: { auth?: object; runtime?: object }) {
  if (health.auth) {
    const auth = health.auth;
    await page.route("**/api/health/auth*", (route) => route.fulfill({ json: { auth } }));
  }
  if (health.runtime) {
    const runtime = health.runtime;
    await page.route("**/api/health/runtime*", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { runtime } }) : route.fallback(),
    );
  }
}

const CHECKED_AT = Date.UTC(2026, 10, 18, 14, 32);
const RUNTIME_BASE = {
  driver: "docker",
  docker: { ok: true, detail: "29.1.2" },
  image: { tag: "asset-forge:e2e", present: false },
  blender: null,
  renderer: { ok: true, detail: "Chromium headless · SwiftShader" },
  materials: { count: 2 },
  checkedAt: CHECKED_AT,
};

test("Pengaturan: budget tidak valid menahan Simpan; budget tersimpan dipakai Studio; Pulihkan bawaan", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/pengaturan");
  await expect(page.getByRole("heading", { level: 1, name: t.settings.title })).toBeVisible();
  await expect(page.getByText(t.settings.account.connected)).toBeVisible();
  await expect(page.getByRole("list", { name: t.settings.runtime.checks })).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "pengaturan.png", { fullPage: true });

  const target = field(page, "Segitiga target, Sedang");
  await target.fill("14.000");
  await expect(target).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(t.settings.assets.errors.order)).toBeVisible();
  await expect(page.getByRole("button", { name: t.settings.save.save })).toBeDisabled();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "pengaturan-budget-tidak-valid.png");

  await target.fill("9000");
  await target.press("Tab");
  await expect(target).toHaveValue("9.000");
  await page.getByRole("button", { name: t.settings.save.save }).click();
  await expect(page.getByRole("button", { name: t.settings.save.save })).toBeHidden();

  // Aset baru: info tier di composer memakai budget yang baru disimpan.
  await page
    .getByRole("navigation", { name: "Navigasi utama" })
    .getByRole("link", { name: "Studio" })
    .click();
  await expect(page.getByText(/Sedang — target 9k segitiga/)).toBeVisible();

  await page.goto("/pengaturan");
  await expect(target).toHaveValue("9.000");
  await page.getByRole("button", { name: t.settings.assets.restore }).click();
  await expect(target).toHaveValue("8.000");
  await page.getByRole("button", { name: t.settings.save.save }).click();
  await expect(page.getByRole("button", { name: t.settings.save.save })).toBeHidden();
  await page.reload();
  await expect(target).toHaveValue("8.000");
  expect(problems).toEqual([]);
});

test("Pengaturan: notifikasi yang sudah diizinkan tampil Aktif, tanpa tombol izinkan", async ({ page }) => {
  // Chromium headless: `grantPermissions` hanya mengubah Permissions API, `Notification.permission` tetap "denied"
  // (AGENTS.md §13). Izin disimulasikan di halaman.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
  });
  await page.goto("/pengaturan");
  const display = page.getByRole("region", { name: t.settings.display.title });
  await expect(display.getByText(t.settings.display.allowed)).toBeVisible();
  await expect(display.getByRole("button", { name: t.settings.display.allow })).toBeHidden();
});

test("banner: belum login dan image belum ada di Studio; membangun image setelah Bangun image", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await fakeHealth(page, {
    auth: { state: "logged_out", checkedAt: CHECKED_AT },
    runtime: {
      ...RUNTIME_BASE,
      ready: false,
      build: { state: "idle", startedAt: null, endedAt: null, error: null },
    },
  });
  let buildRequests = 0;
  await page.route("**/api/health/runtime/image", (route) => {
    buildRequests += 1;
    return route.fulfill({
      status: 202,
      json: {
        runtime: {
          ...RUNTIME_BASE,
          ready: false,
          build: { state: "building", startedAt: CHECKED_AT, endedAt: null, error: null },
        },
      },
    });
  });
  await page.goto("/");
  await expect(banners(page).getByText(t.banners.loggedOut)).toBeVisible();
  await expect(banners(page).getByText(t.banners.imageMissing)).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "banner-belum-login-image.png");

  await banners(page).getByRole("button", { name: t.banners.build }).click();
  await expect(banners(page).getByText(t.banners.building)).toBeVisible();
  expect(buildRequests).toBe(1);
  await expect(banners(page).getByRole("button", { name: t.banners.build })).toBeHidden();
  expect(problems).toEqual([]);
});

test("banner: API key dan build image gagal; Buka Pengaturan menampilkan akhir log build", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await fakeHealth(page, {
    auth: { state: "api_key", checkedAt: CHECKED_AT },
    runtime: {
      ...RUNTIME_BASE,
      ready: false,
      build: {
        state: "failed",
        startedAt: null,
        endedAt: CHECKED_AT,
        error: "Step 4/9 : RUN pip install bpy==5.2.4\nERROR: No matching distribution found for bpy==5.2.4",
      },
    },
  });
  await page.goto("/gudang");
  await expect(banners(page).getByText(t.banners.apiKey)).toBeVisible();
  await expect(banners(page).getByText(t.banners.buildFailed)).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "banner-api-key-build-gagal.png");

  await banners(page).getByRole("link", { name: t.banners.openSettings }).click();
  const runtime = page.getByRole("region", { name: t.settings.runtime.title });
  await expect(runtime.getByText(t.settings.runtime.log)).toBeVisible();
  await expect(runtime.getByText(/No matching distribution/)).toBeVisible();
  await expect(runtime.getByRole("button", { name: t.settings.runtime.rebuild })).toBeVisible();
  // Pengaturan sendiri tidak memuat banner: masalahnya sudah dijelaskan di bagiannya.
  await expect(banners(page)).toHaveCount(0);
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "pengaturan-bermasalah.png", { fullPage: true });
  expect(problems).toEqual([]);
});

test("belum login saat giliran berjalan: blok petunjuk login di thread dan kartu Coba lagi", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await createAsset(page, "Peti kayu [keluar]");
  await expect(thread(page).getByText(t.thread.errors.authRequired.title)).toBeVisible();
  await expect(thread(page).getByText(t.thread.errors.authRequired.description)).toBeVisible();
  await expect(dockCard(page, t.dock.failed.title)).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "studio-belum-login.png");
  expect(problems).toEqual([]);
});

test("batas pemakaian: waktu reset di thread; Coba lagi tersedia", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await createAsset(page, "Peti kayu [batas]");
  await expect(thread(page).getByText(t.thread.errors.usageLimit.title)).toBeVisible();
  await expect(thread(page).getByText(/^Bisa dipakai lagi pukul \d{2}\.\d{2}\./)).toBeVisible();
  await expect(dockCard(page, t.dock.failed.title)).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "studio-batas-pemakaian.png");
  expect(problems).toEqual([]);
});

test("proses Claude mati: Coba lagi melanjutkan sampai bentuk dasar siap direview", async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectConsoleProblems(page);
  await createAsset(page, "Peti kayu [mati]");
  await expect(thread(page).getByText(t.thread.errors.failed.title)).toBeVisible();
  const failed = dockCard(page, t.dock.failed.title);
  await expect(failed).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "studio-giliran-gagal.png");

  await failed.getByRole("button", { name: t.dock.failed.retry }).click();
  await expect(thread(page).getByText(t.thread.actions.retry)).toBeVisible();
  await expect(dockCard(page, t.dock.baseReview.title("v1"))).toBeVisible();
  await expect(failed).toBeHidden();
  expect(problems).toEqual([]);
});

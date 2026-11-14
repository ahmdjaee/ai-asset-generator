/**
 * Gudang, Detail aset, dan ekspor (Tahap 10) terhadap server mode palsu (`AGENT_DRIVER=fake` × `RUNTIME_DRIVER=fixture`).
 * Aset dibuat lewat API dan ditunggu sampai bentuk dasar v1 siap direview sebelum halaman dibuka, jadi tidak ada toast
 * "siap direview" di tengah tes. Server dan folder data dipakai bersama tes aset lain: setiap tes memakai kata unik di
 * prompt asetnya dan membatasi Gudang dengan pencarian kata itu.
 */
import { readFile } from "node:fs/promises";
import {
  type APIRequestContext,
  type Download,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import sharp from "sharp";
import { z } from "zod";
import type { ViewerProbeSnapshot } from "../../web/features/viewer/test-hook.ts";
import { t } from "../../web/i18n/id.ts";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  collectConsoleProblems,
  collectExternalRequests,
  focusRingProblems,
  saveScreenshot,
  seriousA11yViolations,
} from "./helpers.ts";

// Resolusi sama dengan ekspor desain (1440×900 @2x), supaya screenshot bisa dibandingkan langsung.
test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "default" });

const AssetState = z.object({
  asset: z.object({ id: z.string(), name: z.string(), status: z.string(), runState: z.string() }),
});
const AssetList = z.object({ assets: z.array(z.object({ id: z.string(), name: z.string() })) });
const GltfJson = z.object({ extensionsUsed: z.array(z.string()).optional() });

type NewAsset = Readonly<{
  name: string;
  prompt: string;
  tierId?: "ringan" | "sedang" | "maksimal";
  image?: Readonly<{ name: string; buffer: Buffer }>;
}>;

/**
 * Aset baru lewat API (tanpa header Origin, seperti skrip lokal), lalu ditunggu sampai v1 siap direview dan giliran
 * Claude selesai. Dibuat satu per satu, jadi urutan "Terbaru"/"Terlama" sama dengan urutan pembuatan.
 */
async function createReady(request: APIRequestContext, asset: NewAsset): Promise<string> {
  const response = await request.post("/api/assets", {
    multipart: {
      prompt: asset.prompt,
      name: asset.name,
      tierId: asset.tierId ?? "sedang",
      ...(asset.image === undefined
        ? {}
        : { "files[]": { name: asset.image.name, mimeType: "image/png", buffer: asset.image.buffer } }),
    },
  });
  expect(response.status()).toBe(201);
  const { id } = AssetState.parse(await response.json()).asset;
  await expect
    .poll(
      async () => {
        const { asset: state } = AssetState.parse(await (await request.get(`/api/assets/${id}`)).json());
        return `${state.status}/${state.runState}`;
      },
      { timeout: 30_000 },
    )
    .toBe("BASE_REVIEW/idle");
  return id;
}

async function createAllReady(request: APIRequestContext, assets: readonly NewAsset[]): Promise<string[]> {
  const ids: string[] = [];
  for (const asset of assets) ids.push(await createReady(request, asset));
  return ids;
}

async function startWithTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

const results = (page: Page) => page.getByRole("list", { name: t.gudang.results });
const titles = (page: Page) => results(page).getByRole("heading", { level: 3 });
const searchBox = (page: Page) => page.getByRole("searchbox", { name: t.gudang.search.label });
const selectionBar = (page: Page) => page.getByRole("region", { name: t.gudang.select.bar });

/** Memilih nilai Dropdown filter: pemicu bernama "<awalan> <nilai sekarang>". */
async function choose(page: Page, trigger: string, option: string) {
  await page.getByRole("button", { name: trigger, exact: true }).click();
  await page.getByRole("menuitemradio", { name: option, exact: true }).click();
  await expect(page.getByRole("menu")).toBeHidden();
}

/** Viewer halaman sudah memuat GLB yang diminta dan menggambar frame. */
async function viewerReady(page: Page) {
  await page.waitForFunction(() => {
    const probe: { snapshot: () => ViewerProbeSnapshot } | undefined = window.__viewer;
    return probe?.snapshot().ready === true;
  });
}

async function downloadBytes(download: Download): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await download.path()));
}

/** Header GLB valid dan isi chunk JSON-nya. */
function glbJson(bytes: Uint8Array): z.infer<typeof GltfJson> {
  const text = new TextDecoder();
  expect(text.decode(bytes.subarray(0, 4))).toBe("glTF");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  expect(text.decode(bytes.subarray(16, 20))).toBe("JSON");
  return GltfJson.parse(JSON.parse(text.decode(bytes.subarray(20, 20 + length))));
}

/** Ekstensi yang butuh dekoder tambahan di Unity (meshopt, Draco, KTX2, WebP/AVIF) atau kuantisasi. */
function compressionExtensions(json: z.infer<typeof GltfJson>): string[] {
  return (json.extensionsUsed ?? []).filter((name) =>
    /compression|quantization|basisu|webp|avif/i.test(name),
  );
}

/** Nama entri ZIP yang aman: tanpa path absolut, `..`, backslash, atau karakter di luar huruf/angka/`-`/`.`/`/`. */
function unsafeZipNames(names: readonly string[]): string[] {
  return names.filter(
    (name) =>
      name.startsWith("/") ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      !/^[\p{L}\p{N}][\p{L}\p{N}./-]*$/u.test(name),
  );
}

async function imageLoaded(image: Locator): Promise<boolean> {
  return image.evaluate(
    (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
  );
}

test("cari, filter, urutkan, tampilan daftar; Detail aset kembali ke daftar yang sama", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = collectConsoleProblems(page);
  // Urutan pembuatan sengaja berbeda dari urutan nama: Terbaru, Terlama, dan Nama A–Z memberi urutan yang berbeda.
  const [gamma, alfa, beta] = await createAllReady(page.request, [
    { name: "Rak gamma", prompt: "Rak gamma gudangcari", tierId: "sedang" },
    { name: "Rak alfa", prompt: "Rak alfa gudangcari", tierId: "ringan" },
    { name: "Rak beta", prompt: "Rak beta gudangcari", tierId: "maksimal" },
  ]);
  expect([gamma, alfa, beta].every(Boolean)).toBe(true);

  await page.goto("/gudang");
  await expect(page.getByRole("heading", { level: 1, name: t.gudang.title })).toBeVisible();
  // "/" memfokuskan kolom cari (aria-keyshortcuts), ketikan masuk ke URL.
  await page.keyboard.press("/");
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type("gudangcari");
  await expect(page).toHaveURL(/\/gudang\?q=gudangcari$/);
  await expect(titles(page)).toHaveText(["Rak beta", "Rak alfa", "Rak gamma"]);
  await expect(results(page).getByRole("article").filter({ hasText: "Rak beta" })).toContainText("segitiga");

  // Filter Tier (pemicu bernama awalan + nilai), lalu kembali ke Semua.
  await choose(page, `${t.gudang.tier} ${t.gudang.all}`, t.tier.ringan);
  await expect(page).toHaveURL(/[?&]tier=ringan/);
  await expect(titles(page)).toHaveText(["Rak alfa"]);
  await choose(page, `${t.gudang.tier} ${t.tier.ringan}`, t.gudang.all);
  await expect(titles(page)).toHaveCount(3);

  // Tahap dan Tanggal: ketiganya bentuk dasar yang baru dibuat.
  await choose(page, `${t.gudang.stage.label} ${t.gudang.all}`, t.gudang.stage.base);
  await choose(page, `${t.gudang.date.label} ${t.gudang.all}`, t.gudang.date.day);
  await expect(page).toHaveURL(/[?&]stage=base/);
  await expect(page).toHaveURL(/[?&]date=day/);
  await expect(titles(page)).toHaveCount(3);

  // Urutkan.
  await choose(page, `${t.gudang.sort.label} ${t.gudang.sort.updated}`, t.gudang.sort.name);
  await expect(titles(page)).toHaveText(["Rak alfa", "Rak beta", "Rak gamma"]);
  await choose(page, `${t.gudang.sort.label} ${t.gudang.sort.name}`, t.gudang.sort.oldest);
  await expect(titles(page)).toHaveText(["Rak gamma", "Rak alfa", "Rak beta"]);

  // Tanpa hasil → Hapus filter mengosongkan kata kunci dan filter; urutan tetap.
  await choose(page, `${t.gudang.stage.label} ${t.gudang.stage.base}`, t.gudang.stage.done);
  await expect(page.getByRole("heading", { name: t.gudang.empty.noResults })).toBeVisible();
  await page.getByRole("button", { name: t.gudang.empty.clearFilters }).click();
  await expect(page).toHaveURL(/\/gudang\?sort=oldest$/);
  await expect(searchBox(page)).toHaveValue("");

  // Tampilan daftar, lalu buka Detail aset dan kembali lewat breadcrumb.
  await searchBox(page).fill("gudangcari");
  await page.getByRole("radio", { name: t.gudang.view.list }).click();
  await expect(page).toHaveURL(/\/gudang\?q=gudangcari&sort=oldest&view=list$/);
  await expect(titles(page)).toHaveText(["Rak gamma", "Rak alfa", "Rak beta"]);
  const row = results(page).getByRole("article").filter({ hasText: "Rak beta" });
  await expect(row).toContainText(t.tier.maksimal);
  await expect(row).toContainText(t.status.review);
  expect(await seriousA11yViolations(page)).toEqual([]);
  await row.getByRole("link", { name: "Rak beta" }).click();
  await expect(page).toHaveURL(new RegExp(`/gudang/${beta}$`));
  const crumbs = page.getByRole("navigation", { name: t.shell.breadcrumb });
  await expect(crumbs.getByText("Rak beta")).toHaveAttribute("aria-current", "page");
  await crumbs.getByRole("link", { name: t.gudang.title }).click();
  await expect(page).toHaveURL(/\/gudang\?q=gudangcari&sort=oldest&view=list$/);
  await expect(searchBox(page)).toHaveValue("gudangcari");
  await expect(titles(page)).toHaveText(["Rak gamma", "Rak alfa", "Rak beta"]);
  expect(problems).toEqual([]);
});

test("mode pilih: ZIP Web dan Unity berisi GLB tiap aset dengan nama file aman", async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectConsoleProblems(page);
  await createAllReady(page.request, [
    { name: "Lampu meja", prompt: "Lampu meja gudangzip" },
    // Nama berbahaya: pemisah path dan titik tidak boleh lolos ke nama entri ZIP (zip-slip).
    { name: '../../Lampu "gantung"\\jahat', prompt: "Lampu gantung gudangzip" },
  ]);
  await page.goto("/gudang?q=gudangzip&sort=name");
  await expect(titles(page)).toHaveCount(2);
  const toggle = page.getByRole("button", { name: t.gudang.select.toggle, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const bar = selectionBar(page);
  await expect(bar.getByRole("status")).toHaveText(t.gudang.select.count("0"));
  await expect(bar.getByRole("button", { name: t.gudang.select.zipWeb })).toBeDisabled();

  // Klik di mana saja di kartu memilih (judul berlabel kotak centang).
  await results(page).getByText("Lampu meja").click();
  await expect(page.getByRole("checkbox", { name: t.gudang.select.item("Lampu meja") })).toBeChecked();
  await bar.getByRole("button", { name: t.gudang.select.all }).click();
  await expect(bar.getByRole("status")).toHaveText(t.gudang.select.count("2"));
  expect(await seriousA11yViolations(page)).toEqual([]);

  // Klik ZIP: server memeriksa aset (dan menyiapkan GLB Unity) dulu, lalu unduhan dimulai lewat tautan sementara.
  const [web] = await Promise.all([
    page.waitForEvent("download"),
    bar.getByRole("button", { name: t.gudang.select.zipWeb }).click(),
  ]);
  expect(web.suggestedFilename()).toBe("gudang-2-aset-web.zip");
  const webFiles = unzipSync(await downloadBytes(web));
  const webNames = Object.keys(webFiles).sort();
  expect(webNames).toEqual(["lampu-gantung-jahat-v1-web.glb", "lampu-meja-v1-web.glb"]);
  expect(unsafeZipNames(webNames)).toEqual([]);
  for (const name of webNames) glbJson(webFiles[name] ?? new Uint8Array());

  const zipUnity = bar.getByRole("button", { name: t.gudang.select.zipUnity });
  const [unity] = await Promise.all([page.waitForEvent("download"), zipUnity.click()]);
  await expect(zipUnity).not.toHaveAttribute("aria-busy");
  await expect(zipUnity).toBeFocused();
  expect(unity.suggestedFilename()).toBe("gudang-2-aset-unity.zip");
  const unityFiles = unzipSync(await downloadBytes(unity));
  expect(Object.keys(unityFiles).sort()).toEqual([
    "lampu-gantung-jahat-v1-unity.glb",
    "lampu-meja-v1-unity.glb",
  ]);
  for (const bytes of Object.values(unityFiles)) expect(compressionExtensions(glbJson(bytes))).toEqual([]);

  // Batal: kembali ke tautan kartu, fokus ke tombol Pilih.
  await bar.getByRole("button", { name: t.gudang.select.cancel }).click();
  await expect(selectionBar(page)).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(results(page).getByRole("link", { name: "Lampu meja" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("Detail aset: info dan lampiran, ekspor Unity dan Sumber, ganti nama, duplikat, hapus", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectConsoleProblems(page);
  const sketch = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .png()
    .toBuffer();
  const id = await createReady(page.request, {
    name: "Tong kayu",
    prompt: "Tong kayu dengan simpai besi gudangaksi",
    image: { name: "sketsa-tong.png", buffer: sketch },
  });
  await page.goto(`/gudang/${id}`);
  const crumbs = page.getByRole("navigation", { name: t.shell.breadcrumb });
  await expect(crumbs.getByText("Tong kayu")).toHaveAttribute("aria-current", "page");
  const info = page.getByRole("region", { name: t.assetDetail.info });
  await expect(info).toContainText("Tong kayu dengan simpai besi gudangaksi");
  const attachments = info.getByRole("list", { name: t.assetDetail.attachments });
  await expect(attachments.getByRole("listitem")).toHaveText(["sketsa-tong.png"]);
  expect(await imageLoaded(attachments.locator("img"))).toBe(true);
  await expect(info.getByRole("region", { name: t.thread.brief.title })).toBeVisible();
  await expect(info).toContainText(t.assetDetail.versionCount("1"));
  await viewerReady(page);
  expect(await seriousA11yViolations(page)).toEqual([]);

  // Ekspor Unity: GLB tanpa ekstensi kompresi; fokus kembali ke tombol Ekspor.
  const exportButton = page.getByRole("button", { name: t.assetDetail.export, exact: true });
  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: t.assetActions.exportDialog.title });
  await expect(
    dialog.getByRole("button", { name: `${t.assetActions.exportDialog.version} v1 · Bentuk dasar` }),
  ).toBeVisible();
  await dialog.getByRole("radio", { name: t.assetActions.exportDialog.presets.unity.title }).click();
  await expect(
    dialog.getByText(t.assetActions.exportDialog.fileName("tong-kayu-v1-unity.glb")),
  ).toBeVisible();
  const [unity] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: t.assetActions.exportDialog.download }).click(),
  ]);
  expect(unity.suggestedFilename()).toBe("tong-kayu-v1-unity.glb");
  expect(compressionExtensions(glbJson(await downloadBytes(unity)))).toEqual([]);
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();

  // Ekspor Sumber: satu folder akar, skrip dan README di dalamnya.
  await exportButton.click();
  await dialog.getByRole("radio", { name: t.assetActions.exportDialog.presets.source.title }).click();
  // Setelah Unity dibuat, ukurannya pasti (tanpa ≈).
  await expect(
    dialog.getByRole("radio", { name: t.assetActions.exportDialog.presets.unity.title }),
  ).not.toContainText("≈");
  const [source] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: t.assetActions.exportDialog.download }).click(),
  ]);
  expect(source.suggestedFilename()).toBe("tong-kayu-v1-sumber.zip");
  const sourceFiles = unzipSync(await downloadBytes(source));
  const sourceNames = Object.keys(sourceFiles);
  expect(sourceNames.every((name) => name.startsWith("tong-kayu-v1-sumber/"))).toBe(true);
  expect(unsafeZipNames(sourceNames)).toEqual([]);
  expect(sourceNames).toEqual(
    expect.arrayContaining(["tong-kayu-v1-sumber/README.md", "tong-kayu-v1-sumber/script.py"]),
  );
  expect(strFromU8(sourceFiles["tong-kayu-v1-sumber/README.md"] ?? new Uint8Array())).toContain(
    "# Tong kayu — sumber v1",
  );

  // Ganti nama dari menu "…": breadcrumb ikut berganti, fokus kembali ke pemicu menu.
  const menu = page.getByRole("button", { name: t.assetActions.menu });
  await menu.click();
  await page.getByRole("menuitem", { name: t.assetActions.rename }).click();
  const rename = page.getByRole("dialog", { name: t.assetActions.renameDialog.title });
  const field = rename.getByRole("textbox", { name: t.assetActions.renameDialog.label });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Tong kayu");
  await field.fill("");
  await field.press("Enter");
  await expect(rename.getByText(t.assetActions.renameDialog.empty)).toBeVisible();
  await field.fill("Tong anggur");
  await field.press("Enter");
  await expect(rename).toBeHidden();
  await expect(crumbs.getByText("Tong anggur")).toHaveAttribute("aria-current", "page");
  await expect(menu).toBeFocused();

  // Duplikat: salinan dengan nama bersufiks, aset asal tetap terbuka.
  await menu.click();
  await page.getByRole("menuitem", { name: t.assetActions.duplicate }).click();
  await expect(page.getByText(t.assetActions.duplicated("Tong anggur (salinan)"))).toBeVisible();
  const listed = AssetList.parse(await (await page.request.get("/api/assets?q=gudangaksi&sort=name")).json());
  expect(listed.assets.map((item) => item.name)).toEqual(["Tong anggur", "Tong anggur (salinan)"]);

  // Hapus: konfirmasi, lalu kembali ke Gudang; aset hilang dari daftar dan dari server.
  await menu.click();
  await page.getByRole("menuitem", { name: t.assetActions.delete }).click();
  const remove = page.getByRole("dialog", { name: t.assetActions.deleteDialog.title });
  await expect(remove).toContainText("“Tong anggur” beserta 1 versi");
  await expect(remove.getByRole("button", { name: t.assetActions.deleteDialog.cancel })).toBeFocused();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await remove.getByRole("button", { name: t.assetActions.deleteDialog.confirm }).click();
  await expect(page).toHaveURL(/\/gudang$/);
  // Menu "…" ikut hilang bersama halamannya: fokus pindah ke kolom cari Gudang, bukan jatuh ke `body`.
  await expect(searchBox(page)).toBeFocused();
  await expect(page.getByText(t.assetActions.deleted("Tong anggur"))).toBeVisible();
  expect((await page.request.get(`/api/assets/${id}`)).status()).toBe(404);
  await searchBox(page).fill("gudangaksi");
  await expect(titles(page)).toHaveText(["Tong anggur (salinan)"]);
  expect(problems).toEqual([]);
});

test("Studio: thumbnail versi dan kartu Terakhir dibuat; menu “…” di topbar sesi", async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectConsoleProblems(page);
  const id = await createReady(page.request, { name: "Bangku taman", prompt: "Bangku taman gudangstudio" });

  // Kartu "Terakhir dibuat" memakai thumbnail versi terkini.
  await page.goto("/");
  const recent = page.getByRole("link", { name: /^Bangku taman/ });
  await expect(recent).toBeVisible();
  await expect.poll(() => imageLoaded(recent.locator("img"))).toBe(true);

  await page.goto(`/studio/${id}`);
  await viewerReady(page);
  const versions = page.getByRole("radiogroup", { name: t.versions.label });
  await expect.poll(() => imageLoaded(versions.locator("img").first())).toBe(true);

  // Menu "…" sesi: tanpa "Lanjutkan di Studio"; Ganti nama memperbarui breadcrumb.
  const menu = page.getByRole("button", { name: t.assetActions.menu });
  await menu.click();
  await expect(page.getByRole("menuitem")).toHaveText([
    t.assetActions.export,
    t.assetActions.rename,
    t.assetActions.duplicate,
    t.assetActions.delete,
  ]);
  expect(await seriousA11yViolations(page)).toEqual([]);
  await page.getByRole("menuitem", { name: t.assetActions.rename }).click();
  const field = page.getByRole("textbox", { name: t.assetActions.renameDialog.label });
  await field.fill("Bangku kayu");
  await field.press("Enter");
  const crumbs = page.getByRole("navigation", { name: t.shell.breadcrumb });
  await expect(crumbs.getByText("Bangku kayu")).toHaveAttribute("aria-current", "page");
  await expect(menu).toBeFocused();

  // Hapus dari sesi: kembali ke Studio baru, tanpa layar "Aset sudah dihapus".
  await menu.click();
  await page.getByRole("menuitem", { name: t.assetActions.delete }).click();
  await page
    .getByRole("dialog", { name: t.assetActions.deleteDialog.title })
    .getByRole("button", { name: t.assetActions.deleteDialog.confirm })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: t.studio.promptLabel })).toBeFocused();
  await expect(page.getByText(t.assetActions.deleted("Bangku kayu"))).toBeVisible();
  await expect(page.getByRole("heading", { name: t.session.deleted.title })).toBeHidden();
  expect(problems).toEqual([]);
});

test("tampilan daftar: hapus dari menu baris, fokus pindah ke aset berikutnya lalu ke kolom cari", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await createAllReady(page.request, [
    { name: "Ember dua", prompt: "Ember dua gudanghapus" },
    { name: "Ember satu", prompt: "Ember satu gudanghapus" },
  ]);
  await page.goto("/gudang?q=gudanghapus&sort=name&view=list");
  await expect(titles(page)).toHaveText(["Ember dua", "Ember satu"]);

  const removeVia = async (name: string) => {
    await page.getByRole("button", { name: t.assetActions.menuFor(name) }).click();
    await page.getByRole("menuitem", { name: t.assetActions.delete }).click();
    await page
      .getByRole("dialog", { name: t.assetActions.deleteDialog.title })
      .getByRole("button", { name: t.assetActions.deleteDialog.confirm })
      .click();
    await expect(page.getByText(t.assetActions.deleted(name))).toBeVisible();
  };
  await removeVia("Ember dua");
  await expect(titles(page)).toHaveText(["Ember satu"]);
  await expect(results(page).getByRole("link", { name: "Ember satu" })).toBeFocused();
  await removeVia("Ember satu");
  await expect(searchBox(page)).toBeFocused();
  await expect(page.getByRole("heading", { name: t.gudang.empty.noResults })).toBeVisible();
  expect(problems).toEqual([]);
});

for (const theme of ["dark", "light"] as const) {
  const label = theme === "dark" ? "gelap" : "terang";

  test(`Gudang dan Detail aset, tema ${label}: axe, cincin fokus, turntable saat disorot, screenshot`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const problems = collectConsoleProblems(page);
    const external = collectExternalRequests(page);
    // Kata unik per tema: kedua tes berbagi server.
    const tag = `gudangfoto${label}`;
    const [peti] = await createAllReady(page.request, [
      { name: "Peti harta kayu", prompt: `Peti harta kayu dengan engsel besi ${tag}`, tierId: "sedang" },
      { name: "Lentera besi", prompt: `Lentera besi gantung ${tag}`, tierId: "ringan" },
      { name: "Kursi taman", prompt: `Kursi taman kayu ${tag}`, tierId: "sedang" },
      { name: "Tong anggur", prompt: `Tong anggur dengan simpai ${tag}`, tierId: "maksimal" },
    ]);
    await startWithTheme(page, theme);

    // Turntable: strip dimuat saat kartu disorot (bukan saat halaman dibuka), lalu diputar lewat animasi CSS.
    const strips: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/turntable.webp")) strips.push(request.url());
    });
    await page.goto(`/gudang?q=${tag}`);
    await expect(titles(page)).toHaveCount(4);
    expect(strips).toEqual([]);
    const card = results(page).getByRole("article").filter({ hasText: "Peti harta kayu" });
    const strip = page.waitForResponse((response) =>
      response.url().endsWith(`/${peti}/versions/1/turntable.webp`),
    );
    await card.hover();
    expect((await strip).status()).toBe(200);
    await expect(card.getByText(t.assetCard.turntable)).toBeVisible();
    const animation = await card
      .locator("[data-turntable]")
      .evaluate((element) =>
        element
          .getAnimations()
          .map((running) => [running.playState, getComputedStyle(element).animationName]),
      );
    expect(animation).toEqual([["running", "turntable"]]);

    await page.goto(`/gudang?q=${tag}`);
    await expect(titles(page)).toHaveCount(4);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `gudang-grid-${label}.png`);
    const grid = await focusRingProblems(page);
    expect(grid.problems).toEqual([]);
    // Rel (lewati, 3 tautan, akun), cari, 4 filter, Pilih, Tampilan, Aset baru, 4 kartu.
    expect(grid.stops).toBeGreaterThanOrEqual(17);

    await page.goto(`/gudang?q=${tag}&view=list`);
    await expect(results(page).getByRole("article")).toHaveCount(4);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `gudang-daftar-${label}.png`);
    const list = await focusRingProblems(page);
    expect(list.problems).toEqual([]);

    await page.goto(`/gudang?q=${tag}`);
    await page.getByRole("button", { name: t.gudang.select.toggle, exact: true }).click();
    await page.getByRole("checkbox", { name: t.gudang.select.item("Peti harta kayu") }).check();
    await page.getByRole("checkbox", { name: t.gudang.select.item("Kursi taman") }).check();
    await expect(selectionBar(page).getByRole("status")).toHaveText(t.gudang.select.count("2"));
    await page.mouse.move(0, 0);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `gudang-pilih-${label}.png`);
    const selecting = await focusRingProblems(page);
    expect(selecting.problems).toEqual([]);

    await page.goto(`/gudang/${peti}`);
    await viewerReady(page);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `detail-aset-${label}.png`);
    const detail = await focusRingProblems(page);
    expect(detail.problems).toEqual([]);

    await page.getByRole("button", { name: t.assetDetail.export, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.assetActions.exportDialog.title });
    await expect(
      dialog.getByRole("radio", { name: t.assetActions.exportDialog.presets.web.title }),
    ).not.toContainText(t.assetActions.exportDialog.estimating);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `ekspor-${label}.png`);
    const inDialog = await focusRingProblems(page);
    expect(inDialog.problems).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(problems).toEqual([]);
    expect(external).toEqual([]);
  });
}

test("Gudang kosong untuk pencarian: Empty state dengan Hapus filter, axe bersih", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await page.goto("/gudang?q=tidakadaasetini&tier=ringan");
  await expect(page.getByRole("heading", { name: t.gudang.empty.noResults })).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);
  await saveScreenshot(page, "gudang-tanpa-hasil-gelap.png");
  await page.getByRole("button", { name: t.gudang.empty.clearFilters }).click();
  await expect(page).toHaveURL(/\/gudang$/);
  await expect(searchBox(page)).toHaveValue("");
  expect(problems).toEqual([]);
});

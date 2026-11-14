/**
 * Studio lengkap (Tahap 9) terhadap server mode palsu: `AGENT_DRIVER=fake` (skenario `server/agent/scenarios.ts`,
 * penanda `[tanya]`, `[macet]`) × `RUNTIME_DRIVER=fixture`. Tanpa kuota Claude dan tanpa Docker.
 */
import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import type { ViewerProbeSnapshot } from "../../web/features/viewer/test-hook.ts";
import { t } from "../../web/i18n/id.ts";
import { THEME_STORAGE_KEY } from "../../web/theme-script.ts";
import {
  collectConsoleProblems,
  collectExternalRequests,
  saveScreenshot,
  seriousA11yViolations,
} from "./helpers.ts";

// Resolusi sama dengan ekspor desain (1440×900 @2x), supaya screenshot bisa dibandingkan langsung.
test.use({ deviceScaleFactor: 2 });
// Tes di file ini membuat aset di server bersama: toast "siap direview" dari aset tes lain akan ikut terekam di
// screenshot bila berjalan bersamaan. Jalankan berurutan (project `aset` juga hanya satu worker, setelah tes lain).
test.describe.configure({ mode: "default" });

async function startWithTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme },
  );
}

/** Aset baru dari halaman Studio; hasilnya id aset dari URL sesi. */
async function createAsset(page: Page, prompt: string): Promise<string> {
  await page.goto("/");
  const field = page.getByRole("textbox", { name: t.studio.promptLabel });
  await field.fill(prompt);
  await field.press("Enter");
  await page.waitForURL(/\/studio\/[^/]+$/);
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

const thread = (page: Page) => page.getByRole("region", { name: t.thread.label });
const dockCard = (page: Page, title: string) => page.getByRole("region", { name: title });
const composer = (page: Page) => page.getByRole("textbox", { name: t.composer.label });
/** Chip lampiran di composer dock (lampiran pesan yang sudah terkirim di thread bernama lain). */
const composerChips = (page: Page): Locator =>
  page.getByRole("list", { name: t.composer.pendingAttachments });

/** Viewer sesi sudah memuat model `web.glb` versi itu dan menggambar frame. */
async function viewerShows(page: Page, version: number) {
  await expect(page.getByRole("link", { name: t.session.download })).toHaveAttribute(
    "href",
    new RegExp(`/versions/${version}/web\\.glb$`),
  );
  await page.waitForFunction(() => {
    const probe: { snapshot: () => ViewerProbeSnapshot } | undefined = window.__viewer;
    return probe?.snapshot().ready === true;
  });
}

for (const theme of ["dark", "light"] as const) {
  const label = theme === "dark" ? "gelap" : "terang";

  test(`alur penuh, tema ${label}: pertanyaan → bentuk dasar → revisi dengan tangkapan → setujui → final → selesai`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = collectConsoleProblems(page);
    const external = collectExternalRequests(page);
    await startWithTheme(page, theme);
    await createAsset(page, "Peti harta kayu dengan engsel besi [tanya]");

    // Claude bertanya sebelum brief: composer terkunci sampai kartu dijawab.
    const question = page.getByRole("region", { name: "Gaya peti seperti apa?" });
    await expect(question.getByRole("button", { name: t.question.submit })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
    await expect(dockCard(page, t.dock.waiting.title)).toBeVisible();
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `studio-pertanyaan-${label}.png`);
    await question.getByRole("radio", { name: "Kartun" }).check();
    await question.getByRole("button", { name: t.question.submit }).click();
    await expect(question.getByText("Kartun")).toBeVisible();

    // Bentuk dasar v1 siap direview: brief, kartu build, viewer, dan dock persetujuan.
    const baseReview = dockCard(page, t.dock.baseReview.title("v1"));
    await expect(baseReview).toBeVisible();
    await expect(thread(page).getByRole("region", { name: t.thread.brief.title })).toBeVisible();
    await expect(thread(page).getByText(t.build.done(t.build.stageTitle.base, "v1"))).toBeVisible();
    await viewerShows(page, 1);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `studio-review-${label}.png`);

    // Minta revisi: fokus ke composer, tangkapan viewport ikut sebagai lampiran.
    await baseReview.getByRole("button", { name: t.dock.revise }).click();
    await expect(composer(page)).toBeFocused();
    await page.getByRole("button", { name: t.composer.capture }).click();
    await expect(composerChips(page).getByText(t.composer.captureName(1))).toBeVisible();
    await expect(composerChips(page).getByText(/^PNG · Clay · /)).toBeVisible();
    await composer(page).fill("Tutup sedikit lebih rendah");
    await composer(page).press("Enter");
    await expect(composerChips(page)).toBeHidden();

    const sent = thread(page)
      .getByRole("article", { name: t.thread.owner })
      .filter({ hasText: "Tutup sedikit" });
    await expect(sent.getByText(t.composer.captureName(1))).toBeVisible();
    await expect(dockCard(page, t.dock.baseReview.title("v2"))).toBeVisible();
    await viewerShows(page, 2);

    // Versi lama di panel Detail: viewer dan Unduh ikut berganti.
    await page
      .getByRole("radiogroup", { name: t.versions.label })
      .getByRole("radio", { name: /^v1 / })
      .click();
    await viewerShows(page, 1);

    // Setujui v2 → aset final v3 → Selesai → Unduh GLB.
    await dockCard(page, t.dock.baseReview.title("v2"))
      .getByRole("button", { name: t.dock.baseReview.approve })
      .click();
    await expect(thread(page).getByText(t.thread.actions.approve("v2"))).toBeVisible();
    const finalReview = dockCard(page, t.dock.finalReview.title("v3"));
    await expect(finalReview).toBeVisible({ timeout: 30_000 });
    await viewerShows(page, 3);
    expect(await seriousA11yViolations(page)).toEqual([]);
    await finalReview.getByRole("button", { name: t.dock.finalReview.finish }).click();

    const done = dockCard(page, t.dock.done.title("v3"));
    await expect(done).toBeVisible();
    const link = done.getByRole("link", { name: t.dock.done.download });
    await expect(link).toHaveAttribute("download", "peti-harta-kayu-dengan-engsel-besi-tanya-v3.glb");
    const response = await page.request.get((await link.getAttribute("href")) ?? "");
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 4).toString("latin1")).toBe("glTF");
    expect(await seriousA11yViolations(page)).toEqual([]);
    await saveScreenshot(page, `studio-selesai-${label}.png`);

    expect(problems).toEqual([]);
    expect(external).toEqual([]);
  });
}

type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("elemen tidak terlihat");
  return found;
}

/** Dua kotak bertumpuk (toleransi 0,5 px untuk pembulatan posisi). */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    b.x < a.x + a.width - 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    b.y < a.y + a.height - 0.5
  );
}

function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

// 1440 = desain; 1280 "nyaman" dan 1024 "tetap layak" (PLAN Tahap 7). Viewer sesi = lebar jendela − rel − thread.
for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
] as const) {
  test(`viewer sesi ${size.width}×${size.height}: toolbar, panel Detail, gizmo, dan petunjuk tidak saling menutupi`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await createAsset(page, "Peti kayu");
    await expect(dockCard(page, t.dock.baseReview.title("v1"))).toBeVisible();
    await viewerShows(page, 1);
    const viewer = await box(page.getByRole("region", { name: t.viewer.region }));
    const toolbar = await box(page.getByRole("group", { name: t.viewer.toolbar }));
    const panel = await box(page.getByRole("region", { name: t.detailPanel.title }));
    const gizmo = await box(page.getByRole("toolbar", { name: t.viewer.gizmo.label }));
    const hint = await box(page.getByText(t.viewer.hint));
    for (const part of [toolbar, panel, gizmo, hint]) expect(inside(part, viewer)).toBe(true);
    expect(overlaps(toolbar, panel)).toBe(false);
    expect(overlaps(panel, gizmo)).toBe(false);
    expect(overlaps(hint, gizmo)).toBe(false);
    expect(overlaps(hint, panel)).toBe(false);
    // Desain 02: di lebar penuh panel sejajar toolbar; di viewer sempit panel turun ke bawah toolbar.
    if (size.width === 1440) expect(panel.y).toBe(toolbar.y);
    else expect(panel.y).toBeGreaterThan(toolbar.y + toolbar.height);
    expect(await seriousA11yViolations(page)).toEqual([]);
    // 1440 sudah terekam di alur penuh (`studio-review-gelap.png`).
    if (size.width !== 1440) await saveScreenshot(page, `studio-review-${size.width}-gelap.png`);

    await page.getByRole("button", { name: t.detailPanel.collapse }).click();
    const expand = await box(page.getByRole("button", { name: t.detailPanel.expand }));
    expect(overlaps(toolbar, expand)).toBe(false);
    expect(inside(expand, viewer)).toBe(true);
  });
}

test("reload saat Claude masih bekerja: thread dan dock pulih dari server; Stop menghentikan", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await createAsset(page, "Peti kayu [macet]");
  const working = dockCard(page, t.dock.working.title);
  await expect(working).toBeVisible();
  await expect(thread(page).getByRole("button", { name: /^Proses berpikir/ })).toBeVisible();

  await page.reload();
  await expect(thread(page).getByText("Peti kayu [macet]")).toBeVisible();
  await expect(thread(page).getByRole("button", { name: /^Proses berpikir/ })).toBeVisible();
  await expect(working).toBeVisible();

  await working.getByRole("button", { name: t.dock.stop }).click();
  await expect(working).toBeHidden();
  await expect(thread(page).getByText(t.thread.actions.stop)).toBeVisible();
  await expect(thread(page).getByText(t.thread.stopped)).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  expect(problems).toEqual([]);
});

/** Teks yang masih di-stream saat skenario `[macet]` diam (`HANG_PARTIAL_TEXT` di `server/agent/scenarios.ts`). */
const HANG_PARTIAL_TEXT = "Saya mulai dari kotak dasar, lalu";

test("reload saat Claude masih menulis: potongan stream lama tidak diputar ulang; Stop menghentikan", async ({
  page,
}) => {
  const problems = collectConsoleProblems(page);
  await createAsset(page, "Peti kayu");
  await expect(dockCard(page, t.dock.baseReview.title("v1"))).toBeVisible();
  // Delta hanya dikirim ke halaman yang sudah berlangganan, jadi giliran macet dimulai dari pesan revisi.
  const request = "Engselnya lebih besar [macet]";
  await composer(page).fill(request);
  await composer(page).press("Enter");
  const working = dockCard(page, t.dock.working.title);
  await expect(working).toBeVisible();
  await expect(thread(page).getByText(HANG_PARTIAL_TEXT)).toBeVisible();

  await page.reload();
  await expect(thread(page).getByText(request)).toBeVisible();
  await expect(working).toBeVisible();
  // Delta tidak disimpan server: potongan yang sudah lewat tidak diputar ulang, jadi tidak ada kalimat terpotong atau
  // ganda. Pesan utuhnya datang sebagai event tersimpan.
  await expect(thread(page).getByText(HANG_PARTIAL_TEXT)).toHaveCount(0);

  await working.getByRole("button", { name: t.dock.stop }).click();
  await expect(working).toBeHidden();
  await expect(thread(page).getByText(t.thread.stopped)).toBeVisible();
  await expect(composer(page)).toBeEnabled();
  expect(problems).toEqual([]);
});

test("koneksi terputus: banner tampil; event yang terlewat diputar ulang setelah tersambung", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const servers: WebSocketRoute[] = [];
  let blocked = false;
  let refused = 0;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    // Selama "terputus", percobaan sambung ulang langsung ditutup.
    if (blocked) {
      refused += 1;
      void ws.close();
      return;
    }
    servers.push(ws.connectToServer());
  });
  const id = await createAsset(page, "Peti kayu");
  const review = dockCard(page, t.dock.baseReview.title("v1"));
  await expect(review).toBeVisible();

  blocked = true;
  await Promise.all(servers.splice(0).map((server) => server.close()));
  const banner = page.getByRole("status").filter({ hasText: t.connection.lost });
  await expect(banner).toBeVisible();
  expect(await seriousA11yViolations(page)).toEqual([]);

  // "Sambungkan sekarang" langsung mencoba lagi tanpa menunggu backoff (masih ditolak: banner tetap ada).
  await expect.poll(() => refused).toBeGreaterThan(0);
  const before = refused;
  await banner.getByRole("button", { name: t.connection.reconnect }).click();
  await expect.poll(() => refused).toBeGreaterThan(before);
  await expect(banner).toBeVisible();

  // Aksi lewat HTTP tetap jalan, tetapi event tahap tekstur tidak sampai ke halaman.
  await review.getByRole("button", { name: t.dock.baseReview.approve }).click();
  await expect(dockCard(page, t.dock.working.title)).toBeVisible();
  await expect
    .poll(async () => {
      const body: { asset?: { status?: string } } = await (
        await page.request.get(`/api/assets/${id}`)
      ).json();
      return body.asset?.status;
    })
    .toBe("TEXTURE_REVIEW");
  await expect(dockCard(page, t.dock.working.title)).toBeVisible();

  // Jaringan kembali (event `online` browser): sambung ulang tanpa menunggu sisa backoff.
  blocked = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(banner).toBeHidden({ timeout: 15_000 });
  await expect(dockCard(page, t.dock.finalReview.title("v2"))).toBeVisible();
  // Event yang terlewat (kartu build tekstur, teks Claude) diputar ulang lewat `after`.
  await expect(thread(page).getByText(t.build.done(t.build.stageTitle.textured, "v2"))).toBeVisible();
  await expect(
    thread(page).getByText("Aset final v2 siap direview: kayu tua, logam aus, dan kunci kuningan.", {
      exact: true,
    }),
  ).toBeVisible();
});

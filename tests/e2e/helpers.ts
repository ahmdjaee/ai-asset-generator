import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";

/** Mengumpulkan error/warning console dan error halaman sejak dipanggil. Daftar kosong = bersih. */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      // "Failed to load resource" tidak menyebut file-nya di teks pesan; URL-nya ada di lokasi pesan.
      const resource = message.text().startsWith("Failed to load resource")
        ? ` (${message.location().url})`
        : "";
      problems.push(`${message.type()}: ${message.text()}${resource}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Permintaan ke host selain app ini (CDN, font, analitik). Daftar kosong = semua aset lokal. */
export function collectExternalRequests(page: Page): string[] {
  const external: string[] = [];
  const appHost = new URL(page.url() === "about:blank" ? "http://127.0.0.1" : page.url()).hostname;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.hostname !== "127.0.0.1" && url.hostname !== appHost) external.push(request.url());
  });
  return external;
}

/**
 * Menunggu semua animasi dan transisi CSS yang berhingga selesai (mis. toast yang masih fade-in), supaya axe menilai
 * warna akhir, bukan warna setengah transparan. Animasi tanpa akhir (spinner) diabaikan.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Pelanggaran axe (WCAG 2.1 A/AA) berdampak serius atau kritis setelah animasi selesai. Daftar kosong = lolos. */
export async function seriousA11yViolations(page: Page): Promise<string[]> {
  await settleAnimations(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => {
      // Tiga elemen pertama beserta ringkasan axe-nya, supaya kegagalan bisa langsung dilacak.
      const nodes = violation.nodes
        .slice(0, 3)
        .map(
          (node) =>
            `${node.target.join(" ")} — ${(node.failureSummary ?? "").split("\n").slice(1, 2).join("").trim()}`,
        )
        .join(" | ");
      return `${violation.id}: ${violation.help} (${violation.nodes.length} elemen) ${nodes}`;
    });
}

/**
 * Proporsi piksel elemen yang berbeda jelas dari warna latar. Latar diambil dari piksel di tengah tepi atas,
 * karena sudut elemen bisa terpotong radius. 0 berarti kosong.
 */
export async function nonBackgroundRatio(locator: Locator, threshold = 32): Promise<number> {
  const { data, info } = await sharp(await locator.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const reference = (Math.floor(info.width / 2) + 2 * info.width) * channels;
  const background = [data[reference] ?? 0, data[reference + 1] ?? 0, data[reference + 2] ?? 0];
  let different = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs((data[offset + channel] ?? 0) - (background[channel] ?? 0)) > threshold) {
        different += 1;
        break;
      }
    }
  }
  return different / (info.width * info.height);
}

export type Rgb = [number, number, number];

/** Nilai token warna dari `:root` sebagai (r, g, b). Token berbentuk `#rrggbb` atau `#rgb` (mis. `#fff`). */
export async function tokenRgb(page: Page, token: string): Promise<Rgb> {
  const hex = await page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
    token,
  );
  const value = hex.trim();
  const full = /^#[0-9a-f]{3}$/i.test(value)
    ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}`
    : value;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(full);
  if (!match) throw new Error(`token ${token} bukan #rrggbb atau #rgb: "${hex}"`);
  const channel = (group: number) => Number.parseInt(match[group] ?? "", 16);
  return [channel(1), channel(2), channel(3)];
}

/** Rasio kontras WCAG 2 antara dua warna sRGB (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (color: Rgb) => {
    const [r, g, bl] = color.map((value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Warna piksel (r, g, b) di titik viewport (x, y) dalam px CSS; pada skala 2 diambil piksel kiri atas titik itu. */
/**
 * Warna `count` piksel CSS berurutan di satu baris viewport, mulai dari (x, y). Screenshot berukuran piksel perangkat
 * (`deviceScaleFactor` 2 → 2×2 per piksel CSS); yang dibaca piksel perangkat kiri atas tiap piksel CSS.
 */
export async function viewportPixels(page: Page, x: number, y: number, count: number): Promise<Rgb[]> {
  const png = await page.screenshot({ clip: { x, y, width: count, height: 1 }, animations: "disabled" });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / count;
  return Array.from({ length: count }, (_, index): Rgb => {
    const at = Math.floor(index * scale) * info.channels;
    return [data[at] ?? -1, data[at + 1] ?? -1, data[at + 2] ?? -1];
  });
}

type FocusedRing = {
  name: string;
  style: string;
  width: number;
  color: string;
  /** Piksel di tengah pita cincin (sisi kiri, tengah tinggi); piksel di kirinya masih di dalam pita 2 px. */
  x: number;
  y: number;
  /** Elemen ini sudah pernah diperiksa di putaran Tab yang sama. */
  seen: boolean;
};

/**
 * Cincin fokus elemen yang sedang fokus: gaya outline terhitung dan titik di tengah pita cincin. Cincin kartu aset
 * digambar di `<article>`, bukan di tautan judulnya. `null` bila fokus tidak berada di elemen halaman.
 */
function focusedRing(page: Page): Promise<FocusedRing | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return null;
    const probe = window as Window & { __focusSeen?: WeakSet<Element> };
    probe.__focusSeen ??= new WeakSet();
    const seen = probe.__focusSeen.has(active);
    probe.__focusSeen.add(active);
    // Kartu aset menggambar cincin di `article` (`has-focus-visible`), bukan di tautan di dalamnya. Elemen lain di
    // dalam `article` (mis. tombol di grup pesan Claude) menggambar cincinnya sendiri.
    const own = getComputedStyle(active);
    const owner = own.outlineStyle === "none" ? (active.closest("article") ?? active) : active;
    const style = owner === active ? own : getComputedStyle(owner);
    const box = owner.getBoundingClientRect();
    const width = Number.parseFloat(style.outlineWidth) || 0;
    const offset = Number.parseFloat(style.outlineOffset) || 0;
    const label = active.getAttribute("aria-label") || active.textContent?.trim() || active.id;
    return {
      name: `${active.tagName.toLowerCase()} "${label.slice(0, 40)}"`,
      style: style.outlineStyle,
      width,
      color: style.outlineColor,
      x: Math.max(0, Math.floor(box.left - offset - width / 2)),
      y: Math.floor(box.top + box.height / 2),
      seen,
    };
  });
}

/**
 * Masalah cincin fokus elemen yang sedang fokus, atau `null` bila cincin benar-benar tergambar: outline padat
 * ≥2 px berwarna `ring` (gaya terhitung) dan piksel di tengah pita cincin berwarna sama. Gaya terhitung saja tidak
 * cukup: cincin bisa tertutup atau terpotong.
 */
export async function focusRingProblem(page: Page, ring: Rgb): Promise<string | null> {
  // `transition-colors` ikut mentransisikan `outline-color`: baca setelah transisi selesai.
  await settleAnimations(page);
  const focused = await focusedRing(page);
  if (!focused) return "tidak ada elemen yang fokus";
  const expected = `rgb(${ring.join(", ")})`;
  if (focused.style !== "solid" || focused.width < 2 || focused.color !== expected) {
    return `${focused.name}: outline ${focused.style} ${focused.width}px ${focused.color}, harus solid 2px ${expected}`;
  }
  // Dua piksel pita cincin 2 px. Skia menghaluskan tepi dalam outline yang membulat (±97% warna cincin) walau
  // posisinya bulat, jadi cukup satu piksel yang sama persis. Cincin yang tertutup atau terpotong tetap gagal.
  const left = Math.max(0, focused.x - 1);
  const pixels = await viewportPixels(page, left, focused.y, focused.x - left + 1);
  const matches = (pixel: Rgb) =>
    pixel.every((channel, index) => Math.abs(channel - (ring[index] ?? 0)) <= 6);
  if (!pixels.some(matches)) {
    const seen = pixels.map((pixel) => pixel.join(",")).join(" | ");
    return `${focused.name}: piksel cincin di (${left}…${focused.x}, ${focused.y}) = ${seen}, harus ${ring.join(",")}`;
  }
  return null;
}

/**
 * Menekan Tab dari awal halaman (panggil tepat setelah `goto`) sampai fokus keluar dari dokumen atau kembali ke
 * elemen yang sudah diperiksa, lalu memeriksa cincin fokus setiap pemberhentian terhadap token `accent-ring`.
 * Mengembalikan jumlah pemberhentian dan daftar masalah (kosong = semua cincin terlihat).
 */
export async function focusRingProblems(
  page: Page,
  maxStops = 150,
): Promise<{ stops: number; problems: string[] }> {
  const ring = await tokenRgb(page, "--color-accent-ring");
  const problems: string[] = [];
  let stops = 0;
  while (stops < maxStops) {
    await page.keyboard.press("Tab");
    const focused = await focusedRing(page);
    if (!focused || focused.seen) break;
    stops += 1;
    const problem = await focusRingProblem(page, ring);
    if (problem) problems.push(problem);
  }
  return { stops, problems };
}

/**
 * Menyimpan screenshot bukti tahap bila `SCREENSHOT_DIR` diisi (mis. `docs/progress/tahap-07`). Tanpa env itu tidak
 * ada file yang ditulis, supaya tes rutin tidak mengubah working tree.
 * `fullPage`: app menggulir di dalam `main` (kerangka `h-dvh`), jadi `fullPage` bawaan Playwright memotong isi.
 * Viewport dibuat setinggi isi terpanjang di `main` selama pemotretan, lalu dikembalikan.
 */
export async function saveScreenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const viewport = page.viewportSize();
  if (options.fullPage && viewport) {
    const height = await page
      .getByRole("main")
      .evaluate((main) =>
        Math.max(
          main.scrollHeight,
          ...Array.from(main.querySelectorAll("*"), (element) => element.scrollHeight),
        ),
      );
    await page.setViewportSize({
      width: viewport.width,
      height: Math.max(viewport.height, Math.ceil(height)),
    });
  }
  await page.screenshot({ path: join(dir, name), animations: "disabled" });
  if (options.fullPage && viewport) await page.setViewportSize(viewport);
}

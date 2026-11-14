import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { REDUCED_MOTION_QUERY } from "@/lib/use-media-query.ts";
import { renderUi } from "@/test-utils.tsx";
import { AssetCard, type AssetCardProps } from "./AssetCard.tsx";
import { TooltipProvider } from "./ui/tooltip.tsx";

/** Pembungkus tetap untuk `rerender` (prop berubah, komponen tidak dipasang ulang). */
function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </TooltipProvider>
  );
}

/** MediaQueryList tetap untuk "animasi dikurangi" (tanpa perubahan selama tes). */
class StaticMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  readonly matches: boolean;
  onchange: MediaQueryList["onchange"] = null;

  constructor(media: string, reduced: boolean) {
    super();
    this.media = media;
    this.matches = media === REDUCED_MOTION_QUERY && reduced;
  }

  addListener(): void {}
  removeListener(): void {}
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const BASE: AssetCardProps = {
  name: "Peti harta kayu",
  href: "/gudang/peti",
  thumbnail: "/api/assets/peti/versions/2/thumb.webp",
  turntable: "/api/assets/peti/versions/2/turntable.webp",
  badge: { tone: "success", label: "Final" },
  tier: "sedang",
  time: "2 jam lalu",
  info: "3,4k segitiga · 612 KB",
};

const loader = () => document.querySelector<HTMLImageElement>("img[data-turntable-loader]");
const strip = () => document.querySelector<HTMLElement>("[data-turntable]");

describe("AssetCard", () => {
  test("judul adalah tautan ke aset; badge, tier, waktu, dan info tampil", () => {
    renderUi(
      <AssetCard
        name="Peti harta kayu"
        href="/aset/a1"
        badge={{ tone: "success", label: "Final" }}
        tier="sedang"
        time="2 jam lalu"
        info="3,4k segitiga · 612 KB"
      />,
    );
    const card = screen.getByRole("article");
    expect(screen.getByRole("heading", { level: 3, name: "Peti harta kayu" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Peti harta kayu" }).getAttribute("href")).toBe("/aset/a1");
    expect(card.textContent).toContain("Final");
    expect(card.textContent).toContain("Sedang");
    expect(card.textContent).toContain("2 jam lalu");
    expect(card.textContent).toContain("3,4k segitiga · 612 KB");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("proses berjalan: bar progres bernama dengan nilai persen", () => {
    renderUi(
      <AssetCard
        name="Kanister energi"
        href="/aset/a2"
        badge={{ tone: "accent", label: "Membuat…" }}
        tier="ringan"
        time="baru saja"
        info="Tahap 2 · 62%"
        progress={0.62}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Progres Kanister energi" });
    expect(bar.getAttribute("aria-valuenow")).toBe("62");
  });

  test("keyboard: Tab langsung ke tautan kartu", async () => {
    const { user } = renderUi(
      <AssetCard
        name="Lentera besi"
        href="/aset/a3"
        badge={{ tone: "success", label: "Final" }}
        tier="maksimal"
        time="3 jam lalu"
        info="12k segitiga · 2,1 MB"
      />,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Lentera besi" }));
  });

  test("turntable: strip baru diminta saat kartu disorot, lalu diputar; chip 360° tampil setelah strip dimuat", async () => {
    const { user } = renderUi(<AssetCard {...BASE} />);
    const thumb = screen.getByRole("article").querySelector("img");
    expect(thumb?.getAttribute("src")).toBe(BASE.thumbnail);
    expect(loader()).toBeNull();
    await user.hover(screen.getByRole("article"));
    expect(loader()?.getAttribute("src")).toBe(BASE.turntable);
    expect(strip()).toBeNull();
    fireEvent.load(loader() ?? document.body);
    expect(strip()?.style.backgroundImage).toContain(BASE.turntable ?? "");
    expect(strip()?.style.backgroundSize).toBe("2400% 100%");
    expect(strip()?.style.animation).toContain("steps(24, jump-none)");
    expect(screen.getByRole("article").textContent).toContain("360°");
  });

  test("fokus keyboard juga memuat turntable", async () => {
    const { user } = renderUi(<AssetCard {...BASE} />);
    await user.tab();
    expect(loader()?.getAttribute("src")).toBe(BASE.turntable);
  });

  test("animasi dikurangi: strip tidak dimuat, thumbnail diam saja", async () => {
    window.matchMedia = (query: string) => new StaticMediaQueryList(query, true);
    const { user } = renderUi(<AssetCard {...BASE} />);
    await user.hover(screen.getByRole("article"));
    expect(loader()).toBeNull();
    expect(screen.getByRole("article").textContent).not.toContain("360°");
  });

  test("thumbnail yang gagal dimuat disembunyikan (hanya latar viewport)", () => {
    renderUi(<AssetCard {...BASE} turntable={undefined} />);
    const thumb = screen.getByRole("article").querySelector("img");
    fireEvent.error(thumb ?? document.body);
    expect(screen.getByRole("article").querySelector("img")).toBeNull();
  });

  test("versi baru (URL lain): thumbnail yang tadi gagal dicoba lagi, strip baru menunggu dimuat", async () => {
    const V3 = {
      thumbnail: "/api/assets/peti/versions/3/thumb.webp",
      turntable: "/api/assets/peti/versions/3/turntable.webp",
    };
    const view = render(<AssetCard {...BASE} />, { wrapper: Providers });
    const user = userEvent.setup();
    fireEvent.error(screen.getByRole("article").querySelector("img") ?? document.body);
    await user.hover(screen.getByRole("article"));
    fireEvent.load(loader() ?? document.body);
    expect(strip()).not.toBeNull();

    view.rerender(<AssetCard {...BASE} {...V3} />);
    const thumb = screen.getByRole("article").querySelector("img:not([data-turntable-loader])");
    expect(thumb?.getAttribute("src")).toBe(V3.thumbnail);
    expect(loader()?.getAttribute("src")).toBe(V3.turntable);
    expect(strip()).toBeNull();
    expect(screen.getByRole("article").textContent).not.toContain("360°");
    fireEvent.load(loader() ?? document.body);
    expect(strip()?.style.backgroundImage).toContain(V3.turntable);
  });

  describe("mode pilih", () => {
    test("kotak centang bernama; klik di kartu memilih; tanpa tautan; terpilih bergaris aksen", async () => {
      const onToggle = mock();
      const { user, rerender } = renderUi(
        <AssetCard
          {...BASE}
          selection={{ selected: false, disabled: false, label: "Pilih Peti harta kayu", onToggle }}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      const box = screen.getByRole("checkbox", { name: "Pilih Peti harta kayu" });
      expect(box.getAttribute("aria-checked")).toBe("false");
      await user.click(screen.getByText("Peti harta kayu"));
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("article").className).toContain("border-border-default");
      rerender(
        <AssetCard
          {...BASE}
          selection={{ selected: true, disabled: false, label: "Pilih Peti harta kayu", onToggle }}
        />,
      );
      expect(
        screen.getByRole("checkbox", { name: "Pilih Peti harta kayu" }).getAttribute("aria-checked"),
      ).toBe("true");
      expect(screen.getByRole("article").className).toContain("border-accent-solid");
    });

    test("aset tanpa versi: kotak centang nonaktif, klik diabaikan", async () => {
      const onToggle = mock();
      const { user } = renderUi(
        <AssetCard
          {...BASE}
          selection={{ selected: false, disabled: true, label: "Peti belum punya versi", onToggle }}
        />,
      );
      expect(screen.getByRole("checkbox", { name: "Peti belum punya versi" }).hasAttribute("disabled")).toBe(
        true,
      );
      await user.click(screen.getByText("Peti harta kayu"));
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});

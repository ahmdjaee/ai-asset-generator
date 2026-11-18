import type { RouteObject } from "react-router";
import { GudangPage } from "@/features/gudang/GudangPage.tsx";
import { SettingsPage } from "@/features/settings/SettingsPage.tsx";
import { StudioNewPage } from "@/features/studio/StudioNewPage.tsx";
import { AppLayout } from "./AppLayout.tsx";
import { NotFoundPage, PageErrorPage, RouteErrorPage, RouteLoading } from "./pages.tsx";

const SMOKE_PATH = "/_smoke";
const GALLERY_PATH = "/_komponen";
const VIEWER_PATH = "/_viewer";

/**
 * Halaman uji internal hanya ada di Vite dev dan build mode test (dipakai E2E). Di build produksi kondisi ini
 * menjadi `false` saat build, sehingga chunk-nya tidak ikut dibuat; `scripts/check-bundle.ts` (setelah
 * `bun run build`) gagal bila kode halaman uji ikut ke build produksi.
 */
const smokeEnabled = import.meta.env.DEV || import.meta.env.MODE === "test";

const smokeRoutes: RouteObject[] = smokeEnabled
  ? [
      {
        path: SMOKE_PATH.slice(1),
        lazy: async () => {
          const { SmokePage } = await import("@/features/smoke/SmokePage.tsx");
          return { Component: SmokePage };
        },
      },
      {
        path: GALLERY_PATH.slice(1),
        lazy: async () => {
          const { ComponentsPage } = await import("@/features/smoke/ComponentsPage.tsx");
          return { Component: ComponentsPage };
        },
      },
      {
        path: VIEWER_PATH.slice(1),
        lazy: async () => {
          const { ViewerPage } = await import("@/features/smoke/ViewerPage.tsx");
          return { Component: ViewerPage };
        },
      },
    ]
  : [];

/** Halaman di dalam kerangka app (rel + area utama). */
export const pageRoutes: RouteObject[] = [
  { index: true, Component: StudioNewPage },
  {
    path: "studio/:assetId",
    // Sesi aset dimuat terpisah: thread-nya memakai streamdown (parser markdown + HTML) yang tidak dibutuhkan
    // halaman lain. Tanpa ini chunk utama melewati batas 1200 kB.
    lazy: async () => {
      const { StudioSessionPage } = await import("@/features/studio/StudioSessionPage.tsx");
      return { Component: StudioSessionPage };
    },
  },
  { path: "gudang", Component: GudangPage },
  {
    path: "gudang/:assetId",
    // Detail aset memakai viewer 3D (lazy) dan panel detail Studio; chunk-nya terpisah seperti sesi Studio.
    lazy: async () => {
      const { AssetDetailPage } = await import("@/features/gudang/AssetDetailPage.tsx");
      return { Component: AssetDetailPage };
    },
  },
  { path: "pengaturan", Component: SettingsPage },
  ...smokeRoutes,
  { path: "*", Component: NotFoundPage },
];

/**
 * Dua lapis error boundary: error halaman tampil di area utama (`PageErrorPage`, rel tetap ada); error kerangka app
 * sendiri memakai `RouteErrorPage` layar penuh.
 */
export function buildRoutes(pages: RouteObject[]): RouteObject[] {
  return [
    {
      path: "/",
      Component: AppLayout,
      ErrorBoundary: RouteErrorPage,
      HydrateFallback: RouteLoading,
      children: [{ ErrorBoundary: PageErrorPage, children: pages }],
    },
  ];
}

export const routes: RouteObject[] = buildRoutes(pageRoutes);

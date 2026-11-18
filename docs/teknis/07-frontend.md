# Frontend

Susunan app web React: rute, kerangka, data server dan realtime, komponen, tema, aksesibilitas, dan viewer 3D.

## Titik masuk
| File | Isi |
|---|---|
| [`web/main.tsx`](../../web/main.tsx) | Font Inter, `globals.css`, `<App />` di dalam `StrictMode` |
| [`web/app/App.tsx`](../../web/app/App.tsx) | `QueryClientProvider` → `LucideProvider` → `TooltipProvider` → `RouterProvider` + `Toaster`; memasang toast error global |
| [`web/app/routes.tsx`](../../web/app/routes.tsx) | Daftar rute dan error boundary |
| [`web/app/AppLayout.tsx`](../../web/app/AppLayout.tsx) | Kerangka app |

## Rute
Didefinisikan di `pageRoutes`, lalu dibungkus `buildRoutes` di [`web/app/routes.tsx`](../../web/app/routes.tsx).

| Path | Komponen | Dimuat |
|---|---|---|
| `/` | `StudioNewPage` | chunk utama |
| `/studio/:assetId` | `StudioSessionPage` | lazy (thread memakai streamdown) |
| `/gudang` | `GudangPage` | chunk utama |
| `/gudang/:assetId` | `AssetDetailPage` | lazy (viewer + panel detail) |
| `/pengaturan` | `SettingsPage` | chunk utama |
| `/_smoke`, `/_komponen`, `/_viewer` | halaman uji di `web/features/smoke/` | lazy, **hanya dev dan build mode test** |
| `*` | `NotFoundPage` | chunk utama |

- **Halaman uji:** `smokeEnabled = import.meta.env.DEV || import.meta.env.MODE === "test"`. Di build produksi
  kondisinya `false` saat build, jadi chunk-nya tidak dibuat. `scripts/check-bundle.ts` gagal bila penandanya ikut.
- **Error boundary dua lapis:** `PageErrorPage` untuk error satu halaman (render gagal, chunk lazy gagal diunduh)
  tampil di area utama, rel tetap ada. `RouteErrorPage` layar penuh untuk error kerangka app sendiri. Keduanya di
  [`web/app/pages.tsx`](../../web/app/pages.tsx).

## Kerangka app
`AppLayout` menyusun:
- tautan "Lewati ke konten utama" (hanya terlihat saat fokus keyboard) ke `<main id="konten">`;
- `AssetWatcher` dan `StatusWatcher` (penyimak realtime untuk seluruh app, tanpa UI);
- `Rail` ([`web/app/shell/Rail.tsx`](../../web/app/shell/Rail.tsx)): logo, Studio, Gudang, Pengaturan, dan menu akun
  (chip akun, tautan Pengaturan, pilihan tema). Titik indikator proses tampil saat `useStudioBusy()` benar;
- `<main>` berisi halaman. Setiap halaman memasang `Topbar` sendiri
  ([`web/app/shell/Topbar.tsx`](../../web/app/shell/Topbar.tsx)); `<header>`-nya ada di dalam `<main>`.

## Data server
- **Client HTTP:** `api = hc<AppType>(origin).api` di [`web/lib/api.ts`](../../web/lib/api.ts). Rute dan bentuk respons
  dicek compiler dari tipe `AppType` server. Respons gagal diubah `toApiError` menjadi `ApiError` dengan `code` stabil.
- **TanStack Query:** `createQueryClient` di [`web/lib/query.ts`](../../web/lib/query.ts): `retry: 1`,
  `refetchOnWindowFocus: false`, `staleTime` = `QUERY_STALE_TIME_MS` (sekarang 30 dtk). Kunci query dan hook per domain
  ada di `web/lib/` (`assets.ts`, `health.ts`, `settings.ts`) dan `queries.ts` di folder fitur.
- **Tanpa polling.** Data segar datang dari event WebSocket.

### Realtime
| File | Peran |
|---|---|
| [`web/lib/realtime.ts`](../../web/lib/realtime.ts) | `RealtimeClient`: satu WebSocket per tab, sambung ulang dengan backoff + jitter, kirim ulang semua langganan dengan `after`, deteksi senyap (`SILENCE_MS`) dan handshake macet (`HANDSHAKE_MS`), pesan server divalidasi zod |
| [`web/lib/realtime-context.tsx`](../../web/lib/realtime-context.tsx) | `useRealtime()` (dari `RealtimeProvider` di tes, selain itu klien bersama), `useConnectionState()` |
| [`shared/realtime.ts`](../../shared/realtime.ts) | Protokol: `sub`/`unsub`, topik `global` dan `asset:<id>`, event |

Pemakai langganan:
- `useAssetWatcher` ([`web/features/studio/AssetWatcher.tsx`](../../web/features/studio/AssetWatcher.tsx)), topik
  `global`: event `asset` menginvalidasi daftar dan detail aset, `asset_progress` digabung ke cache
  (`mergeBuildProgress`), aset yang dihapus ditandai `markAssetDeleted` (tanpa mengambil detail yang pasti 404).
- `StatusWatcher` ([`web/features/status/StatusWatcher.tsx`](../../web/features/status/StatusWatcher.tsx)), topik
  `global`: event `settings`, `auth`, `runtime` menginvalidasi query terkait.
- `ThreadStore` ([`web/features/studio/thread-store.ts`](../../web/features/studio/thread-store.ts)), topik
  `asset:<id>`: thread sesi dengan replay `after`. Event yang mengubah detail aset di-merge atau menginvalidasi lewat
  `applyThreadEvent` (`web/features/studio/use-asset-thread.ts`).

Topik `global` tidak di-replay, jadi `onReady` (termasuk setelah sambung ulang) mengambil ulang query terkait. Saat
sambungan `reconnecting`, `ReconnectBanner` tampil. Protokol server dijelaskan di [API](04-api.md).

## Status kesehatan
- Query akun dan runtime di [`web/lib/health.ts`](../../web/lib/health.ts) (`useAuthStatus`, `useRuntimeStatus`) dengan
  pemeta masalah `accountProblem` dan `runtimeProblem`.
- Banner akun/runtime di [`web/features/status/StatusBanners.tsx`](../../web/features/status/StatusBanners.tsx), dipasang
  oleh halaman Studio, Gudang, dan Detail aset.
- `StatusWatcher` menjaga datanya segar lewat realtime (bagian di atas).

## Komponen
| Folder | Isi | Aturan |
|---|---|---|
| [`web/components/ui/`](../../web/components/ui/) | Komponen dasar (shadcn/Radix) yang sudah memakai token: button, dialog, menu, tooltip, toast, … | Ambil sumber lewat `bunx shadcn add <nama> --view`, import `cn` dari `@/lib/utils.ts` |
| [`web/components/`](../../web/components/) | Komponen bersama lintas fitur (`AssetCard`, `Markdown`, `Tier`, `EmptyState`, `LiveStatus`, …) | |
| `web/features/<fitur>/` | Komponen dan logika per fitur: `studio`, `gudang`, `viewer`, `settings`, `status`, `asset-actions`, `smoke` | |

Galeri `/_komponen` ([`web/features/smoke/ComponentsPage.tsx`](../../web/features/smoke/ComponentsPage.tsx)) memuat
komponen dasar dalam setiap state-nya untuk axe dan screenshot E2E (`tests/e2e/components.e2e.ts`). Komponen dasar baru
ikut ditambahkan ke sana.

## Token dan tema
- **Token:** [`web/styles/tokens.css`](../../web/styles/tokens.css) dan `tokens.ts` dihasilkan `bun run tokens:sync` dari
  ekspor FigCraft di `design/tokens/`. Jangan diedit manual; `--check` hanya membandingkan.
- **`@theme static`**, bukan `inline`: tema gelap = bawaan (`:root`), tema terang = `[data-theme="light"]`. Ukuran teks
  bawaan Tailwind dibuang (`--text-*: initial`); pakai text style FigCraft (`text-body`, `text-label`, …).
- **Tanpa warna mentah**, gradien, atau glow di komponen ([AGENTS §2](../../AGENTS.md#2-produk--desain)).
- **Skrip tema:** `themeBootScript()` di [`web/theme-script.ts`](../../web/theme-script.ts) disisipkan ke `<head>` oleh
  `vite.config.ts`, jadi tema terpasang sebelum render pertama. Store di [`web/theme.ts`](../../web/theme.ts)
  melanjutkannya: simpan pilihan (`aag-theme`), ikuti tema sistem, samakan tab lain. Bawaan: gelap.
- **Gaya global:** [`web/styles/globals.css`](../../web/styles/globals.css): cincin fokus global, pemetaan markdown,
  penimpaan sonner, dan `prefers-reduced-motion`.

## Teks UI
- Semua teks UI di `t` dalam [`web/i18n/id.ts`](../../web/i18n/id.ts).
- Teks khusus halaman uji di `tSmoke` (file yang sama), supaya tidak ikut ke build produksi.
- Teks dari Claude dirender lewat `Markdown` ([Keamanan](06-keamanan.md#web-teks-claude)).

## Ikon
`lucide-react` lewat `LucideProvider` di `App.tsx` (`strokeWidth={1.5}`, `nonScalingStroke`). Ukuran mengikuti
komponen (lihat [AGENTS §8](../../AGENTS.md#8-web-react)). Ikon yang digambar berbeda dari FigCraft ditulis ulang lewat
`createLucideIcon` di `web/features/viewer/icons.ts`.

## Aksesibilitas
- **Fokus:** cincin fokus hanya dari aturan global `:focus-visible` di `globals.css`; komponen hanya mengatur jaraknya.
  Jangan `outline-none` pada elemen interaktif.
- **Fokus setelah navigasi:** [`web/lib/arrival-focus.ts`](../../web/lib/arrival-focus.ts) memindah fokus ke elemen utama
  halaman tujuan saat elemen asalnya hilang (mis. aset dihapus).
- **Live region:** pasang wadah `role="status"` sejak awal lalu isi teksnya, seperti
  [`web/components/LiveStatus.tsx`](../../web/components/LiveStatus.tsx).
- **Menu** di `web/components/ui/menu.tsx` tidak modal secara bawaan (menu modal Radix memicu axe `aria-hidden-focus`).
- **Gerak:** `prefers-reduced-motion` dihormati di `globals.css`; animasi memakai `motion-safe:`.
- **Diuji** di E2E dengan axe (`seriousA11yViolations`) dan pemeriksa cincin fokus (`focusRingProblems`) di
  `tests/e2e/helpers.ts`.

## Viewer 3D
Semua di [`web/features/viewer/`](../../web/features/viewer/).

| Aspek | Di mana |
|---|---|
| Lazy chunk | `LazyViewer.tsx`: `lazy(() => import("./Viewer.tsx"))`; three, R3F, drei hanya dimuat saat viewer tampil |
| Render sesuai kebutuhan | `Viewer.tsx`: `<Canvas frameloop="demand">`; `ViewerScene.tsx` memanggil `invalidate()` setelah perubahan |
| Model | `ViewerScene.tsx`: `useGLTF(src, false, true)` (Draco mati, meshopt aktif) |
| Cahaya lingkungan | `RoomEnvironment` three sebagai PMREM, lokal; tanpa preset `Environment` drei (CDN) |
| Dispose | `lifetime.ts`: `hold`/`holdCached` menghitung pemakai dan menunda dispose ke microtask, aman di StrictMode |
| Tanpa WebGL2 | `Viewer.tsx` mengecek `getContext("webgl2")` dan punya jalur tanpa WebGL2; konteks hilang ditangani lewat `webglcontextlost` |
| Kamera, preset, gizmo, pintasan | `camera.ts`, `math.ts`, `AxisGizmo.tsx`, `shortcuts.ts`, `ViewerToolbar.tsx` |
| Probe E2E | `test-hook.ts`: `window.__viewer`, hanya bila `import.meta.env.MODE === "test"` (`PROBE_ENABLED`) |

Perilaku untuk pemakai ada di [Viewer 3D](../fitur/03-viewer.md).

## Notifikasi dan toast
- **Toast:** `notify` dan `Toaster` di [`web/components/ui/toast.tsx`](../../web/components/ui/toast.tsx) (sonner).
- **Toast status aset:** `AssetWatcher` memberi toast saat aset lain siap direview, selesai, gagal, atau menunggu
  jawaban. Id per aset (`statusToastId`), jadi toast baru menggantikan yang lama; aset yang sedang dibuka tidak diberi
  toast.
- **Notifikasi browser:** [`web/lib/notifications.ts`](../../web/lib/notifications.ts). Izin diminta dari Pengaturan;
  `showBackgroundNotification` hanya tampil bila izin `granted` dan tab tidak sedang dilihat.
- **Toast error global:** `installGlobalErrorToast` di [`web/lib/global-errors.ts`](../../web/lib/global-errors.ts)
  menyimak `error` dan `unhandledrejection` di `window`. Satu id toast, jadi error beruntun tidak menumpuk; `AbortError`
  diabaikan.

## Lihat juga
- [Arsitektur](01-arsitektur.md)
- [API](04-api.md)
- [Keamanan](06-keamanan.md)
- [Tes](08-tes.md)
- [Menambah fitur](09-menambah-fitur.md)
- [Viewer 3D (fitur)](../fitur/03-viewer.md)
- [`TECH_STACK.md`](../TECH_STACK.md)
- [`AGENTS.md`](../../AGENTS.md)

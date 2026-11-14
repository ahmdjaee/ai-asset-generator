# Tahap 0 — Fondasi & gerbang kompatibilitas

| | |
|---|---|
| Tanggal | 2026-11-13 |
| Status | menunggu review |
| Kondisi repo | belum di-commit (`git init` di branch `main`, belum ada commit) |

## Ringkasan
- **Fondasi repo:**
  - tooling: Bun + TypeScript 7 strict, Biome, lefthook;
  - server Hono: health, WebSocket echo, pagar Host/Origin, SQLite + migrasi;
  - web: React + Vite + Tailwind dengan token FigCraft, tema gelap/terang, dan Button shadcn;
  - halaman uji `/_smoke`: streamdown + kubus R3F;
  - tes: unit, komponen, dan E2E + axe.
- **Kompatibilitas:** semua library terpilih terbukti berjalan bersama di mesin ini. Temuannya dicatat di Status
  kompatibilitas `docs/TECH_STACK.md`.
- **DoD:** semua butir Definition of Done terpenuhi. Dua hal kecil dipindah:
  - backpressure WebSocket → Tahap 6;
  - uji dispose R3F → Tahap 8.
- **Port:** app pindah ke **4340/4341** karena 4330/4331 sudah dipakai proyek lain di mesin ini.

## Yang dikerjakan
- **Repo dan tooling:**
  - `.gitignore`, `.editorconfig`, `.env.example`;
  - `package.json` (versi exact) dan `bun.lock`;
  - `tsconfig.json`, `tsconfig.server.json`, `tsconfig.web.json`;
  - `biome.json`, `lefthook.yml`.
- **Dev runner** (`scripts/dev.ts`):
  - menjalankan server `bun --watch` dan Vite bersama;
  - mengecek port dulu;
  - Ctrl+C menghentikan keduanya dengan bersih.
- **Server:**
  - `server/main.ts`: `127.0.0.1:4340`, `idleTimeout` 120 dtk, `maxPayloadLength` 64 KB;
  - `server/app.ts`: `AppType`; menyajikan `dist/` dengan header cache;
  - `server/config.ts` (zod, `agentEnv()`), `server/http/guard.ts`, `server/http/errors.ts`;
  - `server/http/routes/health.ts`, `server/realtime/echo.ts`, `server/log.ts` (pino).
- **Database:**
  - `server/db/client.ts`: WAL, `foreign_keys`, `busy_timeout`;
  - `server/db/schema.ts`: tabel `meta`;
  - migrasi `server/db/migrations/0000_init.sql` dan `drizzle.config.ts`.
- **Agent SDK:**
  - `server/agent/sdk-adapter.ts`, satu-satunya file yang meng-import `query`;
  - `scripts/check-auth.ts`.
- **Token desain:**
  - sumber: `design/tokens/figcraft-variables.json` dan `figcraft-text-styles.json`;
  - generator: `scripts/sync-tokens.ts`;
  - hasil: `web/styles/tokens.css` dan `web/styles/tokens.ts`.
- **Web:**
  - `web/main.tsx`;
  - `web/app/`: router, layout sementara, placeholder Studio/Gudang/Pengaturan, halaman 404 dan error;
  - `web/lib/`: client `hc`, TanStack Query, status server;
  - `web/theme-script.ts` + `web/theme.ts`: tema diterapkan sebelum render pertama;
  - `web/components/ThemeToggle.tsx`, `ServerStatus.tsx`, `ui/button.tsx`;
  - teks UI di `web/i18n/id.ts`.
- **Halaman uji `/_smoke`** (`web/features/smoke/`, hanya di mode dev dan test):
  - Button;
  - streamdown;
  - kubus R3F dengan `CameraControls` dan gizmo;
  - status echo WebSocket.
- **Tes:**
  - server dan skrip: `server/**/*.test.ts`, `scripts/*.test.ts`;
  - smoke import: `tests/smoke/imports.test.ts`;
  - komponen: `web/**/*.test.ts(x)`;
  - E2E: `tests/e2e/smoke.e2e.ts` dan `playwright.config.ts`.
- **Dokumen:**
  - `docs/TECH_STACK.md`: Status kompatibilitas;
  - `docs/PLAN.md`: checklist dan Log keputusan;
  - `AGENTS.md`: port, perintah, dan jebakan baru.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun install --frozen-lockfile` | lolos; 681 instalasi dicek, lockfile tidak berubah |
| `bun run check` | lolos dalam ±1,9 dtk; detail di bawah tabel |
| `bun run build` | lolos tanpa warning; hasilnya tidak memuat kode maupun teks `/_smoke` (dicek dengan grep) |
| `bun run build:test` | lolos tanpa warning |
| `bun run e2e:smoke` | lolos 8/8 dalam 4,0 dtk (Chromium SwiftShader, kedua tema); detail di bawah tabel |
| `bun run check:auth` | lolos tanpa panggilan model; email akun tampil, `apiKeySource: none (tidak dilaporkan SDK)`, `apiProvider: firstParty` |
| `bun run dev` | `http://127.0.0.1:4341` tampil di kedua tema; detail di bawah tabel |
| `bun run dev` saat port API sudah dipakai (diuji dengan `PORT=4399` dan listener dummy) | berhenti dengan pesan "Port 4399 (API) sudah dipakai proses lain…" (exit 1) |
| Probe aturan Biome (file sementara, sudah dihapus) | `noFloatingPromises` menandai `simpan();` dan tidak menandai `void simpan().catch(…)`. `noExplicitAny` dan larangan `process`/`Bun` di `web/` aktif |

Rincian:
- **`bun run check`:**
  - Biome: 69 file bersih;
  - `tsc` server dan web: 0 error;
  - 174 tes, 0 gagal: 132 server/skrip/smoke dan 42 web.
- **`bun run e2e:smoke`:**
  - console bersih dan axe 0 masalah serius/kritis;
  - kanvas tidak kosong; streamdown merender heading dan list;
  - echo WebSocket diterima;
  - tidak ada permintaan ke luar localhost;
  - log server tanpa warning.
- **`bun run dev`:**
  - `/api/health` lewat proxy Vite menjawab `{"ok":true,"version":"0.1.0"}`;
  - console bersih (StrictMode);
  - Ctrl+C menghentikan server dan Vite, dan port kembali bebas.

## Angka
**Build dan dev**
- Build produksi: JS 398 kB (gzip 126 kB), CSS 34 kB (gzip 7,5 kB), font Inter woff2 lokal. Waktu build 0,2 dtk.
- Build test, dua chunk lazy:
  - kanvas 3D (three + R3F + drei): 977 kB (gzip 257 kB);
  - halaman uji + streamdown: 501 kB (gzip 147 kB).
- Vite dev siap dalam ±0,14 dtk.

**Kontras token (WCAG).** Dari 34 pasangan warna yang dicek di dua tema, hanya pasangan berikut yang di bawah syarat.
Tes `scripts/sync-tokens.test.ts` mengunci nilai ini, jadi perubahan token langsung terlihat.

| Pasangan | Tema | Rasio | Syarat |
|---|---|---|---|
| `text-tertiary` di `bg-app` | terang | 4,29 | 4,5 (teks) |
| `text-tertiary` di `bg-elevated` | gelap | 4,33 | 4,5 (teks) |
| `border-strong` di `bg-raised` | gelap / terang | 1,43 / 1,52 | 3,0, bila border satu-satunya penanda batas kontrol |
| `border-default` di semua permukaan | kedua tema | 1,14–1,28 | tidak wajib, karena dekoratif |

## Screenshot & file
Semua screenshot diambil dari `bun run dev` dengan viewport 1440×900. Halaman uji diambil satu halaman penuh
(1440×1204).
- **Studio** (placeholder), tema gelap dan terang:
  - `docs/progress/tahap-00/dev-studio-gelap.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-studio-gelap.png`
  - `docs/progress/tahap-00/dev-studio-terang.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-studio-terang.png`
- **Pengaturan** dengan pilihan tema Gelap / Terang / Ikut sistem:
  - `docs/progress/tahap-00/dev-pengaturan-gelap.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-pengaturan-gelap.png`
  - `docs/progress/tahap-00/dev-pengaturan-terang.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-pengaturan-terang.png`
- **Halaman uji** (tombol, markdown, kubus R3F + gizmo, status echo):
  - `docs/progress/tahap-00/dev-smoke-gelap.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-smoke-gelap.png`
  - `docs/progress/tahap-00/dev-smoke-terang.png`
    `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-00/dev-smoke-terang.png`
- **Hasil uji kompatibilitas lengkap:** bagian Status kompatibilitas di `docs/TECH_STACK.md`
  `xdg-open /var/www/ai-asset-generate/docs/TECH_STACK.md`

## Keputusan
Semua keputusan berikut juga tercatat di Log keputusan `docs/PLAN.md`.
- **Port:** 4340/4341, dan 4342 untuk server E2E. Port 4330/4331 dipakai learning-system dan automated-test-app.
- **`bun run dev`** mengecek port API dan Vite sebelum menjalankan apa pun.
- **`@hono/bun` 1.0.1** menggantikan `hono/bun`, yang sudah deprecated. Ini satu-satunya dependensi tambahan.
- **TypeScript dan Biome:**
  - basis TypeScript di `tsconfig.json`;
  - Biome memakai `preset: "recommended"`, dan mengecualikan `*.md` serta file hasil generator token.
- **Token:**
  - `@theme static`, bukan `inline`, supaya tema bisa berganti saat app berjalan;
  - radius 4/6/8/12;
  - keluaran tambahan `tokens.ts`;
  - koleksi Icon/Status tidak diekspor.
- **Tema** bawaan gelap, disimpan di `localStorage` dengan kunci `aag-theme`.
- **Pagar Host/Origin** hanya menerima nama loopback.
- **E2E** memakai build mode test di port 4342, dengan data sementara di `.tmp/e2e/data`. Data Anda tidak tersentuh.
- **shadcn:** sumber komponen disalin lewat `--view`, lalu memakai `cn` lokal di `web/lib/utils.ts`.
- **Kanvas 3D:**
  - satu filter khusus untuk peringatan `THREE.Clock`;
  - drei `Bounds` tidak dipakai bersama `CameraControls`.
- **Build:**
  - `chunkSizeWarningLimit` 1200 kB;
  - teks halaman uji dipisah ke `tSmoke`.

## Temuan & risiko
**Library**
- **R3F 9.8.2 masih membuat `THREE.Clock`**, yang deprecated sejak three r183. Akibatnya setiap `<Canvas>` memunculkan
  peringatan.
  - Peringatan itu disaring, hanya untuk pesan itu.
  - Filter dihapus saat R3F pindah ke `THREE.Timer`. Alternatifnya turun ke three 0.182.
- **drei `Bounds` tidak cocok dengan `CameraControls`:** muncul error di setiap frame. Viewer Tahap 8 membingkai model
  dengan `CameraControls.fitToBox`. `GizmoHelper` aman dipakai.
- **shadcn CLI 4.23 menulis `import { cn } from "cn"`** dan tidak punya opsi untuk mematikannya. Di Tahap 7, setiap
  komponen disalin lewat `--view` lalu import-nya diganti. Prosesnya sedikit lebih manual, tetapi tanpa dependensi baru.
- **streamdown:** heading-nya memakai ukuran teks bawaan Tailwind, yang sudah diganti token. Akibatnya heading tampil
  seukuran teks biasa.
  - Tahap 9 memetakan elemen markdown ke text style FigCraft.
  - Chunk streamdown ±500 kB. Di Tahap 9 dicek apakah bisa diperkecil.
- **`@hono/bun` tidak meneruskan event `drain`.** Backpressure diselesaikan oleh hub WebSocket di Tahap 6.
- **Agent SDK tidak mengisi `apiKeySource` untuk sesi login.** Nilai kosong dianggap berarti tanpa API key.
  `check:auth` gagal bila SDK melaporkan sumber API key apa pun.
- **`noFloatingPromises` masih aturan nursery Biome**, jadi perilakunya bisa berubah saat Biome di-upgrade. Ulangi
  probe di atas setiap upgrade.

**Tooling**
- **`bun --watch` tidak keluar saat port sudah dipakai.** Ini sempat membuat Vite meneruskan `/api` ke proses lain.
  Sekarang ditutup dengan cek port di `scripts/dev.ts`.

**App**
- **Kontras:** lihat tabel di Angka, serta Pertanyaan 1 dan 2.
- **Tata letak shell masih sementara** (header dan navigasi atas), hanya sebagai kerangka routing. Rel navigasi sesuai
  desain FigCraft dibuat di Tahap 7.
- **Tipe `gltf-validator`** ditulis sendiri secara minimal di `server/types/gltf-validator.d.ts`. Diperluas di Tahap 2
  bila perlu.

## Belum dikerjakan / dipindah
- **Backpressure WebSocket → Tahap 6.** Butuh hub WebSocket; lihat temuan `drain`. Pagar Host/Origin sebelum upgrade,
  `maxPayloadLength` 64 KB, dan `idleTimeout` sudah terbukti di tahap ini.
- **Uji dispose R3F → Tahap 8.** Butuh viewer dengan GLB sungguhan dan `window.__viewer`.
- Selain itu tidak ada.

## Pertanyaan untuk pemilik
1. **Kontras `text-tertiary`:** rasionya 4,29 dan 4,33, padahal AA butuh 4,5. Pilihan:
   - a. **(Rekomendasi)** Saya geser sedikit nilai `text-tertiary` di FigCraft sampai ≥4,5 di semua permukaan, lalu
     menjalankan `tokens:sync`. Di tema terang warnanya sedikit lebih gelap, di tema gelap sedikit lebih terang.
     Bedanya hampir tidak terlihat.
   - b. Nilainya tetap, tetapi `text-tertiary` hanya dipakai untuk teks yang dikecualikan WCAG, misalnya elemen nonaktif.
2. **Batas kolom input:** `border-strong` hanya 1,4–1,5:1. Border dekoratif boleh halus. Batas kolom input, checkbox,
   dan kontrol sejenis wajib ≥3:1 bila border adalah satu-satunya penanda. Pilihan:
   - a. **(Rekomendasi)** Tambah satu token, misalnya `border-input` (≥3:1), khusus untuk kontrol tersebut. Border lain
     tetap halus.
   - b. Naikkan `border-strong` untuk semua pemakaian. Tampilan menjadi lebih berat.

   Pertanyaan 1 dan 2 menyangkut perubahan desain, jadi dikerjakan di FigCraft dan perlu persetujuan Anda. Jawabannya
   dibutuhkan sebelum Tahap 7, dan tidak menghambat Tahap 1.
3. **Persetujuan:** apakah Tahap 0 disetujui, dan penanda Tahap aktif boleh dipindah ke Tahap 1?
4. **Commit:** semua file masih belum di-commit. Bila Anda minta, saya stage file proyek satu per satu (tanpa
   `git add .`), termasuk `design/`, lalu commit dengan pesan `chore: bootstrap project foundation and compatibility
   checks`.

## Usulan tahap berikutnya
**Tahap 1 — Spike runtime 3D**
- **Image Docker `asset-forge`:** `python:3.13-slim` (di-pin dengan digest), `bpy==5.2.4`, xatlas, numpy, dan pytest.
- **Runner `server/runtime/docker.ts`:**
  - argumen array;
  - flag sandbox yang dijaga tes snapshot;
  - label `aag.job`;
  - timeout → `docker kill`;
  - deteksi OOM;
  - pembersihan container yatim.
- **`assetkit` v0** dengan pytest.
- **Bukti di mode modul:** ekspor glTF dan bake Cycles CPU berjalan.

Catatan:
- Tahap 1 mengunduh image dasar dan wheel `bpy` (±403 MB) lewat jaringan. Tidak memakai kuota Claude.
- Penyesuaian rencana hanya dua catatan di atas: backpressure ke Tahap 6 dan uji dispose ke Tahap 8.

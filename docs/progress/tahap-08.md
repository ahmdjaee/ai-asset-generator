# Tahap 8 — Viewer 3D

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **Aset bisa dilihat dari segala arah, dengan perilaku sama seperti prototipe `viewer-360.html`.**
  - Orbit penuh: kiri-kanan tanpa batas, atas-bawah 0..π.
  - 7 sudut cepat lewat menu Sudut dan gizmo sumbu; keduanya bisa dipakai dengan keyboard.
  - Pintasan R/F/W/G/L; mode Tekstur, Clay, UV, Normal, ditambah wireframe sebagai lapisan.
  - Lantai hilang saat kamera di bawah; layar penuh; Ambil gambar (PNG); panel Detail.
- **Tampilan sama dengan FigCraft #1151** di kedua tema. Selisih piksel per potongan 1,8–4,3%; petunjuk 11%. Selisih
  itu dari rasterisasi teks, pembulatan lebar teks FigCraft, dan garis grid render 3D.
- **Desain FigCraft diperbaiki di dua tempat** sebelum kodenya diubah: UV nonaktif di review bentuk dasar, dan
  bulatan negatif gizmo beropasitas penuh (kontras).
- **Tinjauan kode independen** menemukan 3 masalah sedang dan 9 ringan.
  - 11 sudah diperbaiki. Setiap perbaikan dimulai dengan tes yang gagal.
  - 1 dipindah ke Tahap 9: kanvas dipasang ulang setiap ganti versi.
- **Semua Definition of Done terpenuhi.**

## Yang dikerjakan
- **Viewer** (`web/features/viewer/`):
  - `Viewer.tsx`: kanvas `frameloop="demand"`, overlay dan state, fokus, layar penuh, pintasan;
  - `ViewerScene.tsx`: adegan R3F, `CameraControls`, lampu dan lantai, mode, putar otomatis, test hook;
  - `ViewerToolbar.tsx`, `AxisGizmo.tsx` (Radix Toolbar, satu pemberhentian Tab), `DetailPanel.tsx`, `LazyViewer.tsx`
    (chunk terpisah);
  - logika murni yang dites unit:
    - `math.ts`: preset, jarak bingkai, batas zoom, lantai, grid 1-2-5, proyeksi gizmo;
    - `camera.ts`: geser pusat pandang ke samping panel;
    - `floor.ts`, `materials.ts`, `model.ts`, `lifetime.ts`, `icons.ts`;
    - `shortcuts.ts`: pintasan huruf dan tombol kanvas;
  - test hook `window.__viewer` (`test-hook.ts`), hanya di build mode test.
- **Bersama:**
  - `shared/scene.ts`: lampu, lingkungan, dan material. Dipakai renderer contact sheet dan viewer, jadi yang dilihat
    Claude = yang dilihat pemilik;
  - `web/lib/use-media-query.ts`, `web/lib/download.ts`, `web/lib/inert.ts`;
  - `web/components/LiveStatus.tsx`;
  - `TriggerSlot` di `web/components/ui/tooltip.tsx`.
- **Halaman uji `/_viewer`** (mode dev/tes): `web/features/smoke/ViewerPage.tsx`, fixture GLB Tahap 4 plus `rusak`.
- **FigCraft:**
  - toolbar viewer #1152;
  - layar 02: UV nonaktif;
  - gizmo #2464: bulatan negatif opasitas penuh, hover terisi;
  - catatan perilaku #2712;
  - PNG `00-components` dan `02-studio-review-bentuk-dasar` diekspor ulang.
- **Perbaikan kode Tahap 2** (dari tinjauan): halaman render membuang objek GPU per render.
  - `server/render/page/main.ts`;
  - `Renderer.gpuMemory()` di `server/render/renderer.ts`.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | Lolos. Lint 284 file tanpa temuan; typecheck server + web; 709 tes server/shared + 243 tes web + 252 tes cakupan, 0 gagal. Hanya peringatan `THREE_CJS_DEPRECATED` yang sudah diketahui (AGENTS §13) |
| `bun run e2e` | 66 tes lolos (3,2 mnt) |
| `bunx playwright test tests/e2e/viewer.e2e.ts --repeat-each=3` | 105/105 lolos (7,3 mnt), tanpa flaky |
| `bun run e2e:api` | Lolos (1 skenario) |
| `bun run test:pipeline` | 14 tes lolos. Golden render tidak berubah. Tes baru: setelah render wireframe, Clay, dan tekstur, jumlah geometri dan tekstur di GPU halaman render kembali ke angka semula. Tes ini gagal sebelum perbaikan (6 → 10 geometri) |
| Tes yang gagal dulu (E2E) | 3 tes baru dijalankan pada kode lama yang dikembalikan sementara, dan ketiganya gagal: <br>• fokus tidak sampai ke "Muat ulang viewer"; <br>• arah putar +2,83 rad (harus negatif); <br>• opasitas bulatan negatif 0,6. <br>Dengan perbaikan, ketiganya lolos |
| `bun run build` | Bersih, tanpa warning. Bundle produksi tidak memuat `__viewer`, `/_viewer`, atau `/_komponen` |
| axe (E2E) | 0 masalah serius di kedua tema, juga dengan menu Sudut terbuka dan pada state GLB rusak |
| Cincin fokus (E2E) | ≥14 pemberhentian Tab di viewer, semuanya bercincin `accent-ring` (gaya dan piksel) |
| Console dan jaringan | Tanpa error/warning di semua tes viewer; tanpa request ke host luar |

## Angka
- **Sudut dan kamera** (E2E):
  - 7 sudut cepat tepat ±1e-3 rad;
  - `F` membingkai ulang ±2%;
  - panah = 15°, `+`/`−` = 20%, Shift + panah = geser 10% jarak kamera;
  - diam = 0 frame selama 10 dtk (jam palsu).
- **Golden viewer:** 7 sudut × 2 tema (`tests/goldens/viewer/`), semuanya di bawah ambang `GOLDEN_MAX_DIFF_RATIO`.
  Tidak diperbarui setelah tinjauan.
- **FPS** di GPU mesin ini (Radeon 780M lewat ANGLE GL-EGL, Chromium headless, putar otomatis): 60 fps di DPR 1 dan 2,
  untuk bentuk dasar maupun aset final.
  - Diukur dengan skrip sebelum perbaikan tinjauan.
  - Perbaikan itu tidak mengubah jalur render; yang berubah hanya arah putar dan pembuangan objek.
- **Selisih piksel app vs FigCraft #1151** (skala 2, `pixelmatch` ambang 0,1, sudut membulat di-mask):

  | Potongan | Gelap | Terang |
  |---|---:|---:|
  | Toolbar | 4,32% | 3,45% |
  | Menu Sudut | 1,80% | 2,28% |
  | Panel Detail | 1,95% | 2,02% |
  | Gizmo | 2,34% | — |
  | Petunjuk | 10,96% | — |

  Gizmo dan petunjuk berada di atas render 3D, dan desain hanya punya render gelap, jadi keduanya hanya dibandingkan di
  tema gelap.
- **Kontras garis bulatan negatif gizmo** terhadap `bg/viewport` (WCAG 1.4.11 minta ≥3:1):

  | Tema | X | Y | Z |
  |---|---:|---:|---:|
  | Gelap, dulu (opasitas 0,6) | 2,71 | 3,69 | 2,80 |
  | Terang, dulu (opasitas 0,6) | 2,20 | 2,10 | 2,27 |
  | Gelap, sekarang | 5,37 | 8,05 | 5,54 |
  | Terang, sekarang | 3,63 | 3,70 | 4,20 |

- **Renderer contact sheet:** 6 sudut p95 488 ms, median 470 ms (batas 8 dtk).
- **Bundle produksi:**
  - `index` 554 kB (gzip 174 kB). Viewer belum dipakai rute produksi mana pun; Studio memakainya di Tahap 9.
  - Di build uji, viewer sudah menjadi chunk lazy terpisah: `Viewer` 113 kB, ditambah chunk three/R3F/drei bersama.

## Screenshot & file
- **Viewer** (tema gelap dan terang, juga dengan menu Sudut terbuka):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/viewer-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/viewer-terang.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/viewer-menu-sudut-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/viewer-menu-sudut-terang.png`
- **Lembar kontak 14 golden** (7 sudut × 2 tema, berlabel):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/golden-viewer.png`
- **Pembanding desain:** setiap gambar berisi desain (atas), app (tengah), dan selisihnya (bawah).
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-08/banding/gelap-toolbar.png`
  Juga di folder yang sama: `gelap-menu-sudut`, `gelap-panel`, `gelap-gizmo`, `gelap-petunjuk`, `terang-toolbar`,
  `terang-menu-sudut`, `terang-panel`.
- **Ekspor FigCraft** yang diperbarui:
  `xdg-open /var/www/ai-asset-generate/design/exports/02-studio-review-bentuk-dasar.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/00-components.png`

## Keputusan
Semuanya tercatat di Log keputusan `PLAN.md` (14 Nov 2026). Yang utama:
- **Wireframe sebagai lapisan** (`W`) di atas mode Tekstur, Clay, UV, atau Normal, bukan mode tersendiri. Pintasan
  tambahan `L`: cahaya ikut kamera.
- **Bawaan per tahap:** bentuk dasar = Clay + wireframe, aset final = Tekstur. Bawaan ini juga berlaku saat tahap
  berganti tanpa viewer dipasang ulang. Mode yang tidak didukung model dinonaktifkan; UV selalu nonaktif di bentuk
  dasar karena bentuk dasar diekspor tanpa UV.
- **Lingkungan memakai `RoomEnvironment` three (PMREM), bukan file HDRI.** Sama dengan renderer contact sheet, tanpa
  aset unduhan.
- **Pintasan huruf hanya berlaku saat fokus di dalam viewer** (WCAG 2.1.4). Klik kanvas memfokusnya. Escape tetap
  keluar dari layar penuh di mana pun fokusnya.
- **Layar penuh:**
  - memakai Fullscreen API dokumen, atau CSS bila API tidak tersedia;
  - sisa halaman dibuat `inert`;
  - layar penuh ditutup saat viewer dilepas.
- **Keyboard di kanvas:**
  - panah = putar, Shift + panah = geser, `+`/`−` = zoom;
  - kombinasi Ctrl/Alt/Meta dibiarkan untuk browser.
- **Aksesibilitas fokus dan pengumuman:**
  - fokus berpindah ke kontrol pasangannya bila kontrol yang difokus hilang (panel, muat ulang, error);
  - status diumumkan lewat live region yang selalu terpasang.
- **Gizmo:** bulatan negatif beropasitas penuh dan terisi warna sumbu saat hover. Diubah di FigCraft dulu.
- **Umur objek GPU:** dikelola `lifetime.ts`, aman di StrictMode. Halaman render contact sheet ikut membuang objek
  per render.
- **FPS diukur lewat skrip GPU**, bukan diamati manual.

## Temuan & risiko
- **Ganti versi memasang ulang kanvas WebGL.** Kamera kembali ke 3/4, jadi v1 dan v2 belum bisa dibandingkan dari sudut
  yang sama. Dipindah ke Tahap 9 dan sudah masuk checklist tahap itu.
- **Klik ganda ke titik permukaan tidak punya padanan keyboard langsung.** Padanannya: Shift + panah untuk menggeser,
  lalu `+` untuk mendekat.
- **`bun test` mencetak `DeprecationWarning [THREE_CJS_DEPRECATED]`** sekali per proses. Penyebabnya `main` CJS drei.
  Peringatan ini sudah diketahui dan tidak disembunyikan (AGENTS §13).
- **Toolbar 574 px vs 577 px di desain,** karena FigCraft membulatkan lebar teks ke atas. Tombol di kanannya bergeser
  2–3 px.
- **Thumbnail versi di `/_viewer` kosong.** Halaman uji tidak punya thumbnail, sehingga potongan panel sedikit berbeda
  dari desain. Studio di Tahap 9 memakai thumbnail asli.
- **FPS hanya diukur di Chromium headless dengan GPU,** belum di browser pemilik.
- **Ukuran chunk three/R3F/drei produksi** baru terukur saat viewer dipakai Studio (Tahap 9). Di build uji (React
  development) chunk-nya ±1 MB sebelum gzip.
- **`pngjs` sudah bukan dependensi langsung,** tetapi tetap terpasang lewat pixelmatch.

## Belum dikerjakan / dipindah
- Ganti versi tanpa memasang ulang kanvas, kamera dipertahankan → **Tahap 9**.
- Opsi "sertakan tampilan viewport saat ini" sebagai lampiran revisi → **Tahap 9** (sesuai rencana). `capture()`
  viewer sudah tersedia.
- **Menunggu izin pemilik:** commit. Repo belum punya commit; semua perubahan ada di working tree. Tahap ini tidak
  memakai kuota Claude.

## Pertanyaan untuk pemilik
Tidak ada yang memblokir. Bila sempat, mohon tinjau hal yang diputuskan agent atas nama Anda:
- pintasan huruf hanya aktif saat fokus di dalam viewer, bukan di seluruh halaman;
- bulatan negatif gizmo beropasitas penuh dan terisi saat hover (desain lama: 60%, terang saat hover);
- saat tahap berganti, mode dan wireframe kembali ke bawaan tahap baru (pilihan Normal, misalnya, tidak dibawa).

## Usulan tahap berikutnya
Tahap 9 — Studio lengkap (M1):
- composer, thread streaming, kartu pertanyaan, progres + Stop;
- review bentuk dasar dan final dengan viewer ini;
- viewer antar-versi tanpa memasang ulang kanvas (dari tinjauan Tahap 8).

Uji nyata "peti kayu dengan engsel besi" di Tahap 9 memakai kuota, jadi menunggu izin pemilik.

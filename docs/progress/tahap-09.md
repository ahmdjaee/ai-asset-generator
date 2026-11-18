# Tahap 9 — Studio lengkap (M1: app bisa dipakai)

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **App sudah bisa dipakai untuk membuat aset dari awal sampai akhir.** Alurnya diuji dengan driver palsu:
  1. prompt + lampiran;
  2. pertanyaan Claude;
  3. bentuk dasar v1;
  4. revisi dengan tangkapan viewport;
  5. setujui;
  6. aset final;
  7. selesai;
  8. unduh GLB.

  Fitur pendukung: thread streaming dengan ringkasan berpikir, kartu pertanyaan (pilih satu, pilih banyak, "Lainnya"),
  progres build + Stop, riwayat versi dengan viewer yang menjaga sudut pandang, toast untuk aset lain, dan sambung ulang
  otomatis dengan banner.
- **Tampilan mengikuti FigCraft** (layar 02 dan "Tahap 9 · komponen Studio" #3722). Lebar 1280/1024 px yang belum
  punya desain sekarang dirancang dulu di FigCraft (layar baru "02 … 1024 px"), baru diterapkan.
- **Tinjauan kode independen** menemukan 15 masalah (14 terbukti, 1 dugaan) ditambah 1 catatan. Tidak ada yang berat
  atau menyangkut keamanan. Semuanya sudah diperbaiki dan dikunci tes.
- **DoD:** semua tes lolos (E2E studio 3× berturut-turut) dan laporan ini selesai. **Belum:** 1 uji nyata dengan
  Claude sungguhan. Uji ini memakai kuota, jadi menunggu izin pemilik.

## Yang dikerjakan
- **Studio baru** (`web/features/studio/StudioNewPage.tsx`, `Composer.tsx`, `attachments.ts`):
  - composer dengan teks dan lampiran (seret, pilih file, tempel Ctrl+V) sebagai chip;
  - pilihan tier + info budget; Enter kirim, Shift+Enter baris baru;
  - contoh prompt dan panduan jenis aset.
- **Sesi aset** (`StudioSessionPage.tsx`, rute lazy `/studio/:assetId`):
  - topbar: breadcrumb, tier, badge status, stepper tahap, Unduh versi yang dilihat;
  - kolom thread + dock, viewer, panel Detail (budget, dimensi, validasi, Optimasi untuk aset final, riwayat versi).
- **Thread** (`thread-store.ts`, `use-asset-thread.ts`, `thread-items.ts`, `ThreadView.tsx`, `BuildCard.tsx`,
  `build-progress.ts`):
  - logika `useTaskThread` ai-team: subscribe → snapshot → merge per `seq`, delta di-flush tiap 100 ms, muat pesan lama
    dengan posisi baca terjaga;
  - pesan Claude lewat streamdown (`web/components/Markdown.tsx`), ringkasan berpikir yang bisa dilipat, kartu brief,
    kartu build dengan langkah dan waktu, baris aksi pemilik, blok error/batas/dihentikan.
- **Kartu pertanyaan** (`QuestionCard.tsx`): pilih satu, pilih banyak, "Lainnya" dengan isian; status dijawab atau
  dibatalkan dari event server.
- **Dock** (`Dock.tsx`, `ChangeShapeDialog.tsx`): kartu bekerja (Stop), menunggu jawaban, review bentuk dasar (Setujui
  / Minta revisi), review final (Selesai / Ubah bentuk), selesai (unduh); composer revisi dengan tangkapan viewport.
- **Realtime** (`AssetWatcher.tsx`, `ReconnectBanner.tsx`, `web/lib/realtime.ts`):
  - topik `global` memperbarui daftar dan detail aset, toast untuk aset lain;
  - banner sambung ulang; batas waktu handshake; "Sambungkan sekarang".
- **Data** (`queries.ts`, `detail.ts`, `session.ts`, `web/lib/assets.ts`, `web/lib/asset-status.ts`): TanStack Query +
  merge event `state`, aksi dengan `mutateAsync`, badge status dari satu pemetaan.
- **Viewer:**
  - ganti versi tanpa memasang ulang kanvas, sudut kamera dibawa (`CarriedView`);
  - tata letak viewer sempit (`Viewer.tsx`, `ViewerToolbar.tsx`).
- **Server dan driver palsu:**
  - urutan event seperti CLI asli (`InputQueue.drained()`);
  - aksi skenario `streamText`, penanda `[macet]` menulis potongan teks sebelum diam;
  - nama langkah pipeline bersama di `shared/build-steps.ts`.
- **FigCraft** (`design/ai-asset-generate.figcraft`):
  - "Tahap 9 · komponen Studio" (#3722): kartu pertanyaan, dock, composer, blok thread, panel Optimasi, banner,
    viewport kosong, dialog Ubah bentuk;
  - layar baru "02 Studio · review bentuk dasar · 1024 px", komponen "Toolbar viewport" diberi wrap, catatan perilaku
    viewer diperbarui;
  - render latar 1024 lewat `design/tools/render/jobs-1024.json` → `design/assets/hero-dark-clay-wire-1024.png`;
  - PNG diekspor ulang: `00-components`, `09-komponen-studio` (+ terang), `02-studio-review-bentuk-dasar-1024` (baru).
- **E2E** (`tests/e2e/studio.e2e.ts`, `scripts/e2e-data.ts`, `playwright.config.ts`):
  - alur penuh di dua tema, viewer sesi di 3 lebar, muat ulang saat Claude bekerja dan saat teks sedang di-stream,
    sambung ulang;
  - tes yang membuat aset dipisah ke project Playwright `aset` (satu worker, setelah tes UI), supaya toast dan kartu
    aset baru tidak mengganggu tes lain.
- **Toast status aset** (`AssetWatcher.tsx`, `web/components/ui/toast.tsx`): id per aset; toast aset ditutup saat sesinya
  dibuka.
- **AGENTS §13:** 9 jebakan baru (TanStack `mutate`, refetch error, cleanup layout React, radio native, live region,
  simulasi tata letak happy-dom, delta stream di E2E, kabut alat render desain, `expect` di dalam `waitFor`). Jebakan
  E2E server bersama diperbarui (project `aset`, `--no-deps`).

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | Lolos. Lint 340 file tanpa temuan; typecheck server + web; 716 tes server/shared + 375 tes web + 257 tes cakupan, 0 gagal. Hanya peringatan `THREE_CJS_DEPRECATED` yang sudah diketahui (AGENTS §13) |
| `bun run e2e` | Lolos: 75 tes (67 tes UI di project `chromium` + 8 tes studio di project `aset`), 4,6 menit. axe 0 masalah serius di semua halaman yang diperiksa; tanpa error/warning console |
| `bunx playwright test tests/e2e/studio.e2e.ts --no-deps --repeat-each=3` | Lolos 3× berturut-turut: 24 tes, 0 gagal, 0 flaky, 3,0 menit |
| `bun run e2e:api` | Lolos: 1 tes alur penuh HTTP + WebSocket, 14 pemeriksaan, ±1,1 dtk; log server bersih |
| `bun run build` | Lolos tanpa warning (611 ms). Chunk: `index` 710,7 kB (gzip 220,7), `StudioSessionPage` 541,7 kB (gzip 159,8), `Viewer` 1.079,7 kB (gzip 288,7), CSS 54,7 kB |
| Tes untuk temuan tinjauan | Setiap temuan punya tes baru atau tes yang disesuaikan. Yang terbukti gagal dulu pada kode lama: <br>• E2E viewer sempit: di 1280 px toolbar dan panel bertumpuk, di 1024 px toolbar keluar dari viewer; <br>• banner sambung ulang: live region belum selalu terpasang; <br>• `streamText` belum ada di driver palsu (tes skenario dan port); <br>• toast aset yang lalu dibuka tetap tampil (tes `AssetWatcher`, gagal tanpa perbaikan). <br>Tes lain (halaman sesi, composer, kartu pertanyaan, thread, realtime) ditulis bersama perbaikannya; catatan sesi tidak menyimpan bukti bahwa semuanya dijalankan gagal lebih dulu |
| axe (E2E) | 0 masalah serius: pertanyaan, review, review final, selesai (kedua tema), banner sambung ulang, viewer 1280/1024 |
| Console dan jaringan | Tanpa error/warning di tes studio; tanpa request ke host luar |

## Angka
- **E2E:** run penuh 4,6 menit; tes studio 3× 3,0 menit. Project `chromium` (67 tes UI) paralel dengan 2 worker, lalu project `aset` (8 tes studio)
  satu per satu.
- **Tes web:** 375 tes di 58 file, ±11 dtk; tes server/shared 716 tes, ±3,4 dtk.
- **Bundle:** chunk awal (`index`) tetap 710,7 kB. Thread (streamdown) ada di chunk sesi yang dimuat lazy, dan viewer di
  chunk sendiri.
- **Viewer sempit** (E2E, tema gelap):

  | Lebar jendela | Panel Detail | Toolbar |
  |---|---|---|
  | 1440 px | di samping toolbar (atas sejajar) | satu baris |
  | 1280 px | di bawah toolbar | satu baris |
  | 1024 px | di bawah toolbar | dua baris (tangkapan + layar penuh di baris kedua) |

## Screenshot & file
- **Alur Studio** (tema gelap dan terang):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/studio-pertanyaan-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/studio-review-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/studio-selesai-gelap.png`
  Versi terang: `studio-pertanyaan-terang.png`, `studio-review-terang.png`, `studio-selesai-terang.png` di folder yang
  sama.
- **Viewer sesi di lebar sempit:**
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/studio-review-1280-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/studio-review-1024-gelap.png`
- **Pembanding desain** (desain FigCraft di atas, app di bawah):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/banding/review-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/banding/review-1024-gelap.png`
- **Galeri komponen** (`/_komponen`, termasuk bagian Studio):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-09/komponen-gelap.png`
- **Ekspor FigCraft:**
  `xdg-open /var/www/ai-asset-generate/design/exports/02-studio-review-bentuk-dasar-1024.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/09-komponen-studio.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/00-components.png`

## Keputusan
Semuanya tercatat di Log keputusan `PLAN.md` (14 Nov 2026). Yang utama:
- **Sesi aset di `/studio/:assetId`**, dimuat lazy. Rel menandai Studio aktif di halaman sesi.
- **"Unduh" di topbar mengunduh versi yang sedang dilihat**; kartu Selesai mengunduh versi terkini.
- **Viewer mengikuti versi terkini**, tetapi pilihan versi pemilik bertahan sampai ada versi baru.
- **Optimasi hanya ditampilkan untuk aset final.** Layar 02 (review bentuk dasar) tidak memuatnya. Komponen
  FigCraft #4112 hanya contoh netral.
- **Pesan selalu butuh teks** (server menolak pesan kosong). Lampiran tanpa teks tidak bisa dikirim.
- **Aksesibilitas:**
  - judul kartu dock dan potongan balasan Claude yang baru diumumkan live region;
  - panah di kartu pertanyaan tidak memindah fokus;
  - isian composer tetap fokus saat mengirim;
  - fokus pindah ke `<main>` saat banner sambung ulang hilang.
- **Viewer sempit:** panel Detail turun di bawah toolbar bila tidak muat di sampingnya; toolbar membungkus. Dirancang
  dulu di FigCraft (layar 1024 px).
- **Dock saat giliran gagal atau terputus setelah versi dikirim:** kartu review tetap tampil, karena server tetap
  menerima Setujui/Selesai.
- **Thumbnail versi dan menu "…" topbar dipindah ke Tahap 10.**
- **E2E dibagi dua project:** `chromium` untuk tes UI (paralel), `aset` untuk tes yang membuat aset (satu worker,
  berjalan setelah `chromium`). Penyebabnya: run penuh sempat gagal karena toast dari aset tes studio menutupi gizmo
  di halaman uji viewer.

## Temuan & risiko
- **Tinjauan kode independen** (subagent, tanpa mengubah file): 15 temuan, tingkat sedang ke bawah.
  - Sedang: lampiran tanpa teks selalu ditolak server; toolbar viewer tertutup panel di bawah ±1350 px; callback
    `mutate` hilang saat aksi bertumpuk; "Muat pesan sebelumnya" tidak menjaga posisi baca; fokus hilang setelah
    mengirim; balasan dan perubahan dock tidak diumumkan pembaca layar.
  - Ringan: panah ke "Lainnya" memindah fokus; kartu yang sudah dijawab sempat tampil "dibatalkan"; muat halaman lama
    bertabrakan dengan resync; refetch gagal mengganti sesi dengan halaman error; error tangkapan viewport ditelan;
    banner sambung ulang (live region, handshake menggantung); E2E memakai pemilih CSS; komentar Markdown tidak
    sesuai konfigurasi; respons aksi bisa memundurkan state WebSocket yang lebih baru (dugaan).
  - Catatan C: dock kosong saat giliran terputus di status review.

  Semuanya diperbaiki; rinciannya per temuan ada di Log keputusan.
- **Uji nyata belum dijalankan.** Alur diuji dengan driver palsu dan runtime fixture. Perilaku Claude sungguhan di alur
  Studio lengkap (pertanyaan, revisi dengan gambar, tahap tekstur) belum dibuktikan sejak Tahap 3–4.
- **Teks yang sedang di-stream hilang saat halaman dimuat ulang**, sampai pesan utuhnya datang. Delta memang tidak
  disimpan server; E2E memastikan tidak ada potongan ganda atau terpotong.
- **Di 1024 px dengan panel Detail terbuka, model tampil kecil** di area kiri panel (±250 px). Panel bisa ditutup.
- **Toast "siap direview" untuk aset yang sedang dibuka** sempat terekam di screenshot 1024 px. Penyebabnya race: dalam
  mode palsu aset baru bisa selesai dibangun sebelum navigasi ke sesinya selesai. Sudah diperbaiki; toast aset itu
  ditutup saat sesinya dibuka.
- **Galeri komponen sempat gagal di E2E** setelah perbaikan banner: banner di galeri belum dibungkus live region yang
  sama dengan app. Sekarang keduanya memakai `ConnectionStatusRegion`.
- **Tidak bisa diverifikasi:** perilaku pembaca layar sungguhan. Yang diuji adalah isi live region dan atribut ARIA.
- **Driver palsu sekarang mengikuti urutan CLI asli** (pesan assistant sebelum kartu pertanyaan). Tanpa perbaikan itu,
  urutan thread di mode palsu salah.
- **Ekspor FigCraft `00-components.png` lebih tinggi** (3760 × 4204, dari 3968 px): latar halaman diperpanjang untuk
  catatan perilaku viewer yang bertambah.

## Belum dikerjakan / dipindah
- **1 uji nyata** (DoD): prompt "peti kayu dengan engsel besi" + gambar referensi sampai DONE. Menunggu izin pemilik
  karena memakai kuota.
- **Thumbnail versi** (panel Detail, kartu "Terakhir dibuat") → Tahap 10, dari render turntable.
- **Menu "…" di topbar sesi** (ekspor, duplikat, hapus) → Tahap 10, bersama detail aset.
- **Budget tier dari Pengaturan** di info composer → Tahap 11. Sampai saat itu composer memakai `DEFAULT_TIERS`;
  aset tetap memakai `tierSnapshot` dari server.

## Pertanyaan untuk pemilik
- **Izin uji nyata Tahap 9** (memakai kuota Claude): satu aset "peti kayu dengan engsel besi" + gambar referensi
  sampai DONE, lewat app (`AGENT_DRIVER=sdk`). Boleh dijalankan?
- **Layar baru FigCraft "02 Studio · review bentuk dasar · 1024 px"** (halaman Screens — Dark, di bawah layar 02):
  di jendela sempit, panel Detail turun ke bawah toolbar dan toolbar membungkus. Mohon dicek apakah susunan ini sesuai
  keinginan.
  `xdg-open /var/www/ai-asset-generate/design/exports/02-studio-review-bentuk-dasar-1024.png`

## Usulan tahap berikutnya
Tahap 10 — Gudang, detail aset, ekspor:
- cari, filter, urut; putar thumbnail saat hover; pilih banyak + ZIP streaming;
- halaman detail aset dan dialog ekspor Web / Unity / Sumber;
- dari Tahap 9: thumbnail versi dari render turntable, dan menu "…" di topbar sesi.

> **Catatan 2026-11-18:** uji nyata yang tertunda sudah dijalankan di Tahap 12 (aset sampai DONE). Lihat `docs/progress/tahap-12.md`.

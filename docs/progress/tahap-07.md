# Tahap 7 — Shell web & komponen

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **Kerangka app sama dengan FigCraft di kedua tema.** Rel 64 px, topbar, dan routing Studio, Gudang, Pengaturan, dan
  404 sudah jadi. Posisi dan ukuran elemen shell cocok dengan desain sampai 0,5 px. Selisih piksel area rel
  0,21–0,35%; sisanya berasal dari metrik teks.
- **Semua komponen dasar Tahap 7 ada di galeri `/_komponen`** (khusus mode dev/tes), lengkap dengan state-nya. Axe
  menemukan 0 masalah serius di kedua tema, juga saat tooltip, menu, dialog, atau toast terbuka.
- **Tinjauan kode independen menemukan 13 masalah,** termasuk 1 yang berat: cincin fokus keyboard tidak tergambar
  di hampir semua kontrol. Semuanya sudah diperbaiki, masing-masing dimulai dengan tes yang gagal.
- **Semua Definition of Done terpenuhi.**

## Yang dikerjakan
- **Layout dan routing:**
  - kerangka: `web/app/AppLayout.tsx` (termasuk tautan "Lewati ke konten utama");
  - rel, topbar, dan dialog Panduan: `web/app/shell/Rail.tsx`, `Topbar.tsx`, `GuideDialog.tsx`;
  - halaman dan rute: `web/app/pages.tsx`, `web/app/routes.tsx` (Studio, Gudang, Pengaturan sementara, 404, error
    rute);
  - lebar 1024 px tetap layak: tanpa gulir horizontal, topbar utuh (diuji E2E).
- **Teks dan format:**
  - seluruh teks UI ada di `web/i18n/id.ts`; teks halaman uji di `tSmoke`;
  - `shared/format.ts`: angka, angka ringkas, ukuran file desimal, persen, durasi, waktu relatif, dan tanggal `id-ID`.
    Nilai tidak valid ditulis "—".
- **Komponen dasar** (`web/components/ui/`, di atas Radix): Button, IconButton, Field/Input/Textarea, Segmented,
  Tooltip, Menu, Dialog, Toast (sonner), Meter, dan Badge.
- **Komponen fitur** (`web/components/`): Tier (indikator, pemilih, dan info budget), pemilih versi, chip lampiran,
  chip akun, langkah progres, statistik + meter budget, kartu aset (Default/Hover), empty state, indikator tahap, dan
  toggle tema.
- **Ikon:** `LucideProvider` dengan garis 1,5 px tetap di semua ukuran. Ukurannya mengikuti komponen.
- **Tema:**
  - pilihan Gelap/Terang/Sistem tersedia di menu akun dan di halaman Pengaturan;
  - `prefers-reduced-motion` dihormati oleh dialog, spinner tombol, dan toast (diuji E2E).
- **FigCraft:**
  - komponen yang belum digambar sekarang ada di frame #2743 "Tahap 7 · komponen tambahan";
  - token `text/tertiary` dinaikkan supaya lolos AA;
  - 38 ikon hasil swap dikembalikan ke ukuran komponen;
  - bayangan tooltip diikat ke token, dan teks tier diubah menjadi "±800 KB";
  - semua PNG di `design/exports/` diekspor ulang.
- **Perbaikan dari tinjauan independen:** lihat [Keputusan](#keputusan) dan baris 2026-11-14 di Log keputusan PLAN.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | Lolos: lint 245 file tanpa temuan; typecheck server + web; 696 tes server/shared + 106 tes web + 252 tes cakupan, semuanya 0 gagal |
| `bunx playwright test` (semua E2E) | 31 tes lolos. `--repeat-each=3` → 93/93 lolos (2,2 mnt), tanpa flaky |
| `bun run e2e:api` | Lolos (1 skenario, 14 expect) |
| axe (E2E) | 0 masalah serius di kedua tema: galeri, overlay terbuka, Studio, Gudang, Pengaturan, menu akun, dialog Panduan |
| Cincin fokus (E2E) | Setiap pemberhentian Tab di galeri (>20), Studio, Gudang, dan Pengaturan (≥6) punya outline padat 2 px `accent-ring`, dan piksel di tengah pitanya berwarna token itu. Juga diuji pada toast dan tombol tutupnya. Kedua tema |
| Warna dan state (E2E) | Gaya terhitung = token: isi meter per nada, segmen dan versi terpilih, garis field error, opacity 0,45 kontrol nonaktif, garis kartu saat hover. Kedua tema |
| Console | Tidak ada error/warning di semua tes E2E. Tidak ada request ke host luar |

## Angka
**Selisih piksel screenshot app vs ekspor FigCraft** (skala 2, `pixelmatch`, ambang bawaan):

| Layar | Potongan | Rasio piksel berbeda |
|---|---|---:|
| Studio gelap | rel / topbar / judul | 0,27% / 1,40% / 0,85% |
| Studio terang | rel / topbar / judul | 0,21% / 1,40% / 0,82% |
| Gudang gelap | rel / topbar kiri / topbar kanan | 0,35% / 1,04% / 3,23% |
| Gudang terang | rel / topbar kiri / topbar kanan | 0,29% / 1,00% / 3,31% |

**Geometri shell** (E2E, toleransi 0,5 px), sama dengan FigCraft #746/#747/#1295:
- rel: 0,0,64×900; logo: 15,5,12,32×32; NavItem: 3,5,64 dan 3,5,120 (56×52); Pengaturan: 15,5,812; Akun: 17,5,860;
- topbar: 64,0,1376×52; indikator tahap berpusat di x 754; tombol Panduan berakhir di x 1424, tinggi 30;
- judul Studio di y 96; judul Gudang di x 88.

## Screenshot & file
Semua screenshot app berukuran 1440×900 (shell pada skala 2).
- Studio, Gudang, Pengaturan, kedua tema:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/studio-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/studio-terang.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/gudang-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/gudang-terang.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/pengaturan-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/pengaturan-terang.png`
- Menu akun dan dialog Panduan:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/menu-akun-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/panduan-terang.png`
- Galeri komponen, satu halaman penuh:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/komponen-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/komponen-terang.png`
- Dialog dan toast terbuka:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/dialog-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/toast-terang.png`
- Lebar 1024 px: `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/studio-1024-gelap.png`
- Gambar pembanding (atas: desain, tengah: app, bawah: selisih):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-07/banding/`
- Desain yang dibandingkan: `xdg-open /var/www/ai-asset-generate/design/exports/`

## Keputusan
Semuanya juga tercatat di Log keputusan `docs/PLAN.md` (baris 2026-11-14 "Tahap 7").
- **Desain lebih dulu:** komponen yang belum digambar dirancang di FigCraft (frame #2743), baru diimplementasikan.
  Persetujuannya oleh agent, di bawah delegasi pemilik.
- **Token `text/tertiary` dinaikkan** untuk kontras AA: gelap #8C8C93, terang #6A6A70. Baris versi aktif memakai
  `text/secondary`.
- **Ikon:** satu `LucideProvider` (garis 1,5 px), ukuran mengikuti komponen. 38 ikon di FigCraft dibetulkan ke
  ukuran itu.
- **Satuan:** ukuran file desimal (1 KB = 1000), sama dengan budget tier dan desain.
- **Menu dan tooltip:**
  - `Menu` tidak modal secara bawaan (axe `aria-hidden-focus`);
  - tooltip terbuka saat fokus hanya bila interaksi terakhir dari keyboard;
  - tooltip bukan deskripsi pemicu; pintasan diumumkan lewat `aria-keyshortcuts`.
- **Fokus:**
  - cincin fokus hanya dari satu aturan global `:focus-visible`; `outline-none` tidak dipakai pada elemen
    interaktif;
  - fokus awal Dialog jatuh ke kontrol pertama yang benar-benar menerima fokus.
- **Toast** tanpa live region sendiri; pengumuman lewat wilayah sonner (polite).
- **ProgressSteps** mengikuti status. Pilihan buka/tutup pengguna hanya berlaku selama status sama.
- **Button `loading`** menahan aktivasi di fase capture, juga dengan `asChild` dan sebagai pemicu Radix.
- **Layar yang belum digambar** disusun dari komponen yang ada: dialog Panduan, menu akun, Pengaturan sementara,
  404, dan error rute.
- **Teks yang ditulis agent:** penggunaan tier Ringan dan Maksimal, dan "Login lewat Claude Code" di chip akun
  (sampai data akun tersedia di Tahap 11).

## Temuan & risiko
- **Teks bisa bergeser ≤1,5 px dari FigCraft.** Penyebabnya lebar kotak teks FigCraft yang dibulatkan dan
  rasterisasi font yang berbeda. Posisi kotak tetap sama (geometri lolos 0,5 px).
- **Potongan "topbar kanan" Gudang berbeda 3,2–3,3%** karena isinya: jumlah aset di E2E bukan angka contoh di desain.
- **Chromium headless dengan skala 2** menggambar kotak di px bulat (15,5 → 16). Karena itu geometri dibandingkan
  lewat `boundingBox()`, bukan piksel.
- **Untuk Tahap 9:** langkah progres `pending` dianggap masih berjalan. Proses yang dihentikan harus menandai langkah
  yang belum jalan; kalau tidak, spinner berputar terus.
- **Tooltip tidak terbuka oleh fokus dari skrip** sebelum ada interaksi keyboard. Ini disengaja, dan pintasan
  viewer di Tahap 8 perlu memperhitungkannya.
- **Toast gagal juga diumumkan polite.** Bila kelak perlu assertive, gunakan wilayah alert tersendiri.
- **Belum diverifikasi dengan pembaca layar sungguhan** (Orca/NVDA). Nama, deskripsi, dan live region diverifikasi
  lewat pohon aksesibilitas Chromium, axe, dan atribut DOM.

## Belum dikerjakan / dipindah
- Pemetaan status aset → nada Badge → Tahap 10, bersama daftar Gudang (teks status sudah ada di `web/i18n/id.ts`).
- Data akun asli di chip akun dan Pengaturan lengkap → Tahap 11.
- **Menunggu izin pemilik:** commit. Repo belum punya commit; semua perubahan ada di working tree. Tahap ini tidak
  memakai kuota Claude.

## Pertanyaan untuk pemilik
Tidak ada yang memblokir. Bila sempat, mohon tinjau hal yang diputuskan agent atas nama Anda:
- teks penggunaan tier Ringan dan Maksimal;
- token `text/tertiary` yang sedikit lebih terang (gelap) dan lebih gelap (terang);
- frame komponen tambahan #2743 di FigCraft.

## Usulan tahap berikutnya
Tahap 8 — Viewer 3D:
- port perilaku `design/prototype/viewer-360.html` ke R3F (`frameloop="demand"`, `CameraControls`, preset sudut,
  gizmo yang bisa dipakai dengan keyboard, lantai yang hilang saat kamera di bawah, mode Clay/Wireframe/UV/Normal);
- test hook `window.__viewer` khusus mode tes;
- golden 7 preset × 2 tema.

Komponen Tahap 7 (IconButton dengan pintasan, Menu sudut, Tooltip) dipakai langsung di toolbar viewer.

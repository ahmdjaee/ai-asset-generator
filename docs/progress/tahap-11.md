# Tahap 11 — Pengaturan & state khusus

| | |
|---|---|
| Tanggal | 2026-11-18 |
| Status | disetujui ("lanjut", 2026-11-18) |
| Kondisi repo | belum di-commit (di atas `0e0d218`) |

## Ringkasan
- **Pengaturan lengkap:**
  - akun Claude;
  - model dan effort dari akun;
  - tier bawaan;
  - budget per tier yang divalidasi dan hanya berlaku untuk aset baru;
  - status runtime 3D dengan "Bangun image";
  - tema dan izin notifikasi.
- **State khusus:**
  - banner belum login / API key / Claude Code tidak berjalan;
  - banner runtime belum siap, membangun image, Docker mati, build image gagal;
  - blok thread belum login dan batas pemakaian dengan waktu reset;
  - kartu dock **Coba lagi** (giliran gagal) dan **Lanjutkan** (terputus);
  - notifikasi browser saat tab tidak dilihat.
- **Definition of Done terpenuhi.** Semua suite lolos dan E2E per state memakai driver palsu dengan axe.
- **Satu tambahan desain perlu Anda lihat:** kartu dock gagal/terputus (bagian C2 frame Tahap 11).

## Yang dikerjakan
- **Pengaturan**
  - File: `web/features/settings/SettingsPage.tsx`, `StatusSections.tsx`, `BudgetTable.tsx`, `budget-form.ts`.
  - Bilah simpan menempel di bawah dan hanya muncul bila ada perubahan. Batal membuang perubahan.
  - Isian budget:
    - menerima `9000`, `9.000`, `1,5 MB`, dan `800 KB`;
    - dirapikan saat fokus pindah;
    - pesan error tertaut lewat `aria-describedby`.
  - Model disimpan sebagai id lengkap, tetapi dicocokkan juga dengan alias dari `supportedModels()` (`findModel`).
- **Endpoint kesehatan**
  - Rute: `GET /api/health/{auth,runtime}?fresh=1` dan `POST /api/health/runtime/image`.
  - Event realtime `global` baru: `settings`, `runtime`, `auth`, diterima `web/features/status/StatusWatcher.tsx`.
- **Gerbang runtime di server.** Aksi yang mengirim pesan ke Claude ditolak `RUNTIME_NOT_READY` bila Docker mati atau
  image belum ada (`server/services/assets.ts`). Container memakai `docker run --pull never`.
- **Banner status**
  - Tampil di Studio, sesi, Gudang, dan Detail. Tidak di Pengaturan, karena masalahnya sudah dijelaskan di bagiannya.
  - Semua banner ada dalam satu live region yang selalu terpasang (`web/features/status/StatusBanners.tsx`).
- **Thread dan dock**
  - Blok `AUTH_REQUIRED` di `ThreadView.tsx`.
  - Kartu dock baru "Giliran Claude gagal" → `POST /retry` dan "Proses Claude terputus" → `POST /resume`
    (`Dock.tsx`, `queries.ts`).
- **Notifikasi**
  - Toast untuk aset lain.
  - Notification browser hanya dengan izin dan saat tab tersembunyi, untuk:
    - siap direview, selesai, gagal, butuh jawaban;
    - juga aset yang sedang dibuka.
  - Klik membuka sesinya.
  - File: `web/lib/notifications.ts`, `AssetWatcher.tsx`.
- **Ekspor Sumber**
  - ZIP membawa `budget.json` (snapshot budget aset).
  - README dan `scripts/runtime.ts probe --budget` memakai snapshot itu (item dari Tahap 10).
- **Composer Studio** memakai tier bawaan dan budget dari Pengaturan.
- **Galeri `/_komponen`** memuat banner status, blok belum login, dan kedua kartu dock baru.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos — server 823, web 479, cakupan 268 tes; 0 gagal |
| `bun run build` | lolos, tanpa warning |
| `SCREENSHOT_DIR=docs/progress/tahap-11 bun run e2e` | lolos — 90 tes (7 baru di `tests/e2e/states.e2e.ts`), axe 0 masalah serius, console bersih |
| `bun run e2e:api` | lolos — 1 tes, log server bersih |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos — 26 tes (205 dtk) dengan `--pull never`; 0 container tersisa |
| `bun run test:pipeline` | lolos — 17 tes |
| `bun run tokens:sync --check` | token sinkron |
| `bun run test:assetkit` | tidak dijalankan: `runtime/` tidak berubah di tahap ini |

## Angka
- **E2E per state** (`tests/e2e/states.e2e.ts`, project `aset`): ±14 dtk untuk 7 tes.
  - Pengaturan: budget tidak valid → Simpan nonaktif → disimpan → Studio memakai budget baru → Pulihkan bawaan.
  - Notifikasi diizinkan.
  - Banner belum login + image belum ada → Bangun image → membangun.
  - Banner API key + build gagal → Pengaturan dengan akhir log.
  - Thread `[keluar]`, `[batas]`, `[mati]` → Coba lagi → bentuk dasar siap direview.
- **Kotak "Akhir log build":** 5 baris terakhir yang tidak kosong. Ekor log yang disimpan server ≤2000 byte.

## Screenshot & file
- Pengaturan normal (gelap/terang), cocok dengan layar FigCraft 05:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/pengaturan-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/pengaturan-terang.png`
- Pengaturan bermasalah (API key, build gagal + log):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/pengaturan-bermasalah.png`
- Budget tidak valid:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/pengaturan-budget-tidak-valid.png`
- Banner di Studio dan Gudang:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/banner-belum-login-image.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/banner-api-key-build-gagal.png`
- Thread dan dock: belum login, batas pemakaian, giliran gagal:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/studio-belum-login.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/studio-batas-pemakaian.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-11/studio-giliran-gagal.png`
- Desain Tahap 11 (diperbarui dengan bagian C2 kartu dock):
  `xdg-open /var/www/ai-asset-generate/design/exports/11-pengaturan-state-khusus.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/11-pengaturan-state-khusus-terang.png`

## Keputusan
- **Identitas akun disembunyikan sementara** (permintaan pemilik setelah laporan pertama). Email dan jenis paket tidak
  tampil di chip/menu akun dan Pengaturan; akun yang login tampil "Akun Claude · Login lewat Claude Code". Diatur satu
  konstanta `SHOW_ACCOUNT_IDENTITY` di `web/lib/health.ts`, ubah ke `true` untuk menampilkannya lagi. FigCraft masih
  menampilkan email (selisih sementara yang disengaja). Screenshot `pengaturan-*.png` dan `menu-akun-*.png` sudah
  diperbarui.
Semua tercatat di Log keputusan `docs/PLAN.md` (2026-11-18). Ringkasnya:
- **Desain dan rekomendasi** disetujui lewat jawaban "lanjut":
  - batas atas budget = Maksimal bawaan;
  - tema tetap per browser;
  - runtime belum siap = banner + toast server, tombol kirim tidak dinonaktifkan.
- **Batas job bertekstur** dihitung dari budget, bukan dari nama tier.
- **`--pull never`.** Image hanya dari build lokal. Snapshot flag sandbox diperbarui.
- **Model dan effort** berlaku untuk proses Claude berikutnya.
- **Driver palsu:** penanda `[keluar]`, akun `pemilik@contoh.invalid`.
- **Kartu dock Coba lagi / Lanjutkan** untuk tahap yang masih dikerjakan. Bila versi sudah dikirim, kartu review tetap
  tampil.
- **Tes batas `ANTHROPIC_API_KEY`** mengecualikan `web/i18n/id.ts`, karena banner menyebut nama variabelnya. File itu
  tetap tidak boleh menyentuh env.

## Temuan & risiko
- **Chromium headless dan izin notifikasi.** `grantPermissions(["notifications"])` hanya mengubah Permissions API;
  `Notification.permission` tetap `denied`. E2E menimpa getter-nya, jadi notifikasi browser **sungguhan** belum
  terbukti di browser nyata. Tes komponen membuktikan logikanya (tab tersembunyi + izin → notifikasi, klik membuka
  sesi). Dicatat di AGENTS §13.
- **Gerbang `RUNTIME_NOT_READY` tidak bisa dipicu di E2E**, karena runtime fixture selalu siap. Gerbang ini diuji di
  tes service. Banner runtime di E2E memakai respons `/api/health/runtime` yang dicegat.
- **State "terputus" tidak diuji E2E**, karena butuh server dimatikan di tengah giliran. Diuji di tes komponen dock dan
  halaman sesi; jalur servernya sudah diuji sejak Tahap 5.
- **Coba lagi saat batas pemakaian** belum lewat waktu reset akan gagal lagi, dengan blok batas pemakaian yang sama.
  Tombolnya tidak dinonaktifkan sampai waktu reset.
- **Model tanpa effort** (daftar effort kosong): pilihan effort disembunyikan, tetapi nilai effort tersimpan tetap
  dikirim ke SDK. Perkiraan saya SDK mengabaikannya; belum terbukti tanpa uji nyata.
- **Selama sesi ini `web/features/settings/StatusSections.tsx` sempat diubah dari luar** (nama tampilan di-hardcode,
  baris asli dikomentari). Akibatnya dua tes Pengaturan gagal. Perubahan itu sudah dikembalikan sebelum `check`
  terakhir, jadi tidak saya sentuh.

## Belum dikerjakan / dipindah
- **Uji nyata** (`AGENT_DRIVER=sdk`) untuk belum login, batas pemakaian, dan model dari Pengaturan: butuh kuota dan
  izin Anda.
- **Tes notifikasi browser di Chrome sungguhan** (manual):
  1. izinkan notifikasi di Pengaturan;
  2. buat aset;
  3. pindah tab sampai aset siap direview.

## Pertanyaan untuk pemilik
1. **Kartu dock "Giliran Claude gagal" (Coba lagi) dan "Proses Claude terputus" (Lanjutkan)** ditambahkan setelah
   persetujuan desain, disusun dari kartu dock yang ada (bagian C2 di frame Tahap 11). Setuju dengan tampilan dan
   teksnya?
2. Tahap 11 siap di-review. Bila disetujui, apakah langsung lanjut ke Tahap 12 (pengerasan & rilis lokal)?

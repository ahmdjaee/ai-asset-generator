# Tahap 12 — Pengerasan & rilis lokal (M2)

| | |
|---|---|
| Tanggal | 2026-11-18 |
| Status | menunggu review |
| Kondisi repo | belum di-commit (di atas `0e0d218`, bersama perubahan Tahap 11) |

## Ringkasan
- **App siap dipakai harian.** Ini menutup M2: rilis lokal.
- **Pengerasan:**
  - error halaman tidak lagi menjatuhkan seluruh app;
  - database dibackup harian;
  - file sementara dan cache usang dibersihkan otomatis;
  - Chromium renderer didaur ulang.
- **Kesiapan mesin** dicek lewat `bun run doctor`.
- **Menjalankan otomatis:** unit systemd di `deploy/`. Cara memasang, update, backup, dan restore ada di `README.md`.
- **Definition of Done terpenuhi**, termasuk uji nyata pertama sampai DONE dengan Claude sungguhan (izin Anda): selesai
  dalam 4 menit 22 detik.

## Yang dikerjakan
- **Error boundary dua lapis + toast error global**
  - File: `web/app/routes.tsx` (`buildRoutes`), `web/app/pages.tsx` (`PageErrorPage`), `web/lib/global-errors.ts`.
  - Error di satu halaman (render gagal, chunk gagal diunduh) tampil di area utama, jadi rel tetap bisa dipakai.
    Pindah halaman memulihkannya.
  - Error yang lolos dari semua penanganan → satu toast "Terjadi kesalahan tak terduga" (tidak bertumpuk).
    Pembatalan yang disengaja (`AbortError`) tidak dihitung.
- **Performa**
  - **Bundle:** `scripts/check-bundle.ts` berjalan otomatis setelah `bun run build`. Build gagal bila:
    - halaman uji atau test hook ikut ke produksi;
    - three.js masuk chunk awal;
    - chunk awal > 300 kB gzip.
  - **Memori server:** `e2e:api` mengukur puncak RSS server selama alur penuh, dengan batas 400 MB.
  - **Chromium renderer:** diluncurkan ulang setelah 200 render, dan ditutup setelah menganggur 10 menit
    (`server/render/renderer.ts`).
- **Backup & retensi** (`server/services/maintenance.ts`, saat start lalu tiap jam)
  - Backup `VACUUM INTO data/backups/app-YYYYMMDD.db` harian, simpan 7.
  - Folder job usang (> 24 jam) dihapus.
  - Di `derived/` dibuang:
    - cache ekspor yang tidak diubah 30 hari;
    - ZIP Sumber bernama lama;
    - sisa `.tmp`;
    - folder untuk versi yang tidak ada.
  - Thumbnail, versi, dan aset tidak disentuh.
- **`bun run doctor`** (`scripts/doctor.ts`) memeriksa:
  - Bun, CLI `claude` + login (tanpa mencetak email), Docker + image, Chromium;
  - ruang disk, port 4340/4341, izin `data/`.

  Setiap kegagalan disertai langkah perbaikan.
- **systemd:** `deploy/ai-asset-generate.service`, dari unit ai-team.
  - `PATH` memuat `~/.bun/bin` dan `~/.local/bin`; `WorkingDirectory` di root repo; `TimeoutStopSec=30`.
  - Baris wajibnya dijaga `tests/architecture/deploy.test.ts`.
- **`README.md`** berbahasa Indonesia:
  - kebutuhan, instalasi, menjalankan (termasuk systemd), update;
  - data/backup/restore;
  - tabel pemecahan masalah yang memakai teks banner sebenarnya.
- **`/_smoke`** tidak pernah ada di build produksi; ini dijaga `check-bundle`. Vite dev tetap memuatnya untuk galeri
  `/_komponen`.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos — server 838, web 482, cakupan 268 tes; 0 gagal |
| `bun run build` | lolos, tanpa warning; `check-bundle` ✓ |
| `SCREENSHOT_DIR=docs/progress/tahap-12 bunx playwright test` | lolos — 91 tes (1 baru: chunk gagal → halaman error), axe 0 masalah serius, console bersih |
| `bun run e2e:api` | lolos — 1 tes, log server bersih, puncak RSS 232 MB |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos — 26 tes (228 dtk); 0 container tersisa |
| `bun run test:pipeline` | lolos — 18 tes (1 baru: kebijakan restart renderer) |
| `bun run test:assetkit` | lolos — 77 tes |
| `bun run tokens:sync --check` | token sinkron |
| `bun run doctor` | semua ✓ di mesin ini |
| `systemd-analyze --user verify deploy/ai-asset-generate.service` | tanpa masalah |
| **Uji nyata** (`sdk` × `docker`) | **DONE**, lihat Angka |

## Angka
**Uji nyata** "Peti kayu dengan engsel besi", tier Sedang, tanpa lampiran:
- **Cara menjalankan:** lewat API dev server Anda yang sedang berjalan (`bun run dev`, port 4340, `data/` asli).
  Persetujuan diberikan otomatis oleh skrip uji.
- **Waktu per tahap:**

  | Tahap | Waktu |
  |---|---|
  | Brief | 81 dtk |
  | Bentuk dasar | 60 dtk, 2 build (v1 8.536 → v2 6.576 segitiga) |
  | Tekstur | 80 dtk, 2 build (v3, v4) |
  | Total sampai DONE | **262 dtk** |

  Claude tidak mengajukan kartu pertanyaan.
- **Versi final v4:**
  - 6.576 / 8.000 segitiga;
  - 1 material: baseColor dan normal 1024 px, ORM 512 px;
  - `web.glb` 447 KB / 1,5 MB (dari `final.glb` 2,7 MB);
  - `gltf-validator` 0 error, 0 warning;
  - build bertekstur ±22 dtk.
- **Ekspor:**
  - Web: meshopt + WebP;
  - Unity: 2,7 MB, tanpa ekstensi kompresi, validator 0 error, 0 warning.
- **0 container `aag.job` tersisa.**

**Memori**
- **Server mode palsu** (`e2e:api`, satu alur penuh): puncak RSS 220–232 MB.
- **Dev server Anda saat uji nyata:** puncak RSS 598 MB. Angka ini sejak dev server start (`--watch`, React dev, plus
  pemakaian sebelumnya), jadi bukan angka satu alur.
- **Chromium:** ±608 MB, dijumlah dari semua proses `chromium`/`chrome-headless-shell` di mesin. Mungkin ikut
  menghitung proses headless lain, jadi ini batas atas.

**Bundle produksi (gzip)**

| Chunk | Ukuran |
|---|---|
| Chunk awal | 231 kB (anggaran 300 kB) |
| Viewer (lazy) | 288 kB |
| Sesi Studio (lazy) | 158 kB |

**Backup:** backup pertama di data asli `data/backups/app-20261118.db` (1,5 MB), `integrity_check` ok, 5 aset.

## Checklist rilis
- [x] Semua suite lolos: check, E2E, `e2e:api`, `RUNTIME_IT=1`, pipeline, assetkit, token.
- [x] Build produksi bersih: tanpa halaman uji, viewer lazy, chunk awal dalam anggaran.
- [x] `bun run doctor` semua ✓ di mesin ini.
- [x] Unit systemd lolos `systemd-analyze verify`, dan baris wajibnya dijaga tes.
- [x] README sesuai perilaku app: teks banner, ukuran image, cara login dicocokkan dengan kode.
- [x] Backup harian terbentuk di data asli dan bisa dibuka.
- [x] Uji nyata sampai DONE; ekspor Web/Unity valid.
- [x] Tanpa container job tersisa.
- [ ] Unit systemd **dipasang**: belum. Pemasangan di luar repo, jadi menunggu keputusan Anda (perintah di README).
- [ ] Commit: belum. Perubahan Tahap 11 dan 12 masih di working tree, menunggu permintaan Anda.

## Screenshot & file
- Uji nyata: sesi Studio selesai (thread, kartu "Aset selesai", viewer, panel detail):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-12/uji-nyata-sesi.png`
- Uji nyata: detail aset di Gudang:
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-12/uji-nyata-detail.png`
- Halaman error (chunk gagal diunduh, rel tetap ada):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-12/halaman-error.png`
- README: `xdg-open /var/www/ai-asset-generate/README.md`
- Unit systemd: `xdg-open /var/www/ai-asset-generate/deploy/ai-asset-generate.service`
- Screenshot E2E lainnya (shell, galeri, Studio, Gudang, Pengaturan, kedua tema) ada di
  `/var/www/ai-asset-generate/docs/progress/tahap-12/`.

## Keputusan
Semua tercatat di Log keputusan `docs/PLAN.md` (2026-11-18). Ringkasnya:
- **Error boundary:** halaman di area utama, kerangka app layar penuh. Tampilannya disusun dari EmptyState + Button
  seperti halaman 404, tanpa desain baru.
- **Angka batas di `shared/limits.ts`:**
  - daur ulang renderer 200 render / 10 menit menganggur;
  - pemeliharaan tiap jam: 7 backup, job > 24 jam, cache ekspor 30 hari;
  - ambang disk doctor 10 GB (peringatan) / 2 GB (gagal).
- **`VACUUM INTO` lewat `DatabaseHandle.backupInto`,** karena `bun:sqlite` hanya boleh di `server/db` (tes arsitektur).
- **Doctor tidak membaca variabel `ANTHROPIC_*`** (tes batas melarangnya). Sumber API key lain tetap terdeteksi lewat SDK.
- **Unit systemd tanpa `After=docker.service`:** unit user tidak bisa menunggu layanan sistem. Docker yang belum siap
  tampil sebagai banner.
- **`/_smoke` tetap di Vite dev,** karena AGENTS §8 menyebut galeri untuk "mode dev/tes".

## Temuan & risiko
- **Bug yang tertangkap tes:** `onDone?.(await runOnce())` tidak pernah menjalankan pemeliharaan bila `onDone` tidak
  diisi (argumen optional call tidak dievaluasi). Sudah diperbaiki dan dicatat di AGENTS §13.
- **Catatan kualitas dari Claude sendiri** di akhir uji nyata: ujung bulat tali engsel di atas tutup tampak setengah
  gelap dari sudut atas. Menurut Claude, perbaikannya harus di bentuk dasar, yang sudah terkunci setelah disetujui.
  Di screenshot cacatnya kecil, tetapi ini contoh nyata bahwa masalah bentuk yang baru terlihat di tahap tekstur butuh
  "Ubah bentuk" dari Anda.
- **Log dev server Anda selama uji nyata tidak saya baca,** karena tercetak di terminal Anda. Pemeriksaan "log server
  bersih" untuk uji nyata belum terverifikasi. Untuk mode palsu sudah (`e2e:api`).
- **Angka memori uji nyata bukan pengukuran bersih** (lihat Angka). Pengukuran bersih memerlukan server production
  yang baru start. Bisa diulang setelah unit systemd terpasang.
- **Pemeliharaan sudah berjalan di `data/` asli** sejak dev server memuat ulang kode baru. Yang terjadi: backup pertama
  dibuat; tidak ada folder job usang; cache ekspor belum ada yang berumur 30 hari.
- **Screenshot uji nyata diambil Chromium headless (GPU).** Console mencatat peringatan driver "GPU stall due to
  ReadPixels" karena screenshot itu sendiri. Itu bukan pesan app.

## Belum dikerjakan / dipindah
- **Memasang unit systemd** ke `~/.config/systemd/user`: di luar repo, jadi menunggu keputusan Anda.
- **Commit** perubahan Tahap 11 dan 12: menunggu permintaan Anda.

## Pertanyaan untuk pemilik
1. Tahap 12 (M2: rilis) siap di-review. Ini tahap terakhir di PLAN.
2. Mau saya **pasang unit systemd** sekarang? Perintahnya di README, § Menjalankan otomatis. Bila ya, `bun run dev`
   dan service tidak bisa berjalan bersamaan di port 4340.
3. Mau saya **commit** perubahan Tahap 11 dan 12? Usulan: beberapa commit rapi per area (server, web, scripts/deploy,
   docs).

## Usulan tahap berikutnya
Tidak ada tahap lanjutan di PLAN. Kandidat setelah rilis, bila Anda mau:
- pengukuran memori bersih di server production;
- KTX2;
- generator prosedural (Infinigen);
- tampilkan lagi identitas akun (`SHOW_ACCOUNT_IDENTITY`) setelah keputusan Anda.

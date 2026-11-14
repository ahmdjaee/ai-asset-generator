# Tahap 10 — Gudang, detail aset, ekspor

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **Gudang lengkap.** Cari (nama, prompt, kategori/ringkasan brief), filter Tier / Tahap / Tanggal, urutkan, tampilan
  grid dan daftar, dan state kosong. Mode pilih mengunduh ZIP streaming (Web atau Unity) dengan nama file aman.
  Semua state Gudang tersimpan di URL, dan breadcrumb Detail aset kembali ke daftar yang sama.
- **Thumbnail dan turntable per versi.** 24 frame dirender sekali ke strip WebP (12.096 px). Kartu memutar strip lewat
  CSS saat disorot atau difokus, tanpa WebGL per kartu. Thumbnail yang sama dipakai kartu Gudang, baris daftar, baris
  versi di panel Detail, dan kartu "Terakhir dibuat" (pindahan dari Tahap 9).
- **Detail aset (layar 04) dan aksi aset.** Viewer, prompt, lampiran, ringkasan brief, info, dan versi. Aksi
  Lanjutkan di Studio, Ekspor, Ganti nama, Duplikat, dan Hapus dipakai bersama oleh Gudang, Detail aset, dan menu "…"
  di topbar sesi Studio (pindahan dari Tahap 9).
- **Ekspor.** Dialog dengan pilihan versi dan ukuran tiap preset. Preset Web (`web.glb`), Unity (tanpa ekstensi
  kompresi, 0 error validator), dan Sumber (ZIP `.blend` + skrip + tekstur PNG + README). Hasil Unity dan Sumber
  di-cache di `derived/`. Skrip Sumber yang dijalankan ulang di container menghasilkan jumlah segitiga yang sama
  (dibuktikan di tes runtime Docker).
- **DoD terpenuhi**, kecuali uji import Unity yang memang diserahkan ke pemilik (panduan di bawah; Unity tidak
  terpasang di mesin ini).
- **Tinjauan independen** (subagent, tanpa mengubah file): 0 temuan tinggi, 3 sedang, 5 rendah, 6 belum terverifikasi.
  Semuanya diperbaiki dengan tes gagal lebih dulu, kecuali satu yang memang baru relevan di Tahap 11 (budget yang bisa
  diubah). Rincian di "Temuan & risiko".

## Yang dikerjakan
- **Cari, filter, urut** (`shared/asset-list.ts`, `server/db/repos/assets.ts`, `server/services/asset-queries.ts`,
  `GET /api/assets`):
  - LIKE di nama, prompt, dan kategori/ringkasan brief; `%`, `_`, `\` dicari apa adanya;
  - filter Tier, Tahap (bentuk dasar / aset final / selesai), Tanggal (24 jam / 7 hari / 30 hari);
  - urutan Terbaru / Terlama / Nama A–Z; daftar membawa `versionCount`.
- **Turntable dan thumbnail** (`server/render/turntable.ts`, `server/render/page/main.ts`,
  `server/services/thumbnails.ts`):
  - halaman render memutar model 24 frame (504×378, latar transparan) → `derived/vN/turntable.webp` + `thumb.webp`;
  - dibuat setelah build. Versi dari sebelum Tahap 10 dibuat di latar saat daftar atau detail membutuhkannya (satu per
    satu, flag `thumbnail` + event `asset updated`); permintaan gambar tidak pernah menunggu render;
  - golden baru `tests/goldens/render/{peti,grid}-turntable-0.png`; fixture `tests/fixtures/turntables/` untuk
    `RUNTIME_DRIVER=fixture`.
- **Ekspor** (`server/services/exports.ts`, `server/pipeline/unity.ts`, `server/services/zip-stream.ts`,
  `shared/export.ts`):
  - `GET /api/assets/:id/export?version&preset`, `GET /api/assets/:id/export/estimate?version`,
    `POST /api/assets/export-zip/prepare`, `GET /api/assets/export-zip?ids&preset`;
  - Unity: GLB dibuka dari ekstensi kompresi/kuantisasi, WebP/AVIF → PNG, divalidasi ulang;
  - Sumber: ZIP dengan satu folder akar `<nama>-vN-sumber/` berisi README (cara menjalankan ulang), `scene.blend`,
    `script.py` (+ `base.py`), `stats.json`, tekstur PNG;
  - ZIP banyak aset: tombol memeriksa aset dan menyiapkan GLB Unity lebih dulu (`prepare`, error sebagai toast), lalu
    browser mengunduh stream-nya lewat tautan sementara. Stream memakai backpressure; nama entri dari `safeFileStem`
    (zip-slip ditolak dua kali: saat nama dibuat dan saat entri ditulis);
  - error ke klien hanya pesan berbahasa Indonesia; detailnya ke log server.
- **`.blend` dari harness** (`runtime/assetkit/assetkit/io.py` `save_blend`, `run.py --blend`,
  `server/runtime/job-dir.ts`): disimpan setelah ekspor GLB dengan gambar dikemas; `API.md` dan pytest ikut diperbarui;
  fixture dibuat `bun scripts/runtime.ts blend-fixtures`. Teks dan driver Python dibuang sebelum disimpan, supaya
  `.blend` tidak menjalankan kode saat dibuka di Blender desktop.
- **Gudang** (`web/features/gudang/GudangPage.tsx`, `AssetRow.tsx`, `SelectionBar.tsx`, `list-state.ts`,
  `link-state.ts`, `asset-info.ts`): grid dan daftar, filter, mode pilih + bar ZIP (maks. 100 aset, keterangan batas
  diumumkan), state kosong / tanpa hasil / gagal dimuat, fokus pindah ke aset tetangga setelah hapus. Jumlah hasil
  cari/filter diumumkan pembaca layar lewat status tersembunyi.
- **Komponen dasar baru** (`web/components/ui/`): Dropdown, SearchField, Checkbox, RadioCards, Segmented varian
  `icons`. `AssetCard` mendapat turntable dan mode pilih. Semuanya ada di galeri `/_komponen`.
- **Detail aset** (`web/features/gudang/AssetDetailPage.tsx`, rute lazy `/gudang/:assetId`) dan **aksi aset**
  (`web/features/asset-actions/`): dialog ekspor, ganti nama, hapus; duplikat; aset yang dihapus di tab lain beralih ke
  state "Aset sudah dihapus".
- **Studio:** menu "…" di topbar sesi, thumbnail di baris versi (`VersionList`) dan kartu "Terakhir dibuat".
- **FigCraft** (`design/ai-asset-generate.figcraft`):
  - frame baru "Tahap 10 · Gudang, detail, ekspor": A filter Tanggal, B menu aset "…", C dialog ekspor, D ganti nama,
    E hapus, F mode pilih + bar pilihan, G tampilan daftar (biasa dan mode pilih);
  - layar 04 Detail aset disusun dari layar 02; layar 03 diperbarui (filter Tanggal);
  - PNG diekspor ulang: `03-gudang-grid` (+ terang), `04-detail-aset`, `10-komponen-gudang` (+ terang).
- **Tes:** E2E baru `tests/e2e/gudang.e2e.ts` (7 tes, project `aset`); tes komponen dan halaman Gudang, Detail aset,
  aksi aset, kartu, komponen dasar baru; tes server ekspor, ZIP, thumbnail, turntable, Unity; tes runtime Docker
  ekspor (Unity dan Sumber dari build sungguhan). `gudang.e2e.ts` kini 8 tes (tambahan: hapus dari menu baris daftar,
  fokus ke aset berikutnya lalu ke kolom cari).
- **AGENTS §13:** 13 jebakan baru (zona waktu `bun test`, replay toast sonner, navigasi router sebagai transition,
  `aria-hidden` dialog modal, landmark `<header>`, lapisan klik `label::after`, "Failed to load resource",
  skala screenshot Playwright, antialias tepi dalam outline Skia, animasi tutup Radix di happy-dom, kunci `"default"`
  entri awal router, `zipStream` membaca lebih dulu, kode di `.blend`).

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | Lolos: Biome, typecheck server + web, server 771 tes, web 446 tes, cakupan 257 tes (≥90% per file di `server/domain` dan `server/agent`) |
| `bun run e2e` (dengan `SCREENSHOT_DIR=docs/progress/tahap-10`) | Lolos: 83 tes dalam 5,7 mnt (project `chromium` 67, project `aset` 16, termasuk `gudang.e2e.ts` 8). `gudang.e2e.ts` saja (`--no-deps`): 8 lolos, 1,3 mnt |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | Lolos (diulang setelah perbaikan tinjauan): 26 tes di 7 file, 3 mnt 43 dtk; tanpa container `aag.job` tersisa. Termasuk ekspor dari build sungguhan: Unity (bentuk dasar dan aset final) 0 error validator tanpa ekstensi kompresi; Sumber bentuk dasar dan aset final dijalankan ulang di container → jumlah segitiga sama |
| `bun run test:assetkit` | Lolos: 77 tes pytest (termasuk `save_blend` membuang teks dan driver Python, dan `run.py --blend`), 5,6 dtk |
| `bun run test:pipeline` | Lolos: 17 tes, termasuk golden turntable; render 6 sudut p95 557 ms; turntable 24 frame 1.040 ms |
| `bun run e2e:api` | Lolos: 1 tes alur penuh HTTP + WebSocket, 14 pemeriksaan, 1,7 dtk |
| `bun run build` | Lolos tanpa warning (1,5 dtk). Chunk: `index` 714,6 kB (gzip 221,2), `StudioSessionPage` 536,3 kB (gzip 157,9), `Viewer` 1.078,8 kB (gzip 288,4), `AssetDetailPage` 5,3 kB, CSS 57,4 kB |
| `bun run tokens:sync --check` | Token sinkron dengan ekspor FigCraft |

**Tes wajib tahap ini:**

| Tes wajib | Di mana |
|---|---|
| E2E cari, filter, urut | `gudang.e2e.ts` "cari, filter, urutkan, tampilan daftar…" dan "Gudang kosong untuk pencarian…" |
| E2E ZIP | `gudang.e2e.ts` "mode pilih: ZIP Web dan Unity…" (isi ZIP dibuka, nama `'../../Lampu "gantung"\jahat'` → `lampu-gantung-jahat-v1-web.glb`) |
| E2E ganti nama, duplikat, hapus | `gudang.e2e.ts` "Detail aset: … ganti nama, duplikat, hapus" dan "Studio: … menu “…” di topbar sesi" |
| Validator setiap preset | Web: `web.glb` versi apa adanya, divalidasi sebelum kompresi dan dibaca ulang dengan dekoder meshopt (`server/pipeline/process.test.ts`; gltf-validator tidak membaca `EXT_meshopt_compression`). Unity: `server/pipeline/unity.test.ts`, `server/services/exports.test.ts`, tes runtime Docker, dan E2E (0 error, tanpa ekstensi kompresi). Sumber: isi ZIP diperiksa di `exports.test.ts` dan dijalankan ulang di tes runtime Docker |
| Zip-slip dan sanitasi nama | `shared/export.test.ts` (`safeFileStem`), `server/services/zip-stream.test.ts` (`assertZipPath`, stream diputus), `server/services/exports.test.ts` (nama aset berbahaya), E2E ZIP |
| axe | `gudang.e2e.ts`: grid, daftar, mode pilih, Detail aset, dialog ekspor (kedua tema) dan Gudang tanpa hasil; galeri `/_komponen` dengan bagian Gudang baru |

## Angka
- **Turntable:** 24 frame × 504×378 px → strip 12.096×378 px (batas WebP 16.383). Render 1.031 ms (SwiftShader, tes
  pipeline). Ukuran fixture: strip 118 KB (aset final) / 77 KB (bentuk dasar); thumbnail 6,7 KB / 4,9 KB.
- **Ekspor Unity dari fixture bertekstur** (`.tmp/debug/unity-size.ts`): peti 347 KB, makhluk 645 KB, bentuk
  dasarnya 97 KB dan 205 KB; 0 error dan 0 peringatan validator, tanpa ekstensi, 13–41 ms per file. Tekstur fixture
  memang JPEG (keputusan Tahap 4 supaya fixture kecil); build sungguhan diuji di tes runtime.
- **E2E:** 83 tes dalam 5,7 menit (Tahap 9: 75 tes). Gudang 8 tes dalam 1,3 menit, satu worker.
- **Bundle:** chunk awal `index` naik 3,9 kB dari Tahap 9 (710,7 → 714,6 kB). Detail aset memakai ulang chunk viewer dan
  panel Studio, jadi chunk sendirinya hanya 5,3 kB.

## Screenshot & file
- **Gudang** (grid, daftar, mode pilih, tanpa hasil):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/gudang-grid-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/gudang-daftar-terang.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/gudang-pilih-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/gudang-tanpa-hasil-gelap.png`
  Versi tema lain ada di folder yang sama (`gudang-grid-terang.png`, `gudang-daftar-gelap.png`,
  `gudang-pilih-terang.png`).
- **Detail aset dan dialog ekspor:**
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/detail-aset-gelap.png`
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/ekspor-gelap.png`
  Versi terang: `detail-aset-terang.png`, `ekspor-terang.png`.
- **Galeri komponen** (bagian "Kartu aset · mode pilih" dan "Cari, filter, kotak centang, kartu pilihan"):
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-10/komponen-gelap.png`
- **Desain FigCraft** (pembanding):
  `xdg-open /var/www/ai-asset-generate/design/exports/03-gudang-grid.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/04-detail-aset.png`
  `xdg-open /var/www/ai-asset-generate/design/exports/10-komponen-gudang.png`

## Panduan uji import Unity (glTFast)
Unity tidak terpasang di mesin ini, jadi uji ini untuk pemilik. Yang sudah dibuktikan otomatis: GLB Unity lolos
gltf-validator dengan 0 error, tanpa ekstensi kompresi/kuantisasi, dan teksturnya PNG/JPEG.

1. **Siapkan proyek Unity:** Unity 2022.3 LTS atau Unity 6, render pipeline apa saja (Built-in, URP, atau HDRP).
2. **Pasang glTFast:** Window → Package Manager → `+` → *Add package by name…* → `com.unity.cloud.gltfast`.
   Jangan pasang paket dekoder tambahan (meshopt, Draco, KTX). Preset Unity justru dibuat supaya tidak butuh paket
   itu.
3. **Ekspor dari app:** Gudang → buka aset → Ekspor → pilih versi → **Unity** → Unduh. Nama filenya
   `<nama-aset>-v<N>-unity.glb`. Ulangi untuk satu aset bentuk dasar dan satu aset final bertekstur.
4. **Impor:** seret file `.glb` ke jendela Project (folder `Assets/`). glTFast mengimpornya sebagai aset model; seret
   ke Scene.
5. **Periksa:**
   - Console tanpa error atau warning dari glTFast. Pesan tentang ekstensi yang tidak didukung (mis.
     `EXT_meshopt_compression`, `EXT_texture_webp`) berarti preset Unity bocor; laporkan.
   - Model berdiri tegak dan tidak tercermin. Bandingkan dengan sudut Depan di viewer app.
   - Ukuran sesuai baris "Dimensi" di panel Detail app (1 unit Unity = 1 m). Kubus bawaan Unity 1×1×1 bisa dipakai
     sebagai pembanding.
   - Aset final: warna, normal map, dan kekasaran tampil (material glTFast sesuai render pipeline). Bentuk dasar
     memang tanpa material.
   - Jumlah segitiga di Inspector mesh kurang lebih sama dengan "Segitiga" di panel Detail app.
6. **Laporkan:** versi Unity, render pipeline, versi glTFast, screenshot Scene, dan isi Console bila ada pesan.

## Keputusan
Semuanya tercatat di Log keputusan `PLAN.md` (14 Nov 2026). Yang utama:
- **Unduh massal lewat `GET /api/assets/export-zip`** (rencana awal `POST`), supaya ZIP diunduh browser langsung dan
  tidak dimuat ke memori JS. Sebelumnya `POST …/export-zip/prepare` memeriksa aset dan menyiapkan file Unity, jadi
  error tampil di app, bukan sebagai file rusak.
- **Preset Unity dari `base.glb`/`final.glb`** (belum dikompresi), divalidasi ulang. **Sumber** berisi README cara
  menjalankan ulang skrip. Keduanya di-cache di `derived/vN/`. Unity satu file per versi (write-once, tidak basi);
  Sumber per nama aset, karena folder akar dan README memuat nama.
- **`.blend` disimpan harness**, bukan skrip Claude. Versi aset final dari sebelum Tahap 10 tidak punya `.blend`;
  README Sumber mencatatnya.
- **Turntable dimuat saat disorot/difokus**, chip "360°" tampil setelah strip dimuat; tidak dimuat sama sekali bila
  animasi dikurangi.
- **State Gudang di URL** (`replace`), dibawa ke Detail aset lewat state navigasi.
- **Aset yang dihapus ditandai di cache** dan detailnya tidak diambil lagi; Detail aset dan sesi Studio beralih ke
  "Aset sudah dihapus".
- **Yang tidak digambar di FigCraft** disusun dari komponen yang ada: state kosong Gudang, letak bar mode pilih,
  keterangan batas ZIP, state Detail aset (memuat, tidak ditemukan, gagal, sudah dihapus).
- **Hasil tinjauan** (Log keputusan baris "Tahap 10 (tinjauan)"): thumbnail dibuat di latar, bukan saat gambar
  diminta; fokus setelah hapus dari Detail/Studio lewat state navigasi `arrivalFocus`; gema kolom cari dikenali dari
  nomor ketikan; panjang nama per code point; urut Nama memakai `Intl.Collator`.

## Temuan & risiko
- **Tinjauan independen** (subagent yang tidak mengubah file). Setiap temuan dicek ulang terhadap kode sebelum
  diperbaiki, dan setiap perbaikan datang bersama tesnya. Untuk #7, #11, #12, dan #14 tes terbukti gagal sebelum
  perbaikan. Untuk #7 juga dibuktikan dengan uji mutasi: tes gagal bila "sekali per entri riwayat" dihapus.

  | # | Temuan | Tingkat | Perbaikan | Tes |
  |---|---|---|---|---|
  | 1 | Kode dari skrip Claude (teks `use_module`, driver Python) bisa ikut di `.blend` Sumber dan berjalan di Blender desktop | Sedang (pengerasan keamanan) | `save_blend` membuang teks dan driver `SCRIPTED` (juga di node tree); README Sumber memperingatkan | pytest `test_simpan_blend_membuang_teks_dan_driver_python` |
  | 2 | Error ekspor Unity/Sumber sampai ke klien sebagai pesan mentah (Inggris, path absolut) dan tidak dicatat | Sedang | Pesan tetap berbahasa Indonesia; error dicatat sekali di log | `exports.test.ts` (GLB rusak, KTX2) |
  | 3 | Thumbnail yang belum ada dirender di dalam permintaan HTTP, satu per satu, dan render yang gagal diulang setiap permintaan | Sedang | Flag `thumbnail`, render di latar, memo gagal, event `asset updated` | `thumbnails.test.ts`, `asset-queries.test.ts`, `routes/assets.test.ts` |
  | 4 | Cache Sumber basi setelah ganti nama, dan ikut terbawa ke duplikat | Rendah | Cache per nama aset | `exports.test.ts` "Sumber setelah ganti nama" |
  | 5 | Error ZIP tidak tampil di app; konversi Unity baru berjalan setelah stream dimulai | Rendah | `prepare` + tombol memuat + toast; semua file disiapkan sebelum stream | `SelectionBar.test.tsx`, `exports.test.ts`, `routes/assets.test.ts`, E2E ZIP |
  | 6 | Thumbnail kartu yang gagal tidak dicoba lagi untuk URL versi baru; tanda strip siap terbawa | Rendah | State dicatat per URL | `AssetCard.test.tsx` "versi baru (URL lain)" |
  | 7 | Setelah hapus dari Detail aset atau sesi Studio, fokus jatuh ke `body` | Rendah (aksesibilitas) | State navigasi `arrivalFocus` | `AssetDetailPage`, `StudioSessionPage`, `GudangPage`, `StudioNewPage` test + E2E `toBeFocused()` |
  | 8 | Celah tes wajib: validator untuk Web, E2E hapus dari Gudang | Rendah | Tes validator Web (meshopt dibuka, 0 error); E2E hapus dari menu baris daftar (kartu grid tidak punya menu, sesuai desain) | `exports.test.ts`, `gudang.e2e.ts` |
  | 9 | Hapus berbalapan dengan render thumbnail atau ekspor yang masih berjalan | Belum terverifikasi → diperbaiki | Hapus menunggu pekerjaan aset itu | `assets.test.ts` "hapus menunggu pekerjaan turunan aset" |
  | 10 | Duplikat saat build berjalan bisa menyalin baris versi tanpa foldernya | Belum terverifikasi → diperbaiki | Hanya versi yang foldernya tersalin; entri staging dilewati | `assets.test.ts` "duplikat saat build menulis versi" |
  | 11 | Gema kolom cari melenceng bila router merangkum navigasi ("a", Backspace, "a"), lalu "Hapus filter" tidak mengosongkan kolom | Belum terverifikasi → terbukti, diperbaiki | Nomor ketikan di state navigasi | `GudangPage.test.tsx` "ketikan bernilai sama…" |
  | 12 | Batal saat unduhan ekspor masih menyimpan file bila respons tiba selama animasi tutup | Belum terverifikasi → terbukti, diperbaiki | Pembatalan mengikuti `open` | `AssetActions.test.tsx` "ditutup saat unduhan…" |
  | 13 | README Sumber menjalankan ulang dengan `DEFAULT_TIERS`, bukan `tierSnapshot` | Belum terverifikasi; tidak berdampak sampai budget bisa diubah | Dipindah ke checklist Tahap 11 | — |
  | 14 | Panjang nama dihitung per unit UTF-16 (80 emoji terpotong 40); urut Nama `NOCASE` hanya ASCII | Belum terverifikasi → terbukti, diperbaiki | Per code point; `Intl.Collator` | `assets.test.ts`, `GudangPage.test.tsx`, `repos.test.ts` |

- **Tambahan dari pemeriksaan sendiri:** hasil cari/filter berubah tanpa pengumuman untuk pembaca layar (WCAG 4.1.3).
  Sekarang ada status tersembunyi yang selalu terpasang ("3 aset ditemukan" / "Tidak ada hasil").
- **Batas yang tersisa:** cari (LIKE SQLite) hanya mengabaikan huruf besar/kecil ASCII, jadi "ōkami" tidak cocok dengan
  "Ōkami". Bahasa Indonesia memakai huruf ASCII, jadi dampaknya kecil; dicatat untuk nanti.
- **Bug yang ditemukan E2E dan diperbaiki** (masing-masing dengan tes gagal lebih dulu):
  - mengetik cepat di kolom cari Gudang menghapus huruf (URL tertinggal dari ketikan);
  - ukuran ekspor "≈" tetap tampil setelah file dibuat (estimasi tidak diambil ulang);
  - detail aset yang baru dihapus diambil ulang → 404 dan error console;
  - kotak centang mode pilih tertutup lapisan klik judul.
- **Tes yang disesuaikan:** cek piksel cincin fokus E2E sekarang membaca dua piksel pita cincin (Skia menghaluskan
  tepi dalam outline membulat ±97%). Cincin yang tertutup atau terpotong tetap gagal. Tes galeri memilih region
  "Kartu aset" dengan `exact: true`.
- **Peringatan act yang kadang muncul** di `AssetWatcher.test.tsx` saat file itu dijalankan sendiri (1 dari 3 run;
  "update to ForwardRef(Toaster)"). Tidak muncul di `bun run check`. Asalnya tes lama (Tahap 9): timer toast sonner
  memanggil `flushSync` di luar `act`. Belum diperbaiki; dicatat sebagai utang tes.
- **Tidak bisa diverifikasi di mesin ini:** impor di Unity (lihat panduan), dan perilaku pembaca layar sungguhan.

## Belum dikerjakan / dipindah
- **Uji import Unity (glTFast):** menunggu pemilik (panduan di atas).
- **→ Tahap 11:** ekspor Sumber memakai `tierSnapshot` aset saat budget bisa diubah (temuan tinjauan #13).
- **Dari Tahap 9, masih menunggu izin:** 1 uji nyata dengan Claude sungguhan (memakai kuota).

## Pertanyaan untuk pemilik
- **Uji import Unity:** mohon dicoba dengan panduan di atas bila sempat, dan kabari hasilnya.
- **Izin uji nyata** (pertanyaan Tahap 9, belum dijawab): satu aset sampai DONE lewat app dengan Claude sungguhan
  (`AGENT_DRIVER=sdk`, memakai kuota). Boleh dijalankan?

## Usulan tahap berikutnya
Tahap 11 — Pengaturan & state khusus:
- akun, model (`supportedModels()`), effort, budget tier (hanya untuk aset baru), status runtime, tema;
- state belum login, batas pemakaian + waktu reset, runtime belum siap, build gagal + coba lagi; notifikasi;
- info tier di composer memakai budget dari Pengaturan (pindahan dari Tahap 9);
- ekspor Sumber memakai `tierSnapshot` aset (pindahan dari Tahap 10).

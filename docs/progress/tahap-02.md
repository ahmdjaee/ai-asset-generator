# Tahap 2 — Pipeline inspeksi (tanpa Claude)

| | |
|---|---|
| Tanggal | 2026-11-13 |
| Status | menunggu review |
| Kondisi repo | belum di-commit (repo belum punya commit sama sekali) |

## Ringkasan
- Satu skrip Blender sekarang bisa menjadi versi aset lengkap lewat satu jalur:
  1. container Docker;
  2. optimasi per tier;
  3. gltf-validator (0 error);
  4. statistik dan budget;
  5. render contact sheet 6 sudut di Chromium + SwiftShader;
  6. versi `v1` yang read-only beserta manifest sha256.
- Render 6 sudut butuh p95 **0,47 dtk** dari 10 run. Batas DoD 8 dtk.
- **Semua Definition of Done terpenuhi.**
- Temuan Tahap 1 (server dev dan E2E saling menghapus job) juga sudah diperbaiki lewat label `aag.owner`.

## Yang dikerjakan
- **Jalur job berat** — `server/jobs/heavy-lane.ts`, `server/jobs/semaphore.ts` (port dari ai-team):
  - satu job sekaligus, antrean FIFO;
  - event `queued` (dengan `ahead`), `started`, `progress`, `finished`, `failed`, `cancelled`;
  - batal lewat `cancel(jobId)` atau `AbortSignal`, baik saat antre maupun berjalan. Slot baru dilepas setelah
    pekerjaan benar-benar berhenti.
- **Optimasi** — `server/pipeline/optimize.ts`. Urutannya:
  1. dedup;
  2. palet (khusus Ringan);
  3. flatten, join, weld;
  4. simplify (khusus bentuk dasar bila ≤ 1,25 × maks);
  5. prune;
  6. resize tekstur per slot sesuai tier.

  Preset Web (WebP + meshopt) dibuat **setelah** validasi.
- **Pipeline** — `server/pipeline/process.ts` (orkestrasi), `validate.ts` (gltf-validator, laporan divalidasi zod),
  `stats.ts` (segitiga dan vertex per instance node, material yang dipakai, tekstur per slot, bbox Y-up, byte),
  `io.ts`.
- **Budget** — `shared/limits.ts`:
  - budget 3 tier (Lampiran D), batas build, toleransi bentuk, batas job bertekstur, dan angka renderer;
  - `checkBudget(stats, tier, webBytes?)` mengembalikan selisih per item.

  Skema statistik ada di `shared/asset-stats.ts`.
- **Cek bentuk** — `server/domain/shape.ts`, fungsi murni: tiap sisi bbox ±5% (selisih ≤1 cm selalu lolos), jumlah
  segitiga ±25%.
- **Renderer** — `server/render/`:
  - satu Chromium hidup lama, halaman dipakai ulang, render satu per satu;
  - halaman (`page/main.ts`: three + GLTFLoader + MeshoptDecoder) di-bundle `Bun.build` dan dilayani dari memori
    lewat `page.route`. Tidak ada port terbuka, dan request lain diblokir;
  - mode clay, wireframe, dan tekstur; 6 sudut; grid lantai dari tekstur canvas dengan skala otomatis;
  - cakupan dan titik berat objek per sudut dihitung dari pass siluet;
  - contact sheet 1016 × 680 dengan sharp (`contact-sheet.ts`);
  - batas waktu 30 dtk dan pembatalan; browser yang crash diluncurkan ulang dan render dicoba ulang sekali.
- **Versi write-once** — `server/services/versions.ts`:
  - file ditulis di staging, dibuat read-only, lalu `manifest.json` (sha256) ditulis;
  - staging di-rename atomik ke `versions/vN`, lalu folder dibuat read-only;
  - tersedia `verifyVersion` dan `writeDerived` (atomik, ke `derived/vN/`).
- **Build versi** — `server/services/build-version.ts` (`buildBaseVersion`): skrip → runtime → pipeline → render →
  versi di dalam jalur job berat. Kegagalan skrip dikembalikan dengan kode `SCRIPT_ERROR`/`TIMEOUT`/`OOM`/
  `VALIDATION_FAILED`, termasuk ekor traceback.
- **`bun run pipeline:demo <skrip.py> --tier sedang`** — `scripts/pipeline-demo.ts`. Hasilnya ditulis ke
  `.tmp/pipeline-demo/`, tidak pernah ke `data/`.
- **Perbaikan dari Tahap 1:**
  - label `aag.owner` (hash `DATA_DIR`) di setiap container;
  - pembersihan yatim saat start hanya untuk pemilik yang sama;
  - snapshot argumen `docker run` diperbarui.
- **Tes:**

  | Lokasi | Isi |
  |---|---|
  | `shared/limits.test.ts` | budget |
  | `server/domain/shape.test.ts` | tabel 11 kasus |
  | `server/jobs/heavy-lane.test.ts` | jalur job berat |
  | `server/pipeline/*.test.ts` | fixture × 3 tier, simplify, tekstur, palet, validator gagal, batal, snapshot budget |
  | `server/services/versions.test.ts` | versi write-once |
  | `tests/pipeline/render.test.ts` | renderer + golden |
  | `tests/integration/runtime/build-version.test.ts` | Docker + Chromium sungguhan |

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos: lint + typecheck + 295 tes (253 server + 42 web), 0 gagal |
| `bun run test:pipeline` | lolos: 13 tes (SwiftShader, 6 sudut valid, 5 golden, siluet meshopt = siluet biasa, p95, crash/timeout/batal/GLB rusak/terlalu besar) |
| `bun run pipeline:demo runtime/samples/kursi.py --tier sedang` | v1 dibuat: folder `dr-xr-xr-x`, file `-r--r--r--`, manifest berisi 4 file + sha256. Menulis ke `base.glb` → `Permission denied` |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos: 14 tes (11 dari Tahap 1 + 3 build versi: sukses, `SCRIPT_ERROR` dengan traceback, batal saat berjalan) |
| `bun run test:assetkit` | lolos: 32 pytest |
| `docker ps -a --filter label=aag.job` | kosong setelah semua tes |
| `bun run build:test && bun run e2e:smoke` | lolos: 8/8 |
| Server start dengan 2 container yatim buatan (milik server ini dan milik pemilik lain) | hanya milik server ini yang dihapus (`removed: 1`); container uji milik pemilik lain saya hapus manual sesudahnya |

## Angka
| Ukuran | Hasil |
|---|---|
| Render 6 sudut, mode clay (laras, 10 run) | p95 **469 ms**, median 416 ms |
| Render pertama setelah peluncuran Chromium + bundle halaman | ±1,7–1,9 dtk |
| Demo kursi (Sedang), dari skrip sampai v1 | total 4,5 dtk: runtime 2,5 dtk, pipeline 32 ms, render 1,9 dtk (termasuk peluncuran Chromium) |
| Kursi: `base.glb` → `web.glb` (meshopt) | 18,3 KB → 6,4 KB |
| Tekstur 2048 px di tier Sedang | baseColor/normal → 1024, ORM → 512; Web memakai WebP |
| `memory.peak` job demo | 363 MiB. Contoh yang sama di Tahap 1 mencatat 125 MiB. Kemungkinan cache file ikut terhitung di cgroup; belum diselidiki |

## Screenshot & file
- `docs/progress/tahap-02/demo-kursi-v1-contact-sheet.png`: contact sheet v1 hasil `pipeline:demo`.
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-02/demo-kursi-v1-contact-sheet.png`
- `docs/progress/tahap-02/peti-clay.png`: golden mode clay (6 sudut berlabel, grid 10 cm).
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-02/peti-clay.png`
- `docs/progress/tahap-02/kursi-wireframe.png`: golden mode wireframe.
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-02/kursi-wireframe.png`
- `docs/progress/tahap-02/grid-texture.png`: golden mode tekstur dari `web.glb` (WebP + meshopt).
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-02/grid-texture.png`
- Golden baru (pertama kali dibuat, lewat `UPDATE_GOLDENS=1`): `tests/goldens/render/{peti-clay,kursi-clay,laras-clay,
  kursi-wireframe,grid-texture}.png`.
- Laporan ini: `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-02.md`

## Keputusan
Semua keputusan di bawah juga dicatat di Log keputusan `PLAN.md`.
- **"lanjut" saya anggap persetujuan Tahap 1.** Karena pertanyaan commit dan ruff belum dijawab, tidak ada yang
  di-commit dan ruff tidak ditambahkan.
- **Label `aag.owner`** per `DATA_DIR`. Pembersihan container yatim hanya untuk pemilik yang sama.
- **Renderer tanpa port:** bundle halaman dari `Bun.build`, dilayani `page.route`, request lain diblokir.
- **Contact sheet 3 × 2 tile 328 px** dengan label Indonesia. Konvensi sudut sama dengan viewport Blender. Skala grid
  otomatis.
- **Aturan optimasi:**
  - `prune()` mengganti tekstur polos dengan faktor material;
  - palet hanya Ringan;
  - simplify hanya bentuk dasar ≤ 1,25 × maks;
  - preset Web = WebP + meshopt `medium`.
- **Isi versi** = `base.glb`, `web.glb`, `script.py`, `stats.json`. Contact sheet disimpan di `derived/`.
- **Budget** dalam KB/MB desimal. `webBytes` hanya untuk aset final.
- **Toleransi bentuk** ±5% bbox, ±25% segitiga. Lampiran tidak menyebut angka, jadi ini usulan saya.
- **`buildBaseVersion`** ada di `server/services/` supaya dipakai ulang tool `forge` di Tahap 3.
- **`test:pipeline`** khusus tes yang butuh Chromium. Tes unit pipeline tetap ada di `bun run check`.
- **`tsconfig`:**
  - `server/render/page` diketik dengan tipe DOM (`tsconfig.web.json`) dan dikecualikan dari tsconfig server;
  - `tests/pipeline` masuk tsconfig server.

## Temuan & risiko
- **`memory.peak` job tidak konsisten** (125 vs 363 MiB untuk skrip yang sama). Ini memengaruhi angka RAM di Tahap 4.
  Perlu dicek apakah page cache ikut dihitung (`memory.stat` → `file` vs `anon`).
- **Folder versi read-only** membuat `rm -rf` biasa gagal. Untuk membersihkan demo: `chmod -R u+w .tmp/pipeline-demo`
  lalu hapus. Fitur hapus aset (Tahap 10) harus melakukan hal yang sama.
- **Golden bergantung pada SwiftShader dan font Chromium di mesin ini.** Upgrade Playwright atau Chromium kemungkinan
  butuh `UPDATE_GOLDENS=1` dengan pemeriksaan visual.
- **`join()` menggabungkan semua mesh dengan material yang sama** menjadi satu, sehingga nama objek dari Blender
  hilang. Untuk aset game ini diinginkan (draw call), tetapi bila kelak ada aset beranimasi atau bagian yang harus
  terpisah, perlu opsi `keepNamed`.
- **`pngjs` belum dipakai**, karena sharp yang men-decode PNG untuk pixelmatch.

## Belum dikerjakan / dipindah
Tidak ada.

## Pertanyaan untuk pemilik
1. Masih terbuka dari Tahap 1: mau saya commit hasil Tahap 0–2 sekarang? Misalnya satu commit per tahap.
2. Masih terbuka dari Tahap 1: setuju menambah **ruff** untuk kode Python di `runtime/`?
3. Toleransi cek bentuk (±5% ukuran, ±25% segitiga) adalah usulan saya. Setuju, atau mau lebih ketat atau longgar?
4. Mau `pngjs` dihapus dari dependensi karena tidak dipakai? Rekomendasi saya: hapus. Bisa juga ditunda sampai
   Tahap 8.

## Usulan tahap berikutnya
**Tahap 3 — Spike loop Claude: bentuk dasar.** Isinya: `AgentPort` + adaptor SDK, tool `forge` tahap 1 (memakai
`buildBaseVersion` dan contact sheet dari tahap ini), guard 3 lapis, system prompt + `runtime/knowledge/API.md`, lalu
`eval:base` dengan 5 prompt.

**Tahap 3 memakai kuota Claude** (`eval:base`, `AGENT_DRIVER=sdk`), jadi bagian itu hanya saya jalankan setelah Anda
izinkan secara eksplisit. Kode, tes dengan driver palsu, dan guard bisa dikerjakan tanpa kuota.

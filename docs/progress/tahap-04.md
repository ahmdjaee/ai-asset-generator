# Tahap 4 — Spike tahap tekstur

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui pemilik (gerbang **lanjut**, 2026-11-14) |
| Kondisi repo | belum di-commit |

## Ringkasan
- **Alur aset final bertekstur sudah berjalan dengan Claude sungguhan.** Pemilik menyetujui bentuk dasar, lalu Claude:
  1. memilih material dari pustaka CC0 lokal atau warna PBR;
  2. menulis `work/material.py`;
  3. menjalankan build. Harness mem-bake semuanya ke **1 material atlas** sesuai tier;
  4. memeriksa contact sheet bertekstur, lalu submit.
- **Putaran 1:** 3/3 kasus lolos syarat otomatis (1–2 build, ≤0,9 menit). Skor pemilik: pistol 3, peti 3, rubah 2.
  Hasilnya dinilai setara tier Ringan.
- **Perbaikan kualitas atas permintaan pemilik:**
  - arahan detail per tier;
  - cookbook yang lebih kaya;
  - helper material (variasi, keausan, kotoran, cat prosedural).
- **Eval ulang rubah:** lolos. Segitiganya 7.592 (sebelumnya 4.044), dengan mata, jari kaki, telapak menghadap depan,
  dan material bervariasi. Skor pemilik **3** ("matanya agak seram, tapi oke").
- Ketiga tier sesuai budget. Bake Maksimal terberat 69 dtk dengan RAM puncak 1,06 GB (batas 600 dtk / 2,5 GB).
- **Semua DoD terpenuhi.** Pemilik memutuskan lanjut ke Tahap 5 tanpa eval ulang peti dan pistol.

## Yang dikerjakan
- **Pustaka material** (`bun run textures:sync`):
  - 60 material ambientCG CC0 (1K + 2K JPG) dalam 8 kategori; daftarnya di `runtime/materials.txt`;
  - checksum sha256 di `runtime/materials.lock.json`;
  - redirect hanya ke host yang di-allowlist; User-Agent generik;
  - hasil di `data/library/materials/` + `catalog.json` + preview;
  - file utama: `scripts/textures-sync.ts`, `scripts/textures/library.ts`, `shared/material-catalog.ts`.
- **`assetkit` v0.2:**

  | Modul | Isi |
  |---|---|
  | `material` | `pbr` (+ `variation`), `from_library` (proyeksi kotak atau UV, `tint`, `roughness_scale`), `wear` (tepi aus, kotoran di celah), `assign` |
  | `uv` | `unwrap` (xatlas), `box_project` |
  | `bake` | `pbr` (detail normal high → low), `atlas` (tugas harness: gabung → xatlas → bake warna/normal/ORM/AO → 1 material) |
  | `decal` | `from_image` (gambar `refs/`), `paint` (lingkaran/persegi berwarna tanpa gambar) |
  | `scene` | `run_base()` (geometri dari bentuk dasar yang disetujui), `get(nama)` |

  - Ekspor bertekstur menyertakan tangent.
  - Tekstur per tier: Ringan 512 (warna saja), Sedang 1024/1024/512, Maksimal 2048/2048/1024.
- **Runner:**
  - pustaka dipasang read-only di `/materials`, hanya untuk job bertekstur;
  - snapshot argumen `docker run` baru untuk job bertekstur;
  - `job-dir.ts` menyalin skrip bentuk dasar sebagai `/job/base.py`.
- **Pipeline:**
  - `buildTexturedVersion`, dengan gerbang bentuk `SHAPE_DRIFT`;
  - `dropDisallowedSlots`;
  - tekstur `web.glb` dalam WebP.
- **Tool `forge`:**
  - tool baru:
    - `build_textured_asset` (`work/material.py`, maksimal 4 build per pesan);
    - `list_materials` (kueri + kategori, dengan 1 lembar contoh);
  - `inspect_version` mode `texture`;
  - submit tahap tekstur;
  - kode error `BASE_NOT_APPROVED`, `SHAPE_DRIFT`, `BASE_LOCKED`, `LIBRARY_MISSING`;
  - `Forge.approveBase()` = aksi pemilik;
  - hasil build menampilkan isi pesan validator dan `detailHint` (bentuk dasar di bawah 40% target segitiga);
  - file utama: `server/agent/forge/server.ts`, `server/library/materials.ts`, `server/services/build-version.ts`.
- **Bahan untuk Claude:**
  - bagian **Tahap tekstur** di `runtime/knowledge/API.md`, termasuk jebakan mirror sumbu Y;
  - konvensi detail per tier dan material di `CONVENTIONS.md`;
  - arahan detail per tier di system prompt (`DETAIL_USAGE` di `shared/limits.ts`);
  - resep yang diperbarui:
    - `simple-creature.md`: mata, hidung, telapak menghadap depan; moncong lama ternyata terbalik;
    - `crate.md`: paku keling, engsel;
    - `textured-crate.md`, `textured-creature.md`.
- **Eval:**
  - `bun run eval:texture`: melanjutkan sesi bentuk dasar, menyetujui bentuknya, lalu meminta aset final; mengukur
    konteks dan gambar;
  - helper bersama ada di `scripts/eval/session.ts`;
  - deteksi rujukan contact sheet mengenali bahasa Inggris.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos: lint + typecheck + 467 tes (425 server + 42 web) |
| `bun run test:assetkit` | lolos 72/72. Termasuk sanity bake (normal datar ≈ (0,5; 0,5; 1), ORM, AO), decal, cat prosedural, variasi, kotoran di sudut dalam, tepi aus, detail high-poly, tangent |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos 21/21. Termasuk build bertekstur per tier (dimensi tekstur, 1 material, `web.glb` ≤ maks, WebP + meshopt, tanpa peringatan tangent) dan `SHAPE_DRIFT` |
| `bun run test:pipeline` | lolos 13/13 |
| `bun run textures:sync` (kedua kali) | 60/60 "sudah ada", tidak ada unduhan ulang |
| `eval:texture` putaran 1 (peti; pistol + rubah) | 3/3 lolos (dengan izin) |
| `eval:base --only rubah` lalu `eval:texture --only rubah` | lolos keduanya (dengan izin) |
| `docker ps -a --filter label=aag.job` | kosong |

**Tes gerbang** (`server/agent/forge/server.test.ts`):
- build bertekstur sebelum bentuk dasar disetujui → `BASE_NOT_APPROVED`;
- bentuk menyimpang → `SHAPE_DRIFT`, tanpa versi baru;
- build ke-5 → `BUILD_CAP_REACHED`;
- `build_base_mesh`/`record_brief` di tahap tekstur → `BASE_LOCKED`;
- pustaka belum ada → `LIBRARY_MISSING`.

## Angka
**Build bertekstur per tier** (contoh peti terbaru dengan keausan, Docker nyata):

| Tier | Waktu job | RAM puncak | `web.glb` (target / maks) | Tekstur |
|---|---|---|---|---|
| Ringan | 7,4 dtk | 199 MiB | 70 KB (150 / 300 KB) | warna 512 |
| Sedang | 16,9 dtk | 358 MiB | 184 KB (800 / 1.500 KB) | warna 1024, normal 1024, ORM 512 |
| Maksimal | 69,3 dtk | 1.060 MiB | 394 KB (3 / 5 MB) | warna 2048, normal 2048, ORM 1024 |

Efek keausan butuh 24 sampel bake. Tanpa keausan, peti Maksimal hanya 13,9 dtk. Uji beban Maksimal (77 rb segitiga,
4 material pustaka): 16,0 dtk, 1.176 MiB, `web.glb` 3,3 MB (di atas target, di bawah maks).

**Eval** (model `claude-opus-5-5`, tier Sedang):

| Kasus | Tahap | Build | Waktu | Segitiga | Konteks terbesar | Gambar ke Claude | `web.glb` | Biaya setara API* | Skor pemilik |
|---|---|---|---|---|---|---|---|---|---|
| peti | tekstur (putaran 1) | 2 | 0,9 mnt | 1.774 | 47 rb | 4 | 232 KB | $0,90 | 3 |
| pistol-scifi | tekstur (putaran 1) | 2 | 0,9 mnt | 1.680 | 54 rb | 4 | 156 KB | $1,04 | 3 |
| rubah | tekstur (putaran 1) | 1 | 0,5 mnt | 4.044 | 41 rb | 1 | 290 KB | $0,82 | 2 |
| rubah | bentuk dasar ulang | 3 | 2,8 mnt | 7.592 | — | 3 | — | $0,75 | — |
| rubah | tekstur ulang | 1 | 0,9 mnt | 7.592 | 51 rb | 1 | 453 KB | $0,90 | 3 |

\* `total_cost_usd` dari SDK. Proses tekstur melanjutkan sesi bentuk dasar, dan sebagian besar biayanya membaca ulang
konteks (cache). Perkiraan: **±$1,65 setara API per aset** untuk bentuk dasar + tekstur.

## Screenshot & file
Eval ulang rubah (setelah perbaikan kualitas):
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/rubah-ulang-bentuk-dasar-v3.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/rubah-ulang-v4.png`

Putaran 1 (sebelum perbaikan):
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/peti-v4.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/pistol-scifi-v5.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/rubah-v4.png`

Contoh dari skrip contoh (tanpa Claude), sebelum dan sesudah perbaikan:
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/contoh-rubah-sedang.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/contoh-rubah-perbaikan.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/contoh-peti-sedang.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-04/contoh-peti-perbaikan.png`

Hasil eval lengkap (transcript, skrip tiap versi, statistik; di-gitignore):
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T17-05-54-844Z-texture/summary.md` (peti)
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T17-14-28-193Z-texture/summary.md` (pistol, rubah)
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T17-48-50-501Z/summary.md` (rubah ulang, bentuk dasar)
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T17-51-39-215Z-texture/summary.md` (rubah ulang, tekstur)

## Keputusan
Semua dicatat di Log keputusan `PLAN.md`. Yang terpenting:
- **Harness mem-bake semua material ke 1 material atlas.** Claude bebas memakai banyak material, dan GLB tetap 1
  material dengan UV xatlas.
- **`material.py` memanggil `scene.run_base()`.** Geometri sama dengan yang disetujui, dan server tetap menegakkan
  `SHAPE_DRIFT`.
- **Bentuk dikunci setelah disetujui** (`BASE_LOCKED`).
- **Satu sesi lintas tahap.** Konteks 41–54 rb token dan 1–4 gambar masih jauh dari batas.
- **Detail per tier adalah arahan, bukan gerbang.** Target 40–90% segitiga tier, dengan `detailHint` di hasil build.
- **Keausan dan kotoran dihitung Cycles saat bake.** Harganya waktu bake lebih lama (Maksimal 14 → 69 dtk).
- **Emisi ditunda** (keputusan pemilik).
- **Fixture bentuk dasar lama dibekukan untuk golden render.** Fixture bertekstur punya pasangan bentuk dasar sendiri.

## Temuan & risiko
- **Mata kartun terkesan seram** (komentar pemilik pada rubah ulang). Penyebabnya: Claude memakai bola mata putih yang
  tinggi (skala Z 1,25) dengan pupil kecil, sehingga kesannya melotot. Usulan perbaikan: resep makhluk memakai iris
  gelap besar (±60–70% bola mata) dan kilau yang lebih besar. Belum dikerjakan karena Tahap 4 sudah ditutup.
- **Perbaikan kualitas baru terbukti pada 1 kasus** (rubah). Peti dan pistol tidak dievaluasi ulang.
- **Waktu bake naik** bila Claude memakai `wear`. Masih jauh di bawah batas, tetapi terasa di UI (progres) pada tier
  Maksimal.
- **Decal gambar dan `bake.pbr` belum dipakai Claude.** Uji nyata decal butuh lampiran, yang tersedia di Tahap 9.
  `decal.paint` sudah terbukti di eval ulang rubah.
- **Ringkasan berpikir masih berbahasa Inggris** (temuan Tahap 3, pertanyaan masih terbuka).

## Belum dikerjakan / dipindah
- **Eval ulang peti dan pistol** dengan perbaikan kualitas: tidak dijalankan, karena pemilik memutuskan lanjut.
- **Bake emisi:** ditunda atas keputusan pemilik.
- **Perbaikan bentuk mata di resep makhluk:** dicatat di Temuan, belum masuk tahap mana pun.

## Pertanyaan untuk pemilik
Masih terbuka dari tahap sebelumnya, dan bawaan tetap berlaku bila tidak dijawab:
- commit Tahap 0–4;
- bahasa ringkasan berpikir;
- ruff;
- toleransi cek bentuk;
- `pngjs`.

## Usulan tahap berikutnya
**Tahap 5 — Inti server:**
- skema SQLite + migrasi;
- state machine `transition()` yang menggantikan state forge di memori;
- port `TaskRunner` (pool 2 proses);
- event store + bus;
- pemulihan saat start;
- driver palsu.

Tanpa kuota Claude.

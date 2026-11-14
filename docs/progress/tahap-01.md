# Tahap 1 — Spike runtime 3D (Docker + bpy + assetkit v0)

| | |
|---|---|
| Tanggal | 2026-11-13 |
| Status | menunggu review |
| Kondisi repo | belum di-commit (repo belum punya commit sama sekali) |

## Ringkasan
- Blender 5.2.4 LTS berjalan sebagai modul Python (`bpy`) di container Docker yang terkunci: tanpa jaringan,
  filesystem read-only, tanpa capability, dan bukan root.
- Ekspor GLB, bake Cycles CPU (normal + AO), dan xatlas berjalan dalam mode modul, jadi tarball Blender tidak
  diperlukan.
- Runner `server/runtime/docker.ts` menjalankan job dan membaca progres serta RAM puncak. Saat timeout atau batal,
  container di-kill. Container OOM terdeteksi, dan container selalu dihapus.
- `assetkit` v0 sudah punya 32 tes pytest. Ketiga skrip contoh menghasilkan GLB tanpa material dengan origin di
  dasar-tengah.
- **Semua Definition of Done terpenuhi.**

## Yang dikerjakan
- **Image runtime** — `runtime/Dockerfile`, `runtime/requirements.txt`:
  - `python:3.13-slim` di-pin dengan digest;
  - 7 library sistem hasil `ldd` bpy;
  - semua paket Python di-pin exact, termasuk dependensi turunan;
  - user non-root 10001, `HOME=/tmp`, `WORKDIR /job`.
- **`bun run runtime:build`** membangun `asset-forge:<hash Dockerfile + requirements.txt>`. File: `scripts/runtime.ts`,
  `server/runtime/image.ts`.
- **Probe** — `runtime/probes/probe_export.py`, `probe_bake.py`, `probe_xatlas.py`. Hasilnya di bagian Angka.
- **Runner** — `server/runtime/docker.ts`:
  - `buildRunArgs` (murni, dijaga snapshot) dan `runJob`;
  - parser protokol `@@aag` (zod, panjang baris dibatasi);
  - tail stdout/stderr 8 KB;
  - `docker inspect` (`OOMKilled`) → `docker rm -f`;
  - timeout atau `AbortSignal` → `docker kill`, diulang sampai container ada;
  - `removeOrphanJobs`, dipanggil saat server start (`server/main.ts`).
- **Output tidak dipercaya** — `server/runtime/outputs.ts`:
  - dibaca dengan `lstat`, hanya file biasa;
  - nama di-allowlist dan ukuran dibatasi (`BASE_OUTPUT_MAX_BYTES`);
  - symlink dan hardlink ditolak.
- **Folder job** — `server/runtime/job-dir.ts`: dibuat di bawah root yang ditentukan; penghapusan menolak path di luar
  root itu.
- **`assetkit` v0** — `runtime/assetkit/assetkit/`:

  | Modul | Isi |
  |---|---|
  | `scene` | `reset`, thread dari `AAG_THREADS` |
  | `prim` | box, cylinder, cone, sphere, torus (bmesh) |
  | `mod` | bevel, boolean (EXACT, cutter dihapus saat finalize), mirror, array |
  | `finalize` | modifier diterapkan lewat depsgraph, transform di-bake, merge by distance, normal, origin dasar-tengah |
  | `stats`, `io.export_glb` | statistik dan ekspor GLB, +Y up, tanpa material |
  | `protocol`, `run` | wrapper job: ekspor dan statistik sebagai tugas harness, `memory.peak` cgroup |

  Semua helper memakai data API. Satu-satunya operator yang dipakai adalah ekspor glTF.
- **pytest per helper** — `runtime/tests/` (32 tes). `bun run test:assetkit` menjalankannya lewat `runJob`, dengan flag
  sandbox yang sama dengan job sungguhan.
- **Skrip contoh** — `runtime/samples/{peti,kursi,laras}.py`. Fixture-nya ada di `tests/fixtures/glb/*.glb` +
  `*.stats.json` dan bisa dibuat ulang dengan `bun run runtime:samples`.
- **Tes integrasi** — `tests/integration/runtime/` (`RUNTIME_IT=1`):
  - jaringan (IP, DNS, gateway Docker, antarmuka selain `lo`);
  - tulis di luar `/job` dan `/tmp`;
  - uid bukan 0, `CapEff = 0`, `NoNewPrivs = 1`;
  - fork bomb;
  - OOM (batas 256 MB);
  - loop tak berujung → timeout dan kill;
  - batal lewat `AbortSignal`;
  - symlink ke `/etc/passwd`, folder, dan file asing di output;
  - ketiga contoh;
  - tidak ada container tersisa.
- **Tes unit tanpa Docker** — `server/runtime/*.test.ts` (42 tes):
  - snapshot argumen `docker run`;
  - penolakan jobId, mount, dan user yang tidak valid;
  - parser protokol, `TailBuffer`, `collectOutputs`, tag image, folder job.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run runtime:build` | `asset-forge:b0609fed0438` (1,93 GB). Build ulang dari cache pip ±2,5 menit; build pertama ±11 menit karena unduhan wheel bpy 403 MB |
| `bun run test:assetkit` | lolos: 32 pytest dalam 1,6 dtk (3,6 dtk termasuk start container) |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos: 11 tes, 0 gagal, 16 dtk |
| `docker ps -a --filter label=aag.job` | kosong setelah semua tes |
| `bun run check` | lolos: lint + typecheck + 216 tes (174 server + 42 web), 0 gagal |
| `bun run build:test && bun run e2e:smoke` | lolos: 8/8 (server sekarang memanggil Docker saat start) |
| Server start dengan 1 container `aag.job` buatan | log `container job yatim dihapus` dengan `removed: 1`; container hilang |
| `bun run runtime:samples` | 3 GLB + statistik di `tests/fixtures/glb/` (total 136 KB) |

## Angka
Semua angka diukur lewat `runJob` dengan flag sandbox sungguhan: 4 CPU, 1,5 GB, `AAG_THREADS=4`.
- **"Wall"** = `docker run` sampai container dihapus.
- **RAM puncak** = `memory.peak` cgroup.

| Job | Wall | RAM puncak | Catatan |
|---|---|---|---|
| Cold start (container + `import bpy`) | 1,64 dtk | 116 MiB | `import bpy` sendiri 0,9 dtk. Image sudah ada di cache disk; start pertama setelah reboot tidak diukur |
| Ekspor base (probe kubus) | 1,89 dtk | 126 MiB | Operator glTF 0,05–0,13 dtk |
| Skrip contoh → finalize → GLB + statistik | 1,9–2,5 dtk | 125 MiB | peti 328 segitiga, kursi 312, laras 1.648 |
| Bake normal + AO 256 px | 2,08 dtk | 136 MiB | AO 0,22 dtk |
| Bake normal + AO 1K | 5,86 dtk | 314 MiB | Normal 0,51 dtk, AO 3,48 dtk (16 sampel) |
| Bake normal + AO 2K | 17,87 dtk | 890 MiB | Normal 2,04 dtk, AO 13,78 dtk (16 sampel) |
| xatlas (kerucut 92 segitiga) | 1,78 dtk | 127 MiB | `parametrize` 0,02 dtk; UV ditulis kembali ke mesh |

Untuk Tahap 4: bake 2K pada scene sederhana memakai 890 MiB, masih jauh di bawah batas 2,5 GB. Waktu bake AO naik
sekitar 4× per kenaikan resolusi, jadi tier Maksimal masih jauh dari 600 dtk. Mesh yang lebih padat belum diukur.

## Screenshot & file
- `docs/progress/tahap-01/samples.png`: render Cycles ketiga contoh (peti, kursi, laras) setelah `finalize()`.
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-01/samples.png`
- `docs/progress/tahap-01/bake-ao-256.png`: hasil bake AO 256 px dari probe. Bagian bawah bola lebih gelap karena
  tertutup alas.
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-01/bake-ao-256.png`
- Laporan ini: `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-01.md`

## Keputusan
Semua keputusan di bawah juga dicatat di Log keputusan `PLAN.md`.
- **Tag image** = hash `Dockerfile` + `requirements.txt` saja, karena `assetkit` dipasang read-only saat job berjalan.
  Mengubah helper tidak perlu build ulang image 2 GB.
- **Semua paket Python di-pin exact.** Library sistem diambil dari `ldd`. `libegl1`, `libgomp1`, dan `libxxf86vm1`
  terbukti tidak perlu.
- **Flag tambahan runner:**
  - `--init`;
  - `--mount type=bind`, bukan `-v`;
  - tmpfs `nosuid,nodev`;
  - env `PYTHONPATH`/`PYTHONDONTWRITEBYTECODE` dipasang runner;
  - path mount yang berisi koma ditolak.
- **Job berjalan sebagai uid:gid pemilik**, supaya file output langsung miliknya.
- **`test:assetkit` lewat `runJob`**, dan ada perintah tambahan `runtime:samples`.
- **Output di `/job/out/`.** Hanya `base.glb` dan `stats.json` yang diterima; hardlink juga ditolak.
- **Container yatim dibersihkan saat start**, secara fire-and-forget: Docker yang mati tidak menghalangi app terbuka.
- **`tests/fixtures/` dikecualikan dari Biome**, karena isinya hasil generator.

## Temuan & risiko
- **Dua server app yang berjalan bersamaan** (mis. `dev` dan E2E) bisa saling menghapus container job saat start.
  Di Tahap 2, saat job pertama dijalankan server, label sebaiknya diberi id instance.
- **Belum ada linter untuk kode Python** (`assetkit`, tes, contoh); kualitasnya hanya dijaga pytest. Ruff tidak ada di
  TECH_STACK, jadi belum ditambahkan.
- **API bpy 5.2 yang perlu diingat Claude di Tahap 3** (sudah dicatat di AGENTS §13):
  - `import bmesh`/`mathutils` harus setelah `import bpy`;
  - `calc_uvs` butuh layer UV yang sudah ada;
  - `Material.use_nodes` deprecated.
- **Image 1,93 GB** (wheel bpy saja ±400 MB terkompresi). Build pertama butuh ±11 menit di jaringan mesin ini.
- **`stats()` menghitung semua mesh di scene**, kecuali cutter boolean. Objek bantu lain yang disembunyikan Claude akan
  ikut dihitung dan diekspor (`use_visible` hanya menyaring yang disembunyikan). Aturan untuk objek bantu ditentukan
  di Tahap 3.
- **Belum diverifikasi:**
  - start dingin sungguhan setelah reboot (cache disk kosong);
  - bake pada mesh padat (30k–50k segitiga, tier Maksimal). Itu bagian Tahap 4.

## Belum dikerjakan / dipindah
Tidak ada. Image spike sementara (`aag-forge-spike:0`) sudah dihapus. Satu-satunya image proyek ini sekarang
`asset-forge:b0609fed0438`.

## Pertanyaan untuk pemilik
1. Repo belum punya commit, dan hasil Tahap 0 + Tahap 1 masih belum di-commit. Mau saya buatkan commit sekarang?
   Misalnya satu commit per tahap, dengan pesan Conventional Commits dalam bahasa Inggris.
2. Setuju menambah **ruff** (linter + formatter Python, MIT) ke TECH_STACK di Tahap 2 untuk kode `runtime/`?

## Usulan tahap berikutnya
**Tahap 2 — Pipeline inspeksi (tanpa Claude):**
- jalur job berat (semaphore 1, antrean, batal, progres);
- optimasi gltf-transform per tier, `gltf-validator` sebelum meshopt;
- cek budget;
- renderer Chromium → contact sheet;
- versi write-once.

Fixture `tests/fixtures/glb/` dari tahap ini menjadi input awalnya. Penyesuaian yang saya sarankan:
- label container memuat id instance server (lihat Temuan);
- runner `runJob` dipakai apa adanya oleh heavy-lane.

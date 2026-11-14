# Rencana implementasi — AI Asset Generate

| | |
|---|---|
| **Tahap aktif** | **Tahap 11 — Pengaturan & state khusus** |
| Status tahap aktif | belum mulai (menunggu pemilik) |
| Diperbarui | 14 Nov 2026 |

> **Agent:** baca [`../AGENTS.md`](../AGENTS.md) lebih dulu.
> - Kerjakan **hanya** tahap aktif.
> - Di akhir tahap, tulis laporan lalu **berhenti**.
> - Penanda "Tahap aktif" hanya dipindah setelah pemilik menyetujui secara eksplisit.

Dokumen terkait:
- [`TECH_STACK.md`](TECH_STACK.md): library, versi, alasan.
- [`progress/`](progress/): laporan tiap tahap.
- Desain: `design/ai-asset-generate.figcraft` dan PNG di `design/exports/`.

---

## 1. Cara memakai dokumen ini
- **Status tahap:** `belum mulai` → `berjalan` → `menunggu review` → `disetujui`.
  Saat menulis laporan, agent mengubah status ke `menunggu review`.
  Status `disetujui` dan perpindahan tahap aktif hanya terjadi setelah pemilik setuju.
- **Checklist:** centang `[x]` hanya bila tugas selesai **dan** terverifikasi. Tugas yang dipindah ke tahap lain diberi
  catatan `→ Tahap N` beserta alasannya.
- **Log keputusan** (bagian paling bawah): setiap keputusan teknis yang mengubah rencana, dependensi, atau perilaku
  dicatat dengan tanggal dan alasan.
- **Laporan tahap:** `docs/progress/tahap-NN.md` mengikuti template di [`progress/README.md`](progress/README.md).
  Bukti visual disimpan di `docs/progress/tahap-NN/`.
- **Kuota Claude:** perintah yang memanggil model sungguhan (`eval:*`, uji nyata, `AGENT_DRIVER=sdk`) hanya dijalankan
  setelah pemilik mengizinkan.

## 2. Ringkasan produk
App web lokal, satu pengguna, untuk membuat aset 3D `.glb` dari prompt teks dan lampiran (gambar referensi, model 3D).

**Alur kerja**
1. Claude (lewat sesi login Claude Code, tanpa API key) memahami brief dan bertanya bila perlu.
2. Claude menulis skrip Blender memakai `assetkit`. Skrip dijalankan headless di sandbox Docker.
3. Claude melihat hasil render dan memperbaiki skripnya sendiri.

**Dua tahap**
1. **Bentuk dasar abu-abu** (tanpa material). Pemilik menyetujui atau meminta revisi.
2. **Aset final bertekstur**: UV, material PBR (termasuk pustaka CC0), bake normal/AO, dan optimasi sesuai tier.

**Fitur utama**
- Tier: Ringan, Sedang, Maksimal.
- Viewer 360° (orbit penuh, sudut cepat, gizmo).
- Gudang aset.
- Ekspor preset Web, Unity, dan Sumber.
- Pengaturan.
- Tema gelap (utama) dan terang. UI berbahasa Indonesia.

**Desain** (disetujui 13 Nov 2026)
- Foundations, Components, dan layar kunci: `design/exports/` (`00-*`, `01-studio-baru*`,
  `02-studio-review-bentuk-dasar`, `03-gudang-grid*`).
- Layar yang belum digambar disusun dari komponen dan token yang sudah ada:
  - Studio: Claude bertanya, progres, revisi, aset final siap;
  - dialog ekspor, detail aset, Pengaturan, Gudang kosong, state khusus.
- Keputusan visual baru yang signifikan dibuat dulu di FigCraft dan disetujui pemilik. Tidak ada prototipe HTML.

## 3. Status semua tahap
| Tahap | Judul | Status | Gerbang |
|---|---|---|---|
| 0 | Fondasi & gerbang kompatibilitas | disetujui | review |
| 1 | Spike runtime 3D (Docker + bpy + assetkit v0) | disetujui | review |
| 2 | Pipeline inspeksi (optimasi, validasi, render, versi) | disetujui | review |
| 3 | Spike loop Claude: bentuk dasar | disetujui | **lanjut/tidak** |
| 4 | Spike tahap tekstur | disetujui | **lanjut/tidak** |
| 5 | Inti server: domain, data, runner | disetujui (tinjauan agent) | review |
| 6 | API & realtime | disetujui (tinjauan agent) | review |
| 7 | Shell web & komponen | disetujui (tinjauan agent) | review |
| 8 | Viewer 3D | disetujui (tinjauan agent) | review |
| 9 | Studio lengkap — **M1: app bisa dipakai** | disetujui (tinjauan agent) | review |
| 10 | Gudang, detail aset, ekspor | disetujui (tinjauan agent) | review |
| 11 | Pengaturan & state khusus | belum mulai | review |
| 12 | Pengerasan & rilis lokal — **M2: rilis** | belum mulai | review |

## 4. Prinsip pengerjaan
1. **Risiko terbesar dulu.** Runtime Blender (Tahap 1–2), kualitas loop Claude (3), dan tahap tekstur (4) dibuktikan
   sebelum UI dibangun. Bila spike gagal, arsitektur diubah sebelum banyak kode bergantung padanya.
2. **Irisan kecil yang bisa diverifikasi.** Setiap tahap menghasilkan sesuatu yang bisa dijalankan dan dites.
3. **Tes ditulis bersamaan dengan kode**, bukan di akhir.
4. **Satu sumber kebenaran:**
   - batas angka di `shared/limits.ts`;
   - status aset lewat `transition()`;
   - token desain dari FigCraft;
   - library dari `TECH_STACK.md`.
5. **Gerbang di server.** Aturan dua tahap, budget, dan batas build ditegakkan server dan tool MCP, bukan oleh prompt
   atau tombol UI.
6. **Tanpa kuota pada tes rutin.** Tes harian memakai driver palsu. Model sungguhan hanya untuk spike dan uji nyata,
   dengan izin.

---

## 5. Tahapan

### Tahap 0 — Fondasi & gerbang kompatibilitas
**Tujuan.** Repo sehat, dan semua library terpilih terbukti berjalan bersama di mesin ini sebelum fitur dibuat.

**Lingkup.**
- Masuk: tooling, kerangka server dan web, token desain, kerangka tes, smoke test kompatibilitas.
- Tidak termasuk: fitur produk.

**Tugas**
- [x] `git init` (branch `main`).
  - `.gitignore`: `node_modules`, `dist`, `data`, `.env*` (kecuali `.env.example`), `test-results`, `playwright-report`, `eval/runs`.
    Ditambah `dist-test/`, `.tmp/`, `coverage/`.
  - `.editorconfig`, `.env.example`.
- [x] `package.json` dengan versi **exact** sesuai `TECH_STACK.md`, lalu `bun install`. `bun.lock` ikut di-commit saat diminta.
  Tambahan: `@hono/bun` 1.0.1 (lihat Log keputusan).
- [x] TypeScript:
  - `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
    `noImplicitOverride`, `noFallthroughCasesInSwitch`, `moduleResolution: bundler`, `allowImportingTsExtensions`, `noEmit`.
    Basisnya menjadi `tsconfig.json` (lihat Log keputusan).
  - `tsconfig.server.json`: `server`, `shared`, `scripts`, `tests` non-web; tipe Bun.
  - `tsconfig.web.json`: `web`, `shared`; lib DOM, `jsx: react-jsx`.
  - Script `typecheck` menjalankan keduanya.
- [x] Biome (`biome.json`):
  - recommended + `noExplicitAny: error` + `noFloatingPromises`;
  - parser CSS dengan direktif Tailwind;
  - abaikan `data/`, `dist/`, `design/`. Juga `*.md` dan file hasil generator token.
- [x] lefthook: pre-commit `biome check --staged` + `typecheck`; pre-push `bun run test`.
- [x] Script `package.json`:
  - `dev` (`scripts/dev.ts`, port dari ai-team `scripts/dev.mjs`), `build`, `start`;
  - `typecheck`, `lint`, `format`;
  - `test` (= `test:server` + `test:web`), `e2e`, `e2e:smoke`;
  - `check` (= lint + typecheck + test);
  - `check:auth`, `tokens:sync`, `db:generate`.
  - `dev` mengecek dulu bahwa port API dan Vite bebas (lihat Log keputusan).
- [x] Server:
  - `server/main.ts`: `Bun.serve` di `127.0.0.1:4340`, `idleTimeout` diatur. (Port semula 4330; lihat Log keputusan.)
  - `server/app.ts`: app Hono, ekspor `type AppType`.
  - `server/config.ts`: env divalidasi zod; `agentEnv()` di-port.
  - `server/http/guard.ts`: inti `http-guard.ts` ai-team sebagai middleware, juga dipakai sebelum upgrade WebSocket.
  - `server/http/errors.ts`: format `{ code, message }`.
  - `GET /api/health` → `{ ok, version }`.
  - WebSocket echo sementara di `/api/ws` (diganti di Tahap 6).
  - Logger pino.
- [x] Database:
  - `server/db/client.ts`: `bun:sqlite` dengan PRAGMA `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`.
  - `server/db/schema.ts` minimal (tabel `meta`), `drizzle.config.ts`, migrasi pertama via `db:generate`.
  - Migrasi dijalankan saat start.
- [x] Web:
  - Vite (`root: web`, port 4341, proxy `/api` + WebSocket ke 4340).
  - `web/main.tsx`; router dengan placeholder Studio / Gudang / Pengaturan.
  - Provider TanStack Query, client `hc`.
  - Tema: port `web/theme.ts` ai-team (sistem/gelap/terang, diterapkan sebelum render pertama).
  - Font Inter lokal.
- [x] Token desain:
  - Ekspor koleksi variabel FigCraft (format JSON) ke `design/tokens/figcraft-variables.json`. Text style diekspor ke
    `design/tokens/figcraft-text-styles.json`.
  - `scripts/sync-tokens.ts` (`bun run tokens:sync`) menghasilkan `web/styles/tokens.css`:
    - nama semantik `--color-{grup}-{nama}`;
    - gelap sebagai bawaan, `[data-theme="light"]` untuk terang;
    - `@theme inline` untuk kelas Tailwind. Diganti `@theme static` (lihat Log keputusan);
    - radius 6/8/12, grid 4 px, tipografi Inter 12–24 px. FigCraft juga punya radius 4 (`sm`), jadi ikut diekspor.
  - Tambahan: `web/styles/tokens.ts` (nama token + nilai per tema) dan `tokens:sync --check`.
- [x] shadcn: `components.json` (Tailwind v4) dan komponen `Button` yang sudah memakai token.
- [x] Halaman uji internal `/_smoke`, hanya di mode dev/tes. Berisi `Button`, contoh streamdown, dan kanvas R3F dengan kubus.
  Halaman ini tetap dibatasi ke mode tes sampai Tahap 12. Ditambah status echo WebSocket.
- [x] `tests/smoke/imports.test.ts`: import setiap paket server di Bun (sharp, gltf-transform, meshoptimizer,
  gltf-validator, fflate, playwright, pino, drizzle, hono, Agent SDK).
- [x] `scripts/check-auth.ts` (`bun run check:auth`), port pola `server/routes/health.ts` ai-team:
  - `query()` dengan prompt yang tidak pernah mengirim pesan;
  - panggil `accountInfo()`;
  - cetak email, langganan, dan `apiKeySource`.

  Tidak ada panggilan model.
- [x] `playwright.config.ts`:
  - Chromium dengan `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, DPR 1;
  - `webServer` menjalankan app;
  - helper axe.
- [x] Isi bagian "Status kompatibilitas" di `TECH_STACK.md`.

**Tes wajib**
- Unit: parsing config, pagar Host/Origin (Host atau Origin asing → 403).
- Rute: `app.request('/api/health')`.
- Komponen: toggle tema.
- E2E `e2e:smoke`, di kedua tema:
  - halaman terbuka tanpa error console;
  - axe 0 masalah serius/kritis;
  - kanvas R3F tidak kosong (cek piksel);
  - streamdown merender heading dan list.

**Definition of Done**
- [x] `bun install --frozen-lockfile` berhasil
- [x] `bun run check` exit 0
- [x] `bun run build` tanpa warning export yang hilang
- [x] `bun run e2e:smoke` lolos
- [x] `bun run check:auth` menampilkan email pemilik dan `apiKeySource: none`
  (SDK tidak mengisi `apiKeySource` untuk sesi login, jadi skrip menampilkan `none (tidak dilaporkan SDK)`;
  lihat Status kompatibilitas di TECH_STACK)
- [x] `bun run dev` → `http://127.0.0.1:4341` tampil dengan token gelap/terang
- [x] Laporan `docs/progress/tahap-00.md`

**Risiko → mitigasi**
- Paket tidak kompatibel dengan TS 7, Vite 8, atau Bun → dicatat di Status kompatibilitas. Pin versi lain dan catat di Log.

### Tahap 1 — Spike runtime 3D (Docker + bpy + assetkit v0)
**Tujuan.** Membuktikan bahwa Blender bisa berjalan headless di sandbox, mengekspor glTF, dan melakukan bake di CPU.
Juga menyiapkan fondasi `assetkit`.

**Lingkup.**
- Masuk: image, runner Docker, `assetkit` v0, probe ekspor/bake/xatlas, pengukuran.
- Tidak termasuk: optimasi, Claude, UI.

**Tugas**
- [x] `runtime/Dockerfile`:
  - `python:3.13-slim` di-pin dengan digest, beserta library sistem yang dibutuhkan bpy (ditentukan saat spike);
  - `pip install bpy==5.2.4 xatlas==0.0.11 numpy pytest` dengan versi exact;
  - user non-root, `HOME=/tmp`, workdir `/job`.
- [x] `bun run runtime:build` → image bertag `asset-forge:<hash isi runtime/>`.
- [x] Probe di `runtime/probes/`:
  - ekspor GLB (`bpy.ops.export_scene.gltf` dalam mode modul);
  - bake Cycles CPU normal + AO 256 px;
  - impor xatlas.

  Hasilnya dicatat.
- [x] `server/runtime/docker.ts`, fungsi `runJob({ jobId, image, jobDir, refsDir?, limits, timeoutMs, signal })`.
  Hasil bertipe: `exitCode`, `oom`, `timedOut`, `durationMs`, `peakMemBytes`, `stdoutTail`, `stderrTail`, `progress[]`.
  - Argumen berupa array. Flag tetap:
    - `--network none`;
    - `--read-only --tmpfs /tmp:rw,size=512m`;
    - `--cap-drop ALL --security-opt no-new-privileges`;
    - `--pids-limit`, `--memory` = `--memory-swap`, `--cpus`;
    - `--user <uid:gid>`;
    - `--label aag.job=<id>`, `--name aag-job-<id>`;
    - mount: `/job` (rw), `/refs` (ro), `/opt/assetkit` (ro).
  - Tanpa `--rm`. Setelah selesai: `docker inspect` (`OOMKilled`), lalu `docker rm`.
  - Timeout atau batal → `docker kill`.
  - `memory.peak` cgroup dicetak oleh wrapper `assetkit` di akhir job.
- [x] Protokol progres: `assetkit` mencetak baris `@@aag {"type":"progress","step":"…","pct":N}`; runner mem-parsing-nya.
- [x] Pembersihan container yatim saat start: `docker ps -a --filter label=aag.job` → `docker rm -f`.
- [x] `assetkit` v0 (paket Python `runtime/assetkit/`):
  - `scene.reset()`; konvensi meter, +Y up saat ekspor, origin di dasar-tengah;
  - `prim.box/cylinder/sphere/cone/torus`, `bevel`, `boolean`, `mirror`, `array`;
  - `finalize()`: apply transform, merge by distance, normal, origin;
  - `stats()`, `export_glb(path, materials=False)`.

  Pakai data API / `bpy.context.temp_override`, bukan operator yang butuh UI. Jumlah thread Cycles diambil dari env.
- [x] pytest per helper di `runtime/tests/` (`bun run test:assetkit` menjalankan pytest di dalam image).
- [x] Skrip contoh `runtime/samples/` (peti, kursi, laras), disimpan juga sebagai fixture GLB untuk Tahap 2.
- [x] Tes integrasi `tests/integration/runtime/` (hanya bila `RUNTIME_IT=1`):
  - skrip contoh berhasil;
  - percobaan lolos sandbox gagal semua: akses jaringan, tulis di luar `/job`, fork bomb (pids), alokasi memori besar
    (terdeteksi OOM), loop tak berujung (timeout + kill);
  - symlink ke `/etc/passwd` di output tidak diikuti.
- [x] Tes snapshot argumen `docker run`. Tidak butuh Docker.
- [x] Ukur waktu cold start, waktu ekspor base, waktu bake 1K/2K, dan `memory.peak`; catat di laporan.

**Definition of Done**
- [x] `bun run runtime:build && bun run test:assetkit && RUNTIME_IT=1 bun test tests/integration/runtime` lolos
- [x] `docker ps -a --filter label=aag.job` kosong setelah tes
- [x] Angka waktu dan RAM tercatat di laporan
- [x] Bila glTF exporter atau bake gagal di mode modul → pindah ke tarball resmi Blender 5.2.4 (dicatat di Log keputusan)
  — tidak perlu: ekspor dan bake berhasil dalam mode modul
- [x] Laporan `docs/progress/tahap-01.md`

**Risiko → mitigasi**
- bpy butuh konteks UI → helper memakai data API.
- Cycles mengabaikan kuota CPU → set thread manual.
- Tulis ke HOME saat read-only → `HOME=/tmp` + tmpfs.

### Tahap 2 — Pipeline inspeksi (tanpa Claude)
**Tujuan.** GLB masuk, lalu keluar teroptimasi, tervalidasi, terukur, ter-render, dan tersimpan sebagai versi yang tidak
bisa diubah.

**Lingkup.**
- Masuk: jalur job berat, optimasi per tier, validasi, statistik, budget, renderer, versi, cek bentuk.
- Tidak termasuk: ekspor Unity/Sumber dan turntable (Tahap 10).

**Tugas**
- [x] `server/jobs/heavy-lane.ts`: semaphore 1 (port `semaphore.ts` ai-team), antrean, batal via `AbortSignal`, event progres.
- [x] `server/pipeline/optimize.ts` (gltf-transform):
  1. dedup;
  2. palet (khusus Ringan);
  3. flatten, join, weld;
  4. simplify (khusus tahap 1, bila sedikit lewat batas);
  5. prune;
  6. tekstur (resize per tier, WebP);
  7. kompresi meshopt di akhir, khusus preset Web.
- [x] `server/pipeline/validate.ts`: gltf-validator pada GLB **sebelum** kompresi meshopt. Hasil bertipe (jumlah error/warning + pesan pertama).
- [x] `server/pipeline/stats.ts`: segitiga, vertex, material, tekstur (dimensi), bbox (Y-up), ukuran byte.
- [x] `shared/limits.ts`: budget tier, batas build, toleransi bentuk, timeout, memori. `checkBudget(stats, tier)` → selisih per item.
- [x] `server/domain/shape.ts` (fungsi murni): cek konsistensi bentuk tahap 2 terhadap base yang disetujui
  (dimensi bbox dan jumlah segitiga dalam toleransi).
- [x] `server/render/`, port dari `design/tools/render/`:
  - Pakai `three` dan `playwright` milik proyek. Tool lama mengambilnya dari `/var/www/THREE.Terrain` dan ai-team.
  - Muat GLB (GLTFLoader + MeshoptDecoder).
  - Mode clay, wireframe, tekstur; sudut depan, belakang, kiri, kanan, atas, 3/4.
  - Contact sheet ≤1024 px dengan sharp.
  - Satu browser hidup lama; halaman dipakai ulang; restart bila crash.
  - Grid memakai tekstur canvas (GridHelper bermasalah di SwiftShader).
- [x] `server/services/versions.ts`:
  - folder staging → rename atomik ke `versions/vN`;
  - file dibuat read-only, disertai `manifest.json` (sha256 per file);
  - file turunan di `derived/`.
- [x] `bun run pipeline:demo <skrip.py> --tier sedang`: jalankan contoh Tahap 1 → optimasi → validasi → render → versi v1.

**Tes wajib**
- Optimasi per tier pada fixture: 0 error validator, round-trip meshopt (decode ulang), statistik benar, selisih budget benar.
- Tabel tes untuk `shape.ts`.
- Renderer:
  - string renderer = SwiftShader;
  - objek menutupi 2–80% gambar, berada di tengah ±10%, dan tiap sudut berbeda;
  - golden pixelmatch: threshold 0.1, ≤1% piksel berbeda. Golden hanya diperbarui dengan `UPDATE_GOLDENS=1`.

**Definition of Done**
- [x] `bun run test:pipeline` lolos
- [x] `bun run pipeline:demo` membuat v1 yang read-only, lengkap dengan manifest
- [x] Render 6 sudut ≤8 dtk (p95 dari 10 run)
- [x] Laporan `docs/progress/tahap-02.md` beserta contoh contact sheet

**Risiko → mitigasi**
- SwiftShader lambat atau boros RAM → resolusi render diturunkan, satu browser.
- Validator tidak bisa membaca meshopt → validasi sebelum kompresi.
- Chromium crash → restart otomatis + tes.

### Tahap 3 — Spike loop Claude: bentuk dasar (memakai kuota, dengan izin)
**Tujuan.** Membuktikan bahwa Claude + `assetkit` + contact sheet menghasilkan bentuk dasar yang layak dalam batas build.

**Lingkup.**
- Masuk: integrasi Agent SDK, tool `forge` tahap 1, guard, prompt, knowledge, skrip evaluasi.
- Tidak termasuk: SQLite (repositori di memori dulu) dan UI.

**Tugas**
- [x] `server/agent/port.ts` berisi interface `AgentPort`: start, send, interrupt, close, `accountInfo`,
  `supportedModels`, aliran event.
- [x] `server/agent/sdk-adapter.ts`: satu-satunya file yang meng-import `query`.
- [x] `server/agent/options.ts`, satu factory opsi:
  - Model dan thinking: `model`, `effort: "high"`, `thinking: {type: "adaptive", display: "summarized"}`.
  - Konfigurasi sesi: `settingSources: []`, `strictMcpConfig: true`, `systemPrompt` (preset `claude_code` + `append`).
  - Tool: allowlist `tools` (Read, Write, Edit, Glob, Grep, TodoWrite, AskUserQuestion).
  - Izin: `settings.permissions` (allow/deny), `canUseTool` yang menolak secara bawaan + jembatan AskUserQuestion,
    hook PreToolUse (realpath).
  - MCP: `forge` dengan `alwaysLoad: true` + `timeout`.
  - Sesi: `includePartialMessages`, `resume`, `cwd` = `work/`, `additionalDirectories` = `refs/` dan `runtime/knowledge/`.
  - Env: `agentEnv()` + `CLAUDE_AGENT_SDK_CLIENT_APP`.
- [x] `server/agent/runner.ts` versi minimal, port dari `TaskRunner` ai-team:
  - generator input dengan uuid;
  - kepemilikan hasil lewat `user_message_uuids`;
  - interrupt + `cancelQueued`;
  - abaikan pesan yang masih ter-buffer setelah `close`.
- [x] `server/agent/events.ts`: port `toUiEvents`, ditambah ringkasan berpikir dan progres build.
- [x] Tool `forge` tahap 1 (`server/agent/forge/`) di atas repositori memori:
  - `record_brief`;
  - `build_base_mesh`: salin `work/base.py` ke folder job → runtime → pipeline → contact sheet.
    Hasilnya JSON ringkas + 1 gambar;
  - `inspect_version`, `list_versions`, `submit_for_review`.

  Batas 8 build per pesan. Kode error stabil.
- [x] Guard 3 lapis beserta tes penolakan:
  - `Read /etc/passwd`;
  - traversal `../`;
  - symlink di `work/` yang menunjuk ke luar;
  - Write di luar `work/`;
  - Bash tidak tersedia.
- [x] `runtime/knowledge/`:
  - `API.md` (referensi `assetkit`);
  - `cookbook/*.md`: resep peti, kursi, laras, pohon stylized, makhluk sederhana;
  - konvensi: meter, +Y up, origin di dasar-tengah, penamaan.
- [x] `server/agent/prompts/system.md`:
  - persona technical 3D artist; aturan dua tahap; budget tier; konvensi;
  - loop kerja: build → lihat contact sheet → bandingkan dengan brief dan referensi → perbaiki;
  - bertanya lewat AskUserQuestion bila ambigu;
  - membalas dalam bahasa Indonesia.
- [x] `scripts/eval-base.ts` (`bun run eval:base`):
  - 5 prompt di tier Sedang: peti, pistol sci-fi, kursi, pohon stylized, rubah kartun;
  - pertanyaan Claude dijawab otomatis dari tabel jawaban;
  - keluaran: `eval/runs/<ts>/<prompt>/` (transcript, contact sheet, statistik, `summary.md`).
- [x] Rekam stream SDK nyata yang sudah disanitasi ke `tests/fixtures/sdk/*.jsonl` sebagai tes kontrak.

**Tes wajib**
- Handler tool lewat MCP `InMemoryTransport`.
- Skenario dasar `FakeQuery`, port dari `/var/www/ai-team/scripts/check-runner.ts`.
- Snapshot factory opsi: tanpa API key di env, daftar tool tepat, `settingSources` kosong.
- Semua tes penolakan guard.

**Definition of Done**
- [x] ≥4 dari 5 prompt sampai `submit_for_review` dengan 0 error validator, segitiga ≤ maks, ≤6 build, dan ≤10 menit per prompt
- [ ] Pemilik menilai ≥4 dari 5 layak (skor ≥3/5)
- [x] Terbukti:
  - ringkasan berpikir tidak kosong;
  - Claude merujuk contact sheet saat memperbaiki;
  - Stop (interrupt + `docker kill`) bekerja di tengah build;
  - resume sesi bekerja setelah proses dimatikan.
- [x] `bun run check` lolos
- [x] Laporan `docs/progress/tahap-03.md`: tabel hasil, contact sheet tiap prompt, perkiraan pemakaian kuota

**Gerbang lanjut/tidak.** Bila hasil kurang, pilihannya:
- menaikkan abstraksi `assetkit` (lathe, sweep, radial array, extrude profil);
- memperbaiki cookbook;
- pindah ke Blender 4.5 LTS;
- (cadangan guard) semua akses file lewat tool MCP.

Keputusan dibuat bersama pemilik dan dicatat di Log.

### Tahap 4 — Spike tahap tekstur
**Tujuan.** Aset final bertekstur yang memenuhi budget di ketiga tier, dengan waktu dan RAM dalam batas.

**Lingkup.**
- Masuk: pustaka material, UV, material, bake, optimasi tekstur, gerbang tahap 2, evaluasi.
- Tidak termasuk: UI.

**Tugas**
- [x] `scripts/textures-sync.ts` (`bun run textures:sync`):
  - unduh ±60 material terkurasi dari ambientCG API v3 (resolusi 1K dan 2K, JPG);
  - daftarnya di `runtime/materials.txt`;
  - cek checksum; User-Agent generik;
  - simpan ke `data/library/materials/<id>/…` + `catalog.json` (id, nama, tag, kategori, map, lisensi CC0, URL sumber).
- [x] Helper tekstur di `assetkit`:
  - `uv.unwrap(obj, method="xatlas", padding)`;
  - `material.pbr(...)` dan `material.from_library(id, mapping)`;
  - `bake.pbr(high, low, size, maps=["normal", "ao"])`, gabung ke atlas (AO di-bake dari aset final; lihat Log);
  - `decal.from_image(ref)`;
  - batas ukuran tekstur per tier;
  - `export_glb(materials=True)`.
- [x] Tool `forge`:
  - `list_materials(query, tags)` (filter `category`, lihat Log);
  - `build_textured_asset`: hanya bila base sudah disetujui, cek bentuk terhadap base yang disetujui, batas 4 build per
    pesan, limit job 2,5 GB / 300 dtk (600 dtk untuk Maksimal).
- [x] Optimasi keluaran bertekstur per tier (resize tekstur; WebP untuk Web).
- [x] `bun run eval:texture`: 3 prompt, dimulai dari base yang disetujui hasil Tahap 3 (3/3 lolos syarat otomatis).
- [x] Putuskan: satu sesi lintas tahap, atau sesi baru dengan ringkasan untuk tahap tekstur. Ukur konteks dan jumlah
  gambar, lalu catat di Log.

**Perbaikan kualitas** (permintaan pemilik setelah review pertama; skor pistol 3, peti 3, rubah 2)
- [x] Detail sesuai tier: arahan per tier di system prompt dan knowledge, petunjuk "ruang detail" di hasil
  `build_base_mesh`, cek mandiri arah bagian (telapak, wajah).
- [x] Cookbook lebih kaya: contoh makhluk dengan mata, hidung, telapak menghadap depan; contoh peti dengan detail kecil;
  jebakan mirror sumbu Y di `API.md`.
- [x] Material lebih hidup: helper `assetkit` untuk variasi warna, keausan tepi, kotoran di celah, dan cat prosedural
  (bentuk sederhana tanpa gambar referensi); semuanya ikut ter-bake ke atlas. Arahan: Sedang/Maksimal tidak hanya
  warna rata.
- [x] Eval ulang bentuk dasar + tekstur, sesi baru (dengan izin kuota): **rubah** lolos, skor pemilik 3. Peti dan
  pistol tidak diulang: pemilik memutuskan lanjut ke Tahap 5 (Log 2026-11-14).

**Tes wajib**
- pytest per helper, termasuk sanity bake (normal di area datar ≈ (0.5, 0.5, 1)).
- Per tier: dimensi tekstur, jumlah material, ukuran `web.glb`.
- Gerbang:
  - tekstur sebelum base disetujui → `BASE_NOT_APPROVED`;
  - bentuk menyimpang → `SHAPE_DRIFT`.

**Definition of Done**
- [x] Ketiga tier sesuai budget
- [x] Bake Maksimal ≤600 dtk, `memory.peak` <2,5 GB
- [x] ≥2 dari 3 evaluasi lolos gerbang dalam ≤4 build, dan pemilik menilai ≥3/5 (3/3 lolos otomatis; skor pemilik: pistol 3, peti 3, rubah 2 → rubah ulang 3)
- [x] Laporan `docs/progress/tahap-04.md`

**Gerbang lanjut/tidak** bersama pemilik.

### Tahap 5 — Inti server: domain, data, runner
**Tujuan.** Inti produksi yang lengkap dan bisa dites tanpa Claude maupun Docker.

**Tugas**
- [x] Skema Drizzle + migrasi (lihat [Lampiran F](#lampiran-f--data--api)):
  - `assets` (dengan `tierSnapshot`, `status`, `runState`, `lastError`), `versions`, `events` (unik `assetId+seq`);
  - `jobs`, `questions`, `attachments`, `settings`.
- [x] Repositori di `server/db/repos/`. Transaksi sinkron, tanpa `await` di dalamnya.
- [x] `server/domain/status.ts`: `transition(state, event) → { state, effects }`, fungsi murni sesuai [Lampiran C](#lampiran-c--status-aset--transisi).
- [x] Batas build per pesan disimpan di DB; kunci REVIEW; gerbang tool `forge` memakai repositori asli.
- [x] `server/agent/runner.ts` lengkap:
  - pool maksimal 2 proses hidup (termasuk cek kesehatan), ditutup setelah idle 5 menit (LRU);
  - pilih banyak dan "Lainnya";
  - Stop = interrupt + batalkan job di jalur berat;
  - jam disuntikkan;
  - deteksi batas pemakaian (`rate_limit_event`, `USAGE_LIMIT_ERROR_PREFIXES`) → `runState: failed`,
    `code: USAGE_LIMIT`, waktu reset.
- [x] Event store (SQLite) + bus (port `bus.ts`). Event delta hanya live, tidak disimpan.
- [x] `server/services/assets.ts`: buat, kirim pesan, jawab, setujui, revisi, stop, coba lagi, duplikat, hapus
  (soft delete + bersihkan file).
- [x] Pemulihan saat start: job berjalan → dibatalkan; aset → `runState: interrupted` dengan aksi "Lanjutkan"
  (resume sesi dengan pesan bahwa proses terputus).
- [x] Driver palsu:
  - `AGENT_DRIVER=fake`: `FakeQuery` + DSL skenario;
  - `RUNTIME_DRIVER=fixture`: GLB dan contact sheet siap pakai.

**Tes wajib**
- Tabel lengkap status × event.
- Skenario `FakeQuery`:
  - jalur bahagia; loop revisi;
  - build ke-9 ditolak; tekstur sebelum disetujui ditolak; bentuk menyimpang ditolak;
  - Stop di tengah build; restart di tengah job;
  - batas pemakaian; pilih banyak.

**Definition of Done**
- [x] `bun run check` lolos
- [x] Cakupan baris ≥90% di `server/domain` dan `server/agent` (ambang di `bunfig.toml`)
- [x] Laporan `docs/progress/tahap-05.md`

### Tahap 6 — API & realtime
**Tujuan.** Semua perilaku server bisa diakses lewat HTTP dan WebSocket dengan kontrak bertipe.

**Tugas**
- [x] Rute Hono sesuai [Lampiran F](#lampiran-f--data--api), validasi zod, error `{ code, message }`, tipe `AppType` untuk `hc`.
- [x] Unggah lampiran:
  - multipart dengan batas (±20 MB per file, maks. 8 file);
  - tipe dicek dari isi, bukan ekstensi;
  - gambar di-re-encode dengan sharp (metadata dibuang): ≤1568 px untuk Claude, ≤2048 px untuk decal;
  - model 3D (glb/gltf/obj/fbx/stl) maks. 50 MB, hanya di-mount read-only ke container.
- [x] File versi:
  - nama di-allowlist dan `content-type` benar;
  - cache panjang, karena versi tidak berubah.
- [x] `server/realtime/hub.ts`: protokol ai-team (sub/unsub, replay `after`, resync bila >1000 event, heartbeat,
  backpressure) di atas `upgradeWebSocket` dari `@hono/bun`. Handler `websocket` adapter itu tidak meneruskan `drain`,
  jadi hub menambahkan handler `drain` sendiri dan membaca nilai balik `send()` (temuan Tahap 0).
  - Pagar dijalankan sebelum upgrade; `maxPayloadLength` 64 KB.
  - Topik `global` dan `asset:<id>`.
  - Echo dari Tahap 0 dihapus.
- [x] `bun run e2e:api`: alur penuh lewat HTTP + WebSocket dalam mode palsu:
  1. buat aset;
  2. pertanyaan → jawab;
  3. review bentuk dasar → revisi → setujui;
  4. tekstur → DONE;
  5. unduh `web.glb`.

**Tes wajib**
- Protokol WebSocket: replay, resync, heartbeat, delta dibuang saat buffer penuh tetapi event penting tidak.
- Pagar: 403 pada Host/Origin asing; upgrade WebSocket ditolak.
- Unggahan: tipe palsu, file terlalu besar, nama file berbahaya.

**Definition of Done**
- [x] `bun run e2e:api` lolos 3× berturut-turut
- [x] `bun run check` lolos
- [x] Laporan `docs/progress/tahap-06.md`

### Tahap 7 — Shell web & komponen
**Tujuan.** Kerangka app dan komponen dasar yang sama dengan desain FigCraft, di kedua tema.

**Tugas**
- [x] Layout: rel nav 64 px sesuai FigCraft (Studio, Gudang, Pengaturan, chip akun; lihat Log 2026-11-13), routing, lebar desktop (nyaman ≥1280 px, tetap layak di 1024 px).
- [x] `web/i18n/id.ts` untuk semua teks; `shared/format.ts` untuk angka, ukuran file, dan tanggal relatif `id-ID`.
- [x] Komponen dari halaman Components di FigCraft, di atas shadcn/Radix:

  | Kelompok | Komponen |
  |---|---|
  | Aksi | Button (primary/secondary/ghost/danger + loading/disabled), IconButton |
  | Input | Input, Textarea, Segmented tier + info budget, Pemilih versi |
  | Penanda | Badge tier/status, Chip lampiran, Chip akun |
  | Overlay | Dialog, Menu, Tooltip (dengan pintasan), Toast (sonner) |
  | Tampilan | Langkah progres, Baris statistik + meter budget, Kartu aset (Default/Hover), Empty state |

- [x] Toggle tema; hormati `prefers-reduced-motion`.

**Tes wajib**
- Tes komponen lewat role/nama dan keyboard.
- axe untuk setiap komponen di kedua tema.
- Screenshot shell di kedua tema disimpan di `docs/progress/tahap-07/` untuk dibandingkan dengan `design/exports/`.

**Definition of Done**
- [x] Tes lolos
- [x] axe 0 masalah serius di kedua tema
- [x] Screenshot tersimpan
- [x] Laporan `docs/progress/tahap-07.md`

### Tahap 8 — Viewer 3D
**Tujuan.** Viewer R3F yang bisa melihat aset dari segala arah, dengan perilaku sama seperti prototipe
`design/prototype/viewer-360.html` dan tampilan sesuai desain.

**Tugas**
- [x] `web/features/viewer/`:
  - **Kamera:**
    - `Canvas frameloop="demand"`, DPR [1, 2];
    - drei `CameraControls`: sudut vertikal penuh 0..π, transisi halus.
  - **Sudut cepat:** 3/4 (bawaan), Depan, Belakang, Kiri, Kanan, Atas, Bawah, lewat menu Sudut **dan** gizmo sumbu.
    Gizmo wajib bisa dipakai dengan keyboard; bila drei `GizmoHelper` tidak bisa, port gizmo SVG dari prototipe.
  - **Pintasan:**
    - putar otomatis `R`: ±20 dtk per putaran, berhenti saat diseret, mati bila animasi dikurangi;
    - fokus `F` / klik ganda;
    - wireframe `W`, grid `G`.
  - **Mode:** Tekstur, Clay, Wireframe, UV (tekstur checker), Normal.
  - **Lantai:** lantai dan grid hilang saat kamera di bawah, ditambah lampu bawah (rumus dari prototipe).
  - **Info dan state:** overlay statistik vs budget; state memuat/error; fallback bila konteks WebGL hilang.
  - **Aset:** HDRI lokal; `useGLTF(url, false, true)` (tanpa Draco, meshopt aktif). Lingkungan memakai
    `RoomEnvironment` three, sama dengan renderer contact sheet (lihat Log keputusan).
  - **Siklus hidup:** dispose saat unmount; chunk di-lazy-load.
- [x] Test hook `window.__viewer`, hanya di mode tes: siap, jumlah frame, azimuth/polar/jarak, mode, visibilitas lantai.

**Tes wajib**
- Unit: matematika preset dan fungsi visibilitas lantai.
- E2E:
  - sudut preset tepat ±1e-3; `F` menyesuaikan ±2%;
  - `R` mulai dan berhenti; `W` dan mode mengubah piksel;
  - Bawah menyembunyikan lantai;
  - 0 frame dirender selama 10 dtk diam;
  - golden 7 preset × 2 tema.

**Definition of Done**
- [x] Semua tes lolos
- [x] FPS dicek di mesin ini (±60 fps) dan dicatat. Diukur lewat skrip di GPU, bukan manual (lihat Log keputusan)
- [x] Laporan `docs/progress/tahap-08.md` dengan screenshot

### Tahap 9 — Studio lengkap (M1: app bisa dipakai)
**Tujuan.** Alur Studio penuh dari prompt sampai aset final, di atas server asli.

**Tugas**
- [x] **Studio · baru:**
  - Composer: teks, lampiran (drag & drop, pilih file, tempel Ctrl+V), chip, tier + info budget;
    Enter untuk kirim, Shift+Enter untuk baris baru.
  - Contoh prompt dan panduan jenis aset yang cocok.
- [x] **Thread:**
  - port logika `useTaskThread` ai-team: subscribe → snapshot → merge per `seq`; delta di-flush tiap 100 ms; muat yang lebih lama;
  - pesan dirender dengan streamdown;
  - blok ringkasan berpikir yang bisa dilipat;
  - kartu brief; progres langkah dari protokol progres.
- [x] **Kartu pertanyaan:** pilih satu, pilih banyak, dan "Lainnya" (memperbaiki batasan ai-team).
- [x] **Progres:** langkah, waktu berjalan, tombol Stop.
- [x] **Review bentuk dasar:**
  - viewer (Clay/Wireframe), statistik vs budget;
  - "Setujui & lanjut tekstur" / "Minta revisi" (composer revisi + opsi "sertakan tampilan viewport saat ini" sebagai lampiran PNG).
- [x] **Aset final:**
  - progres tahap 2;
  - review final: mode tampilan, laporan optimasi sebelum → sesudah, riwayat versi;
  - "Ubah bentuk", "Selesai".
- [x] **Viewer antar-versi** (→ dari tinjauan Tahap 8): ganti versi tanpa memasang ulang kanvas WebGL; sudut kamera
  dipertahankan supaya v1 dan v2 bisa dibandingkan dari sudut yang sama.
- [x] **Navigasi dan koneksi:**
  - indikator tahap "1 Bentuk dasar → 2 Aset final" selalu terlihat;
  - proses tetap berjalan saat pindah halaman, dengan toast saat selesai;
  - banner sambung ulang saat WebSocket terputus.

**Tes wajib**
- Tes komponen untuk semua kartu.
- E2E `AGENT_DRIVER=fake RUNTIME_DRIVER=fixture`, lolos 3×:
  - alur penuh sampai DONE;
  - muat ulang di tengah stream;
  - sambung ulang.
- axe bersih.

**Definition of Done**
- [x] Semua tes lolos
- [ ] 1 uji nyata dengan izin pemilik: prompt "peti kayu dengan engsel besi" + gambar referensi sampai DONE
  (**menunggu izin pemilik**: memakai kuota, di luar delegasi)
- [x] Laporan `docs/progress/tahap-09.md` dengan screenshot alur

### Tahap 10 — Gudang, detail aset, ekspor
**Tugas**
- [x] **Gudang:**
  - grid dengan cari (nama/prompt), filter (tier, tahap, tanggal), urutkan, state kosong;
  - pilih banyak + unduh ZIP streaming (fflate, nama file disanitasi).
- [x] **Turntable:**
  - 24 frame per versi dirender → strip WebP, lebar total ≤16383 px;
  - animasi hover lewat CSS `background-position` (tanpa WebGL per kartu), dimuat saat hover;
  - thumbnail versi dari render yang sama, dipakai baris versi di panel Detail Studio (layar 02), kartu "Terakhir
    dibuat", dan kartu Gudang (← dari Tahap 9).
- [x] **Detail aset:**
  - viewer, prompt dan lampiran asli, metadata, versi;
  - Ekspor, "Lanjutkan di Studio", Duplikat / Ganti nama / Hapus (dengan dialog konfirmasi);
  - menu "…" di topbar sesi Studio (layar 02) dengan aksi aset yang sama (← dari Tahap 9).
- [x] **Dialog ekspor:** preset Web / Unity / Sumber, pilih versi, estimasi ukuran. Hasil di-cache di `derived/`.
- [x] **Preset ekspor:**
  - Web: meshopt + WebP;
  - Unity: tanpa ekstensi kompresi, PNG/JPEG, 0 error validator;
  - Sumber: ZIP berisi `.blend`, skrip, dan tekstur PNG. Skripnya bila dijalankan ulang di container menghasilkan
    jumlah segitiga yang sama.

**Tes wajib**
- E2E: cari, filter, urut, ZIP, ganti nama, duplikat, hapus.
- Validator untuk setiap preset.
- Zip-slip dan sanitasi nama.
- axe.

**Definition of Done**
- [x] Semua tes lolos
- [x] Panduan uji import Unity (glTFast) ada di laporan, untuk diuji pemilik (uji di Unity menunggu pemilik)
- [x] Laporan `docs/progress/tahap-10.md`

### Tahap 11 — Pengaturan & state khusus
**Tugas**
- [ ] **Pengaturan:**
  - akun (email, langganan dari `accountInfo()`);
  - model dari `supportedModels()`, effort, tier bawaan;
  - budget tier (berlaku untuk aset baru, divalidasi);
  - status runtime (Docker terjangkau, image ada, versi Blender, renderer OK);
  - tema.
- [ ] **Endpoint kesehatan:**
  - `/api/health/auth`: port ai-team, cache 10 menit;
  - `/api/health/runtime`.
- [ ] **State khusus:**

  | State | Isi |
  |---|---|
  | Belum login Claude | Petunjuk login |
  | Batas pemakaian | Waktu reset |
  | Runtime belum siap | Docker mati atau image belum ada, dengan aksi "Bangun image" |
  | Build gagal | Detail + coba lagi |
  | Terputus | Lanjutkan |

- [ ] Notifikasi: toast dan Notification browser (dengan izin) saat proses di latar belakang selesai.
- [ ] Ekspor Sumber memakai `tierSnapshot` aset begitu budget bisa diubah: README dan `scripts/runtime.ts probe`
  menjalankan ulang skrip dengan budget aset itu, bukan `DEFAULT_TIERS` (← dari Tahap 10).

**Tes wajib**
- E2E per state, disimulasikan dengan driver palsu.
- axe.

**Definition of Done**
- [ ] Semua tes lolos
- [ ] Laporan `docs/progress/tahap-11.md`

### Tahap 12 — Pengerasan & rilis lokal (M2)
**Tugas**
- [ ] Error boundary per rute dan toast error global.
- [ ] Performa:
  - bundle (viewer di-lazy-load);
  - memori server selama satu alur penuh;
  - kebijakan restart Chromium renderer.
- [ ] Backup dan retensi:
  - `VACUUM INTO data/backups/app-YYYYMMDD.db` harian, simpan 7;
  - bersihkan `data/jobs/` dan cache `derived/` yang usang.
- [ ] `bun run doctor`: versi Bun, Docker, image, ruang disk, login Claude, port, izin `data/`.
- [ ] systemd user unit `deploy/ai-asset-generate.service`, berdasarkan unit ai-team:
  - `PATH` memuat `~/.bun/bin` dan `~/.local/bin`;
  - `WorkingDirectory` di root proyek;
  - `TimeoutStopSec`.

  Disertai cara memasang.
- [ ] `README.md` berbahasa Indonesia: instalasi, menjalankan, update, backup/restore, pemecahan masalah.
- [ ] Pastikan `/_smoke` hanya ada di mode tes.

**Definition of Done**
- [ ] Semua suite + `RUNTIME_IT=1` lolos
- [ ] 1 uji nyata sampai DONE (dengan izin)
- [ ] Checklist rilis selesai
- [ ] Laporan `docs/progress/tahap-12.md`

---

## 6. Strategi tes

| Lapisan | Alat | Lokasi | Kapan |
|---|---|---|---|
| Unit & integrasi server/shared | `bun test` | `*.test.ts` di samping kode, `tests/integration/` | Setiap perubahan |
| Komponen web | `bun test` + happy-dom + Testing Library | `web/**/*.test.tsx` | Setiap perubahan |
| `assetkit` | pytest di dalam image | `runtime/tests/` | Saat `runtime/` berubah |
| Runtime nyata | `RUNTIME_IT=1 bun test` | `tests/integration/runtime/` | DoD tahap yang terkait |
| E2E + aksesibilitas | `@playwright/test` (Node) + axe | `tests/e2e/` | Setiap perubahan UI; DoD |
| Evaluasi kualitas Claude | `eval:base`, `eval:texture` | `eval/` | Hanya dengan izin pemilik |

**Agent SDK tanpa kuota**
- **Seam:** semua akses lewat `AgentPort`. Hanya `sdk-adapter.ts` yang menyentuh SDK.
- **FakeQuery** (dari ai-team `scripts/check-runner.ts`) dijalankan dengan DSL skenario. Ia meniru:
  - echo `user_message_uuids`;
  - pesan yang masih ter-buffer setelah `close`;
  - bukti interrupt.
- **Tool asli** dipanggil lewat `createSdkMcpServer(...)` + `InMemoryTransport`, jadi skema, gerbang, dan bentuk hasil
  yang dites adalah yang asli.
- **Pesan palsu** diketik dengan `satisfies SDKMessage`, supaya perubahan bentuk pesan saat upgrade SDK membuat compile gagal.
- **Stream nyata** yang direkam di Tahap 3 diputar ulang lewat `toUiEvents` sebagai tes kontrak.

**Runtime 3D**
- pytest per helper.
- Snapshot argumen `docker run`.
- `RUNTIME_IT=1`: percobaan lolos sandbox dan skrip golden dengan rentang statistik.

**Renderer dan viewer**
- Assert SwiftShader; cek cakupan dan posisi objek; golden pixelmatch, hanya diperbarui dengan `UPDATE_GOLDENS=1`.
- Viewer membuka `window.__viewer` di mode tes. Tes menunggu sinyal, tidak memakai sleep.

**Matriks driver**
- `AGENT_DRIVER=fake` × `RUNTIME_DRIVER=fixture`: setiap perubahan.
- `fake` × `docker`: DoD tahap.
- `sdk` × `docker`: uji nyata, hanya dengan izin.

**Aturan umum**
- Tes deterministik: tanpa jaringan, tanpa sleep, jam disuntikkan.
- E2E memilih elemen lewat role dan nama.
- Tidak ada `.only` atau `.skip` yang di-commit.

---

## Lampiran A — Struktur folder & port
```
AGENTS.md, CLAUDE.md, README.md (Tahap 12)
docs/            PLAN.md, TECH_STACK.md, progress/
design/          ai-asset-generate.figcraft, exports/, assets/, tokens/, tools/render/ (acuan), prototype/ (acuan perilaku viewer)
server/
  main.ts        Bun.serve (127.0.0.1:4340)
  app.ts         app Hono + type AppType
  config.ts      env (zod), agentEnv()
  http/          guard, errors, routes/
  realtime/      hub WebSocket
  db/            client, schema, migrations/, repos/
  domain/        status (transition), shape, budget — murni, tanpa I/O
  services/      assets, versions, attachments, exports, settings
  agent/         port, sdk-adapter, options, runner, events, forge/, prompts/
  runtime/       docker.ts
  pipeline/      optimize, validate, stats, presets
  render/        renderer Playwright + scene three
  jobs/          heavy-lane, pool
shared/          skema zod, limits.ts, format.ts, tipe event
web/
  app/           router, layout
  components/ui/ komponen shadcn yang sudah memakai token
  features/      studio/, gudang/, viewer/, settings/
  i18n/id.ts     semua teks UI
  lib/           client hc, realtime, query keys
  styles/        tokens.css (hasil tokens:sync), globals.css
runtime/         Dockerfile, assetkit/, knowledge/ (API.md, cookbook/), tests/, samples/, probes/, materials.txt
scripts/         dev.ts, check-auth.ts, sync-tokens.ts, textures-sync.ts, eval-*.ts, doctor.ts
tests/           integration/, e2e/, fixtures/ (glb, sdk/), smoke/
eval/            runs/ (di-gitignore)
deploy/          ai-asset-generate.service (Tahap 12)
data/            (di-gitignore) app.db, assets/, jobs/, library/, backups/
```
- Port: API **4340**, Vite **4341**, E2E **4342**. Selalu bind `127.0.0.1`. Port lain di mesin ini: ai-team 4320/4321,
  learning-system dan automated-test-app 4330/4331.
- Env: `DATA_DIR` (bawaan `./data`), `PORT`, `LOG_LEVEL`, `AGENT_DRIVER` (`sdk` | `fake`),
  `RUNTIME_DRIVER` (`docker` | `fixture`), `RUNTIME_IT`, `UPDATE_GOLDENS`.

## Lampiran B — Sesi Claude & tool `forge`
- **Satu aset = satu sesi Claude.** Sesi berlanjut lintas revisi lewat `resume`; `cwd` tetap di `data/assets/<id>/work/`.
  Tahap 4 memutuskan apakah tahap tekstur memakai sesi baru dengan ringkasan.
- **Opsi:**
  - `model: claude-opus-5-5` (bisa diubah di Pengaturan);
  - `effort: "high"` (eksplisit, karena bawaan Opus 5.5 adalah `medium`);
  - `thinking: { type: "adaptive", display: "summarized" }`;
  - `settingSources: []`, `strictMcpConfig: true`;
  - `systemPrompt`: preset `claude_code` + `append` (persona dan aturan);
  - `includePartialMessages: true`.
- **Tool bawaan:** Read, Write, Edit, Glob, Grep, TodoWrite, AskUserQuestion.
  - Read/Glob/Grep hanya di folder aset dan `runtime/knowledge/`. Write/Edit hanya di `work/`.
  - Selalu ditolak: Bash, WebFetch/WebSearch, Task/Agent, NotebookEdit, `mcp__claude_ai_*`.
  - Dijaga 3 lapis: allowlist `tools`, aturan izin + `canUseTool` yang menolak secara bawaan, hook PreToolUse dengan realpath.
- **Tool `forge`** (MCP in-process, `alwaysLoad: true`, `timeout` per tool):

| Tool | Fungsi | Gerbang |
|---|---|---|
| `record_brief` | Ringkasan, kategori, gaya, dimensi (m) → tampil di UI; BRIEFING → BASE_WORKING | — |
| `build_base_mesh` | Jalankan `work/base.py` → ekspor **tanpa material** → optimasi/validasi → contact sheet | Status BASE_WORKING; maks. 8 per pesan |
| `build_textured_asset` | Jalankan `work/material.py` → UV, material, bake, ekspor, optimasi tier → contact sheet | Base sudah disetujui; cek bentuk; maks. 4 per pesan |
| `list_materials` | Cari katalog material CC0 lokal | — |
| `inspect_version` | Render ulang sudut/mode tertentu tanpa build ulang | — |
| `list_versions` | Daftar versi beserta statistik | — |
| `submit_for_review` | Kunci build, status → REVIEW, turn selesai | Ada versi yang lolos budget dan validator |

- **Hasil tool:**
  - JSON ringkas: statistik, selisih terhadap budget, sisa jatah build, `code` error stabil
    (`BRIEF_REQUIRED`, `BASE_NOT_APPROVED`, `BUILD_CAP_REACHED`, `BUDGET_EXCEEDED`, `VALIDATION_FAILED`, `SCRIPT_ERROR`,
    `TIMEOUT`, `OOM`, `SHAPE_DRIFT`);
  - **maksimal 1 gambar** contact sheet ≤1024 px.
- **Ekspor dilakukan harness**, bukan skrip Claude:
  - tahap 1 dipaksa tanpa material dan tekstur;
  - versi menyimpan salinan skrip sebagai sumber kebenaran.

## Lampiran C — Status aset & transisi
- **Status tahap:** `BRIEFING → BASE_WORKING → BASE_REVIEW → TEXTURE_WORKING → TEXTURE_REVIEW → DONE`.
- **`runState`** (terpisah dari status): `idle` · `running` · `waiting_user` (pertanyaan terbuka) · `failed`
  (dengan `lastError: { code, message, at }`) · `interrupted` (server restart).

| Dari | Pemicu | Ke |
|---|---|---|
| BRIEFING | `record_brief` | BASE_WORKING |
| BASE_WORKING | `submit_for_review` (versi base lolos) | BASE_REVIEW |
| BASE_REVIEW | tombol **Setujui & lanjut tekstur** | TEXTURE_WORKING (`approvedBaseVersion` diisi) |
| BASE_REVIEW | tombol **Minta revisi** / pesan baru | BASE_WORKING |
| TEXTURE_WORKING | `submit_for_review` (versi final lolos) | TEXTURE_REVIEW |
| TEXTURE_REVIEW | tombol **Selesai** | DONE |
| TEXTURE_REVIEW | **Minta revisi** / pesan baru | TEXTURE_WORKING |
| TEXTURE_REVIEW / DONE | **Ubah bentuk** | BASE_WORKING (base baru wajib disetujui ulang) |
| DONE | **Lanjutkan di Studio** + pesan | TEXTURE_WORKING |

**Aturan**
- Hanya endpoint tombol pengguna yang bisa keluar dari `*_REVIEW`.
- Stop tidak mengubah status: `runState` menjadi `idle`, dan job dibatalkan.
- Gagal → `runState: failed` + `lastError`. "Coba lagi" mengirim ulang pesan terakhir.

## Lampiran D — Tier & budget
Nilai bawaan ada di `shared/limits.ts` (bisa diubah di Pengaturan). Snapshot tier disimpan per aset saat dibuat.

| | Ringan | Sedang | Maksimal |
|---|---|---|---|
| Segitiga target / maks | 2k / 3k | 8k / 12k | 30k / 50k |
| Material (draw call) | 1 | ≤ 2 | ≤ 3 |
| Tekstur | baseColor 512 atau palet | baseColor 1K, normal 1K, ORM 512 | baseColor 2K, normal 2K, ORM 1K (+emissive ≤1K) |
| Ukuran `web.glb` target / maks | 150 / 300 KB | 0,8 / 1,5 MB | 3 / 5 MB |

- Maksimal tetap ringan: detail dari high-poly di-bake menjadi normal map + AO, bukan menambah segitiga.
- Statistik selalu dibandingkan dengan budget, baik di UI maupun di hasil tool.

## Lampiran E — Pipeline & preset ekspor
- **Pipeline:**
  1. dedup;
  2. palet (Ringan);
  3. flatten, join, weld;
  4. simplify (tahap 1, bila sedikit lewat);
  5. prune;
  6. tekstur (resize per tier);
  7. **validasi (0 error)**;
  8. kompresi sesuai preset.
- **Web** (bawaan): meshopt + WebP + quantization. KTX2 menyusul (opsi).
- **Unity:** GLB tanpa ekstensi kompresi, tekstur PNG/JPEG. Aman untuk glTFast.
- **Sumber:** ZIP berisi `.blend`, skrip, dan tekstur PNG, untuk diedit di Blender.
- **Unduh massal** dari Gudang: ZIP streaming (Web atau Unity, versi terkini tiap aset, maks. 100 aset).
- **Turntable Gudang:** strip WebP 24 frame (lebar total ≤16383 px), dibuat sekali per versi di `derived/`.
  Thumbnail = frame pertama.

## Lampiran F — Data & API
**Database** `data/app.db` (bun:sqlite + Drizzle, WAL)

| Tabel | Kolom utama |
|---|---|
| `assets` | id, name, prompt, tier, tierSnapshot, status, runState, lastError, sessionId, approvedBaseVersion, currentVersion, createdAt, updatedAt, deletedAt |
| `versions` | assetId, n, stage, stats, budget, manifest, createdAt |
| `events` | assetId, seq, type, payload, ts — unik (assetId, seq) |
| `jobs` | id, assetId, kind, status, startedAt, endedAt, error |
| `questions` | id, assetId, payload, status, answer |
| `attachments` | id, assetId, kind, path, name (nama asli disanitasi), mime, size, sha256 |
| `settings` | key, value |

**File**
```
data/assets/<id>/refs/          lampiran: <id>.png (≤1568 px) + <id>-decal.png (≤2048 px), atau model <id>.<ext>
data/assets/<id>/work/          base.py, material.py (ditulis Claude)
data/assets/<id>/versions/vN/   base.glb atau final.glb, web.glb, script.py (+ base.py), stats.json, scene.blend,
                                manifest.json (read-only)
data/assets/<id>/derived/vN/    contact-sheet.png, thumb.webp, turntable.webp, export-unity.glb, export-source-<hash nama>.zip
                                (cache, boleh dihapus)
data/jobs/<jobId>/              folder kerja container (sementara)
data/library/materials/         pustaka CC0 + catalog.json
data/backups/                   salinan app.db harian
```

**API** (Hono, validasi zod, error `{ code, message }`)

| Endpoint | Untuk |
|---|---|
| `GET /api/health`, `/api/health/{auth,runtime}` | Status server, sesi Claude, runtime |
| `GET/POST /api/assets` | Daftar (cari/filter/urut); buat aset baru (multipart) |
| `GET/PATCH/DELETE /api/assets/:id` | Detail, ganti nama, hapus |
| `GET /api/assets/:id/events?before&limit` | Snapshot thread (terbaru dulu per halaman, `hasMore`) |
| `POST /api/assets/:id/{messages,revise}` | Pesan / revisi pemilik (multipart: `text`, `files[]`) |
| `POST /api/assets/:id/{answers/:qid,approve,finish,change-shape,stop,retry,resume,duplicate}` | Aksi di Studio (JSON bila ada isi); jawaban = `{ asset }` terbaru |
| `GET /api/assets/:id/versions/:v/:file` | File versi (hanya nama di manifest) + `contact-sheet.png` dari `derived/` |
| `GET /api/assets/:id/attachments/:attachmentId` | Lampiran (gambar tampil; model diunduh dengan nama asli) |
| `GET /api/assets/:id/export?version&preset` | Unduh satu aset (`web`, `unity`, `source`) |
| `GET /api/assets/:id/export/estimate?version` | Ukuran tiap preset (pasti, atau perkiraan sampai file dibuat) |
| `POST /api/assets/export-zip/prepare` | Periksa aset untuk ZIP dan siapkan file Unity lebih dulu; error berupa JSON, jawaban `{ assets, bytes }` |
| `GET /api/assets/export-zip?ids&preset` | Unduh massal (ZIP streaming; semula `POST`, lihat Log keputusan) |
| `GET/PUT /api/settings` | Pengaturan |
| WebSocket `/api/ws` | Topik `global` dan `asset:<id>`; protokol ai-team |

## Lampiran G — Batas sumber daya & keamanan
**Mesin:** 16 core, RAM 14 GiB (±5 GB bebas), iGPU AMD (tanpa CUDA).

**Konkurensi**
- 1 job berat (Blender/optimasi) sekaligus.
- Maksimal 2 proses Claude hidup, termasuk cek kesehatan. Ditutup setelah idle 5 menit.
- Job baru hanya mulai bila RAM tersedia cukup.

| Langkah | Memori | Batas waktu |
|---|---|---|
| Tahap 1 (Blender) | 1,5 GB | 120 dtk |
| Tahap 2 (Blender + bake) | 2,5 GB | 300 dtk (Maksimal: 600 dtk) |
| Render | — | 30 dtk |

**Keamanan**
- **Host:**
  - Server hanya bind `127.0.0.1`; pagar Host/Origin di HTTP dan WebSocket.
  - Anggota grup docker setara root, jadi server tidak pernah dibuka ke jaringan.
- **Container:**
  - Tanpa jaringan, FS read-only kecuali `/job`, tanpa capability, `no-new-privileges`, batas pids/memori/CPU, user non-root.
  - Output dibaca dengan `lstat`: hanya file biasa, nama di-allowlist, ukuran dibatasi, symlink tidak diikuti.
- **Masukan:**
  - Lampiran dicek dari isi, gambar di-re-encode dengan metadata dibuang.
  - Nama file disanitasi; path dicek dengan realpath.
- **Claude:**
  - Akses file dibatasi 3 lapis; tanpa Bash/web/subagent.
  - Login langganan hanya untuk pemakaian pribadi; tidak pernah memakai `ANTHROPIC_API_KEY`.

---

## Log keputusan
| Tanggal | Keputusan | Alasan |
|---|---|---|
| 2026-11-13 | Desain FigCraft disetujui pemilik ("sudah cukup"); putaran review 2 dilewati | Layar yang belum digambar disusun dari komponen dan token yang ada |
| 2026-11-13 | Desain/prototipe berikutnya hanya di FigCraft; tanpa prototipe HTML | Permintaan pemilik |
| 2026-11-13 | Stack Bun + React. Hono menggantikan Express; bun:sqlite + Drizzle menggantikan JSON/JSONL | Permintaan pemilik (Bun + React); RPC bertipe; Gudang butuh query dan transaksi |
| 2026-11-13 | Blender 5.2 LTS via `bpy==5.2.4` di Docker | LTS sampai Jul 2028, versi bisa di-pin, bisa diuji dengan pytest. Cadangan: tarball 5.2.4 atau 4.5 LTS |
| 2026-11-13 | Implementasi 13 tahap dengan gerbang; spike runtime, Claude, dan tekstur sebelum UI | Permintaan pemilik: bertahap, berkualitas, minim bug |
| 2026-11-13 | Akses file Claude: Read/Glob/Grep terbatas, Write/Edit hanya di `work/`, guard 3 lapis | Iterasi lewat Edit lebih cepat daripada mengirim ulang skrip penuh. Cadangan: akses file lewat tool MCP |
| 2026-11-13 | Satu contact sheet ≤1024 px per hasil build; thinking `summarized` + effort `high` eksplisit | Hemat token dan tidak melewati batas gambar; ringkasan berpikir tampil di UI |
| 2026-11-13 | Aturan git mengikuti AGENTS.md ai-team | Konsistensi antarproyek milik pemilik |
| 2026-11-13 | Tahap 0: port app pindah dari 4330/4331 ke **4340/4341**; server E2E di **4342** | Port 4330/4331 dipakai learning-system (sedang berjalan) dan automated-test-app. Port diambil dari `shared/ports.ts` |
| 2026-11-13 | Tahap 0: `bun run dev` mengecek port API dan Vite sebelum menjalankan apa pun | `bun --watch` tidak keluar saat server gagal bind; tanpa cek ini Vite tetap meneruskan `/api` ke proses lain di port itu (terbukti dengan listener dummy) |
| 2026-11-13 | Tahap 0: adapter `@hono/bun` 1.0.1 dipakai sebagai pengganti `hono/bun` | `hono/bun` deprecated dan akan dihapus di Hono v5. Adapter resmi, MIT. Dependensi baru, sudah dicatat di TECH_STACK |
| 2026-11-13 | Tahap 0: basis TypeScript di `tsconfig.json`, bukan `tsconfig.base.json` | Bun (alias `@/`) dan shadcn CLI membaca `tsconfig.json`. `tsconfig.server.json`/`tsconfig.web.json` memperluasnya |
| 2026-11-13 | Tahap 0: Biome memakai `preset: "recommended"` dan mengecualikan `*.md` serta `web/styles/tokens.{css,ts}` | `recommended: true` deprecated di Biome 2.6. Biome 2.6 ikut memformat Markdown (mengubah template laporan). File token adalah hasil generator |
| 2026-11-13 | Tahap 0: token memakai `@theme static`, bukan `@theme inline` | Tema terang menimpa variabel `--color-*` yang sama. `inline` akan menanam nilai tema gelap langsung ke kelas utilitas, sehingga tema tidak bisa berganti |
| 2026-11-13 | Tahap 0: radius dari FigCraft 4/6/8/12 (`sm`/`md`/`lg`/`xl`) | FigCraft punya radius 4; rencana awal hanya menyebut 6/8/12 |
| 2026-11-13 | Tahap 0: generator token juga menulis `web/styles/tokens.ts` (nama + nilai per tema) | Dipakai `cn` (tailwind-merge mengenal `text-body`, dsb.), tes kontras WCAG, dan warna kanvas 3D yang tidak membaca CSS |
| 2026-11-13 | Tahap 0: koleksi FigCraft Icon dan Status tidak diekspor ke CSS | Keduanya alias mode di FigCraft; di kode, warna ikon memakai kelas `text-*` dan badge memakai varian komponen |
| 2026-11-13 | Tahap 0: tema bawaan **gelap**; pilihan disimpan di `localStorage` `aag-theme` (`dark`/`light`/`system`) | Tema gelap adalah tema utama desain. Skrip pemasang tema dibuat dari `web/theme-script.ts` dan disisipkan plugin Vite, jadi tidak ada duplikasi kunci |
| 2026-11-13 | Tahap 0: pagar Host/Origin hanya menerima nama loopback (127.0.0.1, localhost, ::1) | Lebih ketat daripada ai-team (tanpa `ALLOWED_HOSTS` dan alias `.local`); app hanya untuk mesin ini |
| 2026-11-13 | Tahap 0: E2E memakai build mode test yang disajikan server Bun di 4342 dengan `DATA_DIR=.tmp/e2e/data` | Sama dengan cara app produksi disajikan; `/_smoke` hanya ada di build mode test; data pemilik tidak tersentuh |
| 2026-11-13 | Tahap 0: shadcn CLI hanya dipakai untuk melihat sumber komponen (`--view`); import `cn` diganti `@/lib/utils.ts` | CLI 4.23 menulis `import { cn } from "cn"` (paket npm baru di luar TECH_STACK) tanpa opsi untuk mematikannya |
| 2026-11-13 | Tahap 0: peringatan `THREE.Clock` disaring di `web/lib/three-console.ts` (hanya pesan itu) | R3F 9.8.2, rilis stabil terbaru, masih membuat `THREE.Clock`, yang deprecated sejak three r183. Alternatifnya turun ke three 0.182. Filter dihapus saat R3F memakai `THREE.Timer` |
| 2026-11-13 | Tahap 0: drei `<Bounds>` tidak dipakai bersama `CameraControls`; viewer membingkai model dengan `fitToBox` | `Bounds` memanggil `controls.target.copy()`, yang tidak ada di CameraControls, sehingga error di setiap frame |
| 2026-11-13 | Tahap 0: `chunkSizeWarningLimit` Vite 1200 kB | Chunk 3D (three + R3F + drei) ±980 kB dimuat lazy dari localhost; batas bawaan 500 kB tidak relevan untuk app lokal |
| 2026-11-13 | Tahap 0 disetujui pemilik; kerangka UI sementara (header atas) tetap sampai Tahap 7 | Pemilik ingin app sama persis dengan FigCraft, tetapi memilih tetap mengikuti rencana: Rail + Topbar persis desain dibangun di Tahap 7 (rail 64 px menurut FigCraft, bukan 56 px). Di Tahap 7 header sementara, status server, dan teks placeholder dihapus |
| 2026-11-13 | Tahap 1: tag image `asset-forge:<12 hex sha256 isi Dockerfile + requirements.txt>`, bukan hash seluruh `runtime/` | `assetkit` dipasang read-only saat job berjalan, jadi mengubah helper, tes, atau contoh tidak perlu build ulang image ±2 GB (unduhan wheel bpy ±10 menit di jaringan mesin ini) |
| 2026-11-13 | Tahap 1: semua paket Python di-pin exact termasuk dependensi turunan (`pip freeze`); library sistem dari `ldd` bpy | Build bisa diulang persis. `libegl1`, `libgomp1`, `libxxf86vm1` terbukti tidak perlu (probe ekspor/bake/xatlas lolos tanpa itu) |
| 2026-11-13 | Tahap 1: flag tambahan runner: `--init`, mount `--mount type=bind` (bukan `-v`), tmpfs `nosuid,nodev`, env `HOME`/`AAG_THREADS`/`AAG_JOB_ID`/`PYTHONPATH`/`PYTHONDONTWRITEBYTECODE`, `--workdir /job` | `--init` me-reap proses anak (fork bomb, kill). `--mount` gagal bila folder host tidak ada, tidak diam-diam membuatnya milik root. Env dipasang runner supaya job tidak bergantung pada ENV image. Path mount dengan koma ditolak supaya tidak bisa menyelipkan opsi |
| 2026-11-13 | Tahap 1: job berjalan dengan `--user <uid:gid pemilik>`; image tetap punya user non-root 10001 | File output di `/job` langsung milik pemilik, tanpa `chown`. User image hanya berlaku bila image dijalankan manual |
| 2026-11-13 | Tahap 1: `test:assetkit` menjalankan pytest lewat `runJob` (flag sandbox sama dengan job sungguhan), batas waktu 300 dtk | Membuktikan helper bekerja di sandbox yang sebenarnya, bukan di container yang lebih longgar |
| 2026-11-13 | Tahap 1: tambahan perintah `bun run runtime:samples` (contoh → `tests/fixtures/glb/*.glb` + `*.stats.json`) | Fixture GLB untuk Tahap 2 bisa dibuat ulang dari skrip, bukan file biner yang asal-usulnya tidak jelas |
| 2026-11-13 | Tahap 1: output job ditulis ke `/job/out/`; hanya `base.glb` (≤50 MB) dan `stats.json` (≤256 KB) yang diterima; hardlink juga ditolak | Allowlist dan batas di `shared/limits.ts` (`BASE_OUTPUT_MAX_BYTES`). Hardlink ditolak karena bisa menunjuk file lain di filesystem yang sama |
| 2026-11-13 | Tahap 1: container yatim dibersihkan saat server start (fire-and-forget, gagal hanya dicatat) | Docker yang mati tidak boleh mencegah app terbuka; status runtime ditampilkan di Tahap 11. Catatan: dua server app yang jalan bersamaan (dev + E2E) bisa saling menghapus job; di Tahap 2 label diberi id instance bila perlu |
| 2026-11-13 | Tahap 1 disetujui pemilik ("lanjut"); Tahap 2 dimulai | Pertanyaan commit dan ruff di laporan Tahap 1 belum dijawab → tidak di-commit, ruff tidak ditambahkan |
| 2026-11-13 | Tahap 2: label container `aag.owner` (`d-` + 12 hex sha256 `DATA_DIR`; skrip `scripts`, tes `it`); pembersihan yatim hanya untuk pemilik yang sama | Temuan Tahap 1: server dev dan E2E saling menghapus job saat start. Snapshot argumen `docker run` diperbarui |
| 2026-11-13 | Tahap 2: halaman render di-bundle `Bun.build` dari `server/render/page/main.ts` dan dilayani `page.route` dari memori di origin `http://aag-render.invalid`; request lain diblokir | Tanpa port terbuka dan tanpa menyajikan `node_modules`; Chromium tidak bisa menjangkau jaringan. Kode halaman diketik dengan tipe DOM lewat `tsconfig.web.json`; sisi server memanggilnya lewat ekspresi string + zod |
| 2026-11-13 | Tahap 2: contact sheet 3 × 2 tile 328 px (1016 × 680), label sudut berbahasa Indonesia digambar di halaman; konvensi sudut = viewport Blender (depan = −Y Blender = +Z glTF) | Ukuran ≤1024 px tanpa resize. Label membantu Claude membaca sudut. Cakupan dan titik berat dihitung dari pass siluet (tanpa grid), dipakai tes dan bisa dipakai tool `forge` |
| 2026-11-13 | Tahap 2: skala grid lantai otomatis `10^floor(log10(2 × sisi terpanjang)) / 10` m per kotak | Aset 30 cm–2 m → kotak 1–10 cm; aset 5 m → 1 m. Claude bisa memperkirakan ukuran dari grid |
| 2026-11-13 | Tahap 2: optimasi memakai bawaan `prune()` (tekstur warna polos → faktor material); palet hanya Ringan dengan `min: 2`; simplify hanya bentuk dasar bila ≤ 1,25 × maks (target 95% maks, error ≤1% radius); resize tekstur per slot mempertahankan format; preset Web = WebP + meshopt `medium` (termasuk quantization) | Sesuai Lampiran E. Angka di `shared/limits.ts` |
| 2026-11-13 | Tahap 2: isi versi bentuk dasar = `base.glb` (teroptimasi, tanpa kompresi, yang divalidasi), `web.glb`, `script.py` (sumber kebenaran), `stats.json` (statistik, budget, validator, langkah optimasi); contact sheet di `derived/vN/` | Versi write-once; render bisa dibuat ulang kapan saja tanpa mengubah versi |
| 2026-11-13 | Tahap 2: budget dalam KB/MB desimal; material dihitung dari yang dipakai primitive; tekstur di slot yang tidak diizinkan tier dihitung lewat (maks 0); `webBytes` hanya dicek untuk aset final | Angka Lampiran D ditulis desimal. Bentuk dasar belum bertekstur, jadi ukuran `web.glb`-nya tidak relevan |
| 2026-11-13 | Tahap 2: toleransi cek bentuk: tiap sisi bbox ±5% (selisih ≤1 cm selalu lolos), segitiga ±25% | Lampiran tidak menyebut angka. UV seam dan bake tidak menambah segitiga; simplify bisa mengurangi. Bisa disetel setelah eval Tahap 4 |
| 2026-11-13 | Tahap 2: orkestrasi skrip → versi di `server/services/build-version.ts` (`buildBaseVersion`), dipakai `pipeline:demo` dan nanti tool `forge` | Satu jalur yang sama untuk demo, tes integrasi, dan Tahap 3. Kegagalan skrip dikembalikan sebagai `code` (`SCRIPT_ERROR`, `TIMEOUT`, `OOM`, `VALIDATION_FAILED`) |
| 2026-11-13 | Tahap 2: `test:pipeline` = `tests/pipeline` (renderer, butuh Chromium); tes unit pipeline, versi, jalur job, dan bentuk tetap di `bun run check` | `check` tetap cepat (±1 dtk) dan tidak butuh browser |
| 2026-11-13 | Tahap 2: golden dibandingkan lewat decode PNG oleh sharp; `pngjs` belum dipakai | sharp sudah ada dan bertipe; `pngjs` tidak punya tipe. Usul: hapus `pngjs` dari dependensi bila tetap tidak dipakai di Tahap 8 |
| 2026-11-13 | Tahap 2 disetujui pemilik ("lanjut"); Tahap 3 dimulai tanpa memakai kuota | "lanjut" bukan izin kuota: `eval:base`, `AGENT_DRIVER=sdk`, dan perekaman stream nyata menunggu izin eksplisit. Pertanyaan commit, ruff, toleransi bentuk, dan `pngjs` belum dijawab → tidak di-commit, tanpa ruff, toleransi usulan tetap, `pngjs` tetap |
| 2026-11-13 | Tahap 3: `AgentPort` = `start(options)` → `AgentSession` (`messages`, `send`, `interrupt`, `close`, `accountInfo`, `supportedModels`); antrean input dimiliki adapter | `send` ada di sesi (sesuai PLAN), tes memakai `FakeAgentPort` tanpa proses Claude. Kuitansi interrupt dinormalisasi ke camelCase di adapter |
| 2026-11-13 | Tahap 3: state aset spike di memori (`server/agent/forge/state.ts`: `briefing` → `base_working` → `base_review`) | Tahap 3 tanpa SQLite (PLAN). Tahap 5 menggantinya dengan `transition()` dan status Lampiran C |
| 2026-11-13 | Tahap 3: kode error forge ditambah `IN_REVIEW`, `SCRIPT_MISSING`, `VERSION_NOT_FOUND`, `CANCELLED` | Kasus yang tidak tercakup daftar Lampiran B: build/brief saat review, `work/base.py` belum ada, nomor versi salah, Stop di tengah build |
| 2026-11-13 | Tahap 3: build gagal ikut dihitung dalam batas 8 build per pesan | Mencegah loop perbaikan tanpa akhir; jatah direset oleh pesan pemilik berikutnya |
| 2026-11-13 | Tahap 3: hasil `build_base_mesh` memuat `dimensions` (ukuran hasil vs brief, %) | Membantu Claude membandingkan dengan brief tanpa menghitung sendiri dari bbox Y-up |
| 2026-11-13 | Tahap 3: pagar: Read/Glob/Grep hanya `work/`, `refs/`, `knowledge/` (bukan seluruh folder aset); symlink menggantung dan pola glob absolut/`..` ditolak | Lebih ketat dari Lampiran B; Claude tidak butuh `versions/` (ada `inspect_version`) |
| 2026-11-13 | Tahap 3: `permissionMode: "default"` + aturan `Read(//…)`/`Edit(//…)` + `canUseTool` (pagar yang sama) + hook PreToolUse tanpa matcher | Tiga lapis memakai satu fungsi `checkToolUse`; mode tidak bergantung pada `auto` |
| 2026-11-13 | Tahap 3: resep cookbook = salinan persis `runtime/samples/*.py` (dijaga tes); sampel baru `pohon.py` dan `makhluk.py`, fixture GLB-nya ditambahkan | Resep yang dibaca Claude dijamin pernah berjalan di sandbox. `laras.glb` lama dipertahankan: ekspor ulang berbeda 654 byte (statistik sama), supaya golden render tidak berubah |
| 2026-11-13 | Tahap 3: tes batas: hanya `sdk-adapter.ts` yang meng-import `query` (pengecualian: smoke Tahap 0 yang hanya mengecek export), web tanpa Agent SDK, tanpa `ANTHROPIC_API_KEY` di luar `agentEnv()` | Menegakkan AGENTS §6 secara otomatis |
| 2026-11-13 | Tahap 3: `eval:base` menolak berjalan tanpa `--confirm` (hanya mencetak rencana); container eval berlabel `aag.owner=eval` | Pengaman tambahan agar kuota tidak terpakai tanpa sengaja |
| 2026-11-13 | Pemilik mengizinkan kuota untuk `eval:base` 1 prompt dulu (`--only peti`); sisanya setelah hasilnya dilihat | Jawaban atas pertanyaan izin kuota |
| 2026-11-13 | Tahap 3: `eval:base` dijalankan dengan izin (peti dulu, lalu 4 sisanya + Stop/resume): 5/5 lolos syarat otomatis, 1–3 build, 1,1–2,3 menit per prompt | Hasil di `docs/progress/tahap-03.md`; skor pemilik dan keputusan lanjut/tidak menunggu review |
| 2026-11-13 | Tahap 3: fixture kontrak `tests/fixtures/sdk/base-peti.jsonl` dari rekaman eval (dipangkas `scripts/sdk-fixture.ts`, disanitasi) + `server/agent/contract.test.ts` | Tes kontrak memastikan daftar tool sesi nyata = allowlist + forge, event app terbentuk, result membawa uuid pesan |
| 2026-11-13 | Tahap 3: sesi lanjutan di skenario Stop/resume `eval:base` memakai folder aset yang sama | Run pertama memakai folder berbeda (salah skrip eval); resume tetap berhasil, Claude menulis ulang skrip dari konteks sesi |
| 2026-11-13 | Tahap 3 disetujui pemilik ("lanjut") sebagai keputusan gerbang **lanjut**, tanpa skor angka per aset; `assetkit` tidak diubah. Pertanyaan terbuka memakai bawaan (ringkasan berpikir dibiarkan, tanpa commit, tanpa ruff, toleransi bentuk tetap, `pngjs` tetap). Tahap 4 dimulai | Jawaban pemilik atas laporan Tahap 3 |
| 2026-11-13 | Tahap 4: pustaka material = 60 material ambientCG (1K + 2K JPG) di `runtime/materials.txt`; checksum sha256 dicatat saat unduhan pertama di `runtime/materials.lock.json` (TOFU) karena API v3 hanya memberi ukuran, bukan checksum | Unduhan berikutnya dan `--force` diverifikasi terhadap lock; redirect hanya ke host ambientCG yang di-allowlist |
| 2026-11-13 | Tahap 4: harness mem-bake **semua material ke satu material atlas** (xatlas, baseColor + normal + ORM) setelah `finalize()`; skrip Claude boleh memakai material sebanyak apa pun | Jumlah material di GLB selalu 1, jadi budget material dan draw call aman; Claude tidak perlu mengurus UV. Ringan tanpa normal/ORM: AO dan logam dikalikan ke warna |
| 2026-11-13 | Tahap 4: skrip tahap tekstur `work/material.py` memanggil `scene.run_base()` (salinan `script.py` bentuk dasar yang disetujui, dipasang sebagai `/job/base.py`) lalu memasang material lewat `scene.get(nama)` | Geometri dijamin sama dengan yang disetujui; `SHAPE_DRIFT` tetap ditegakkan server sebagai pagar |
| 2026-11-13 | Tahap 4: `bake.pbr` hanya map `normal`; AO di-bake dari aset final saat atlas (bukan dari high-poly). Decal dan detail high-poly dicatat skrip, dipasang/di-bake harness setelah `finalize()` | Posisi akhir baru diketahui setelah finalize (origin dasar-tengah); AO dari aset final mencakup oklusi antarbagian |
| 2026-11-13 | Tahap 4: pustaka material dipasang read-only di `/materials` (env `AAG_MATERIALS`) hanya untuk job bertekstur; snapshot argumen `docker run` baru untuk job bertekstur, snapshot job bentuk dasar tidak berubah | Flag sandbox lain sama; tes snapshot menjaga keduanya |
| 2026-11-13 | Tahap 4: optimasi membuang slot tekstur yang tidak diizinkan tier (`dropDisallowedSlots`, mis. normal/ORM di Ringan) sebelum prune | Budget tekstur per tier ditegakkan di harness, bukan hanya di bake |
| 2026-11-13 | Tahap 4: kode error forge baru `BASE_NOT_APPROVED`, `SHAPE_DRIFT`, `BASE_LOCKED` (`build_base_mesh`/`record_brief` di tahap tekstur), `LIBRARY_MISSING`; `Forge.approveBase()` = aksi pemilik (Tahap 6 memanggilnya dari HTTP, eval memanggil langsung) | Gerbang di server; Lampiran B tidak menyebut penguncian bentuk setelah disetujui, padahal tanpa itu `SHAPE_DRIFT` bisa dilewati |
| 2026-11-13 | Tahap 4: `list_materials` memakai filter `category` (8 kategori) selain kueri teks, dan mengembalikan 1 lembar contoh (4 kolom, label id) | Tag ambientCG tidak konsisten; kategori dari `materials.txt` lebih andal. Lembar contoh = 1 gambar, sesuai aturan hasil tool |
| 2026-11-13 | Tahap 4: perintah `runtime.ts probe <skrip> [--textured TIER]` dan `textured-samples` (fixture `tests/fixtures/glb/textured/*.glb`, tekstur di-encode ulang JPEG supaya kecil); `runtime:samples` tidak dijalankan ulang | Fixture bentuk dasar tidak ikut berubah (laras.glb tidak deterministik byte demi byte) |
| 2026-11-13 | Tahap 4: helper eval bersama dipindah ke `scripts/eval/session.ts`; `summarizeRun` menerima batas per tahap (`TEXTURE_LIMITS`: ≤4 build, 15 menit) | Batas waktu tekstur 15 menit karena bake lebih lama dari build bentuk dasar |
| 2026-11-14 | Pemilik mengizinkan kuota untuk `eval:texture` 1 kasus dulu (`--only peti`, sesi resume); 2 kasus sisanya hanya setelah pemilik melihat hasilnya | Jawaban atas pertanyaan izin kuota |
| 2026-11-14 | Tahap 4: `eval:texture --only peti` (sesi resume): lolos, 2 build, 0,9 menit, konteks terbesar ±47 rb token, 4 gambar ke Claude | Hasil di `eval/runs/2026-11-13T17-05-54-844Z-texture/`; 2 kasus sisanya menunggu pemilik melihat hasil |
| 2026-11-14 | Tahap 4: GLB bertekstur mengekspor tangent (`export_tangents`), dan hasil build `forge` menampilkan isi pesan error/peringatan validator (maks 3) | Temuan eval peti: peringatan `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`, dan Claude tidak bisa melihat isinya. Ukuran `web.glb` naik ±2% |
| 2026-11-14 | Pemilik menjawab "lanjut" atas pertanyaan menjalankan 2 kasus sisanya → `eval:texture --only pistol-scifi,rubah` (sesi resume) | Jawaban atas pertanyaan izin kuota yang eksplisit |
| 2026-11-14 | Tahap 4: `eval:texture --only pistol-scifi,rubah` (sesi resume): keduanya lolos (2 dan 1 build, 0,5–0,9 menit). Total 3/3 lolos syarat otomatis | Hasil di `eval/runs/2026-11-13T17-14-28-193Z-texture/`; skor pemilik menunggu review |
| 2026-11-14 | Tahap 4: **satu sesi lintas tahap** (resume sesi bentuk dasar untuk tahap tekstur), bukan sesi baru dengan ringkasan | Data 3 kasus: konteks terbesar 41–54 rb token (jauh di bawah batas konteks), 1–4 gambar per tahap tekstur. Claude memakai nama bagian dan keputusan dari tahap bentuk dasar tanpa membaca ulang. Ditinjau ulang bila revisi berulang membuat konteks > ±150 rb token (opsi: sesi baru dengan ringkasan) |
| 2026-11-14 | Skor pemilik Tahap 4: pistol sci-fi 3, peti 3, rubah 2 → 2 dari 3 layak (≥3/5), DoD skor terpenuhi di batas bawah. Gerbang lanjut/tidak dan soal emisi belum dijawab | Jawaban pemilik atas laporan Tahap 4 |
| 2026-11-14 | Gerbang Tahap 4: pemilik memilih **perbaiki kualitas dulu**; emisi ditunda. Alasan skor rendah menurut pemilik: detail wajah/kecil hilang, bentuk dasar kurang, material kurang hidup, telapak rubah menghadap ke belakang, dan kualitasnya setara tier Ringan | Jawaban pemilik. Penyebab yang ditemukan: segitiga hanya 20–50% target Sedang; resep makhluk tanpa mata/telapak; mirror Y membalik arah bagian; material warna rata |
| 2026-11-14 | Perbaikan kualitas masuk Tahap 4 (permintaan eksplisit pemilik): detail per tier, cookbook lebih kaya, helper material. Tanpa field `details` di brief. Bagian bentuk dasar (prompt, knowledge, cookbook) ikut diubah walau dibuat di Tahap 3 | Pilihan pemilik; eval ulang ditanyakan setelah perbaikan lolos tes |
| 2026-11-14 | Skrip contoh `peti.py`/`makhluk.py` diperkaya, tetapi fixture `tests/fixtures/glb/peti.glb`/`makhluk.glb` tidak dibuat ulang | `peti.glb` dipakai golden render; fixture bentuk dasar cukup sebagai data uji pipeline (preseden `laras.glb`). Fixture bertekstur dibuat ulang dari contoh baru |
| 2026-11-14 | Perbaikan kualitas — detail: `DETAIL_USAGE` (40–90% target segitiga) di `shared/limits.ts`; arahan detail per tier di system prompt; `detailHint` di hasil `build_base_mesh` bila < 40% target (petunjuk, bukan gerbang); cek arah bagian (mirror Y membalik arah) di prompt dan `API.md` | Gerbang keras ditolak: bentuk yang memang sederhana tetap boleh dikirim dengan penjelasan |
| 2026-11-14 | Perbaikan kualitas — cookbook: contoh makhluk dengan mata + pupil, hidung, telinga dalam, dada, telapak menghadap depan (tanpa mirror Y), ujung ekor terpisah; moncong contoh lama ternyata terbalik (−90° → +90°). Contoh peti + paku keling dan engsel | Claude meniru resep; resep lama tanpa wajah dan telapak ikut menyebabkan skor rubah 2 |
| 2026-11-14 | Perbaikan kualitas — material: `material.pbr(variation=…)` (noise 3D), `material.wear(edge=…, dirt=…)` (Bevel/AO Cycles saat bake), `decal.paint(shape="circle"/"square")`. Bake warna/kekasaran memakai 24 sampel bila ada `wear` | Dampak waktu bake contoh peti: Sedang 4 → 17 dtk, Maksimal 14 → 69 dtk (batas 600 dtk); RAM tidak berubah |
| 2026-11-14 | `textured-samples` juga menyimpan bentuk dasar yang cocok (`tests/fixtures/glb/textured/<nama>-base.glb`), dan tekstur fixture diperkecil ke 512 px; `runtime.ts probe --base` untuk menjalankan contoh bentuk dasar lewat harness | Fixture bentuk dasar lama dibekukan untuk golden, jadi tes tahap tekstur butuh pasangan bentuk dasar sendiri |
| 2026-11-14 | Pemilik mengizinkan kuota eval ulang **rubah saja** (`eval:base --only rubah` lalu `eval:texture --only rubah`, sesi baru); kasus lain hanya setelah pemilik melihat hasilnya | Jawaban atas pertanyaan izin kuota |
| 2026-11-14 | Eval ulang rubah (sesi baru, lalu tahap tekstur melanjutkan sesi itu): bentuk dasar lolos (3 build, 2,8 menit, 7.592 segitiga; sebelumnya 4.044), tekstur lolos (1 build, 0,9 menit, `web.glb` 453 KB). Claude memakai mata + pupil, jari kaki, telapak tanpa mirror Y, `variation`, `wear`, dan `decal.paint`. Total ±$1,65 setara API | Hasil di `eval/runs/2026-11-13T17-48-50-501Z/` dan `eval/runs/2026-11-13T17-51-39-215Z-texture/`; peti dan pistol menunggu pemilik melihat hasil |
| 2026-11-14 | Deteksi "rujuk contact sheet" di eval juga mengenali kata bahasa Inggris (ringkasan berpikir berbahasa Inggris); `API.md` menjelaskan normal map datar dibuang otomatis | Temuan eval ulang rubah: kolom rujukan salah "tidak", dan Claude tidak tahu kenapa normal map tidak ada |
| 2026-11-14 | Skor pemilik rubah ulang: 3 ("matanya agak seram, tapi oke"). Penyebab kesan seram: bola mata putih tinggi dengan pupil kecil. Usulan iris gelap besar dicatat di laporan Tahap 4, belum masuk tahap mana pun | Jawaban pemilik |
| 2026-11-14 | Tahap 4 disetujui pemilik ("lanjut aja ke tahap selanjutnya") sebagai keputusan gerbang **lanjut**; peti dan pistol tidak dievaluasi ulang; emisi tetap ditunda. Tahap 5 dimulai | Jawaban pemilik atas hasil eval ulang |
| 2026-11-14 | **Delegasi gerbang tahap:** pemilik menulis "lanjut aja setiap tahap sampai selesai, anda review, anda jawab, anda revisi sendiri". Mulai Tahap 5, agent meninjau sendiri tiap tahap, menjawab pertanyaan terbuka sendiri (dicatat di sini), lalu lanjut ke tahap berikutnya tanpa menunggu. Disiplin tahap tetap: tes, DoD, dan laporan `docs/progress/tahap-NN.md`; status tahap ditulis `disetujui (tinjauan agent)`. **Tidak termasuk delegasi:** perintah berkuota (`eval:*`, `AGENT_DRIVER=sdk`, uji nyata), commit/push/branch, menghapus data pemilik, dan perubahan di luar repo (mis. memasang unit systemd). Langkah itu dilewati dan dicatat di laporan sebagai menunggu izin | Permintaan pemilik |
| 2026-11-14 | Tahap 5: skema event diperluas — `user.origin` (`approved`/`change_shape`/`resume`/`retry`) dan `build_started.stage`. Event `user` dicatat saat pesan masuk antrean, `turn_started` saat pesan benar-benar terkirim ke Claude | Thread menampilkan pesan yang masih antre (mis. menunggu slot pool); jatah build direset per pesan yang terkirim, bukan per pesan yang diketik |
| 2026-11-14 | Tahap 5: pool proses Claude (`server/agent/pool.ts`) maks. 2, LRU hanya untuk anggota yang bisa digusur (tanpa giliran, inbox kosong, tanpa kartu pertanyaan), antrean FIFO, `withSlot` untuk cek kesehatan; pesan "Menunggu giliran proses Claude…" bila harus menunggu. Proses idle 5 menit ditutup; pesan berikutnya me-resume sesi | Batas sumber daya Lampiran G; sesi tetap utuh lewat `resume` |
| 2026-11-14 | Tahap 5: batas pemakaian diputuskan di akhir giliran — gagal bila batas datang dari teks Claude atau `result` error, juga bila aliran putus di tengah giliran; `resetsAt` detik → ms; pesan antre dibuang dengan pemberitahuan | `rate_limit_event` bisa datang sebagai peringatan (`allowed_warning`) tanpa menghentikan giliran |
| 2026-11-14 | Tahap 5: aksi pemilik selain mengetik dikirim ke Claude sebagai pesan `[Sistem] …` (`server/agent/prompts.ts`). Lanjutkan/Coba lagi mengutip permintaan pemilik terakhir (maks. 4.000 karakter, melewati pesan lanjutkan/coba lagi). Sesi baru pada aset yang sudah berjalan (duplikat, sesi hilang) diberi pembuka berisi ringkasan status, versi, dan brief | Claude mungkin belum menerima pesan terakhir saat proses terputus |
| 2026-11-14 | Tahap 5: `Forge.approveBase()` dihapus. Persetujuan = aksi pemilik `approve` lewat `transition()`; forge membaca base yang disetujui dari `approvedBaseVersion` di database. Skrip `eval:*` dan tes integrasi Stop memakai `AssetStore` di SQLite memori (`openTestStore`) | Status hanya berubah lewat `transition()` (AGENTS §3); menggantikan catatan Tahap 4 tentang `approveBase()` |
| 2026-11-14 | Tahap 5 (dijawab agent, delegasi): **Duplikat** = salinan penuh — status, brief, versi (file + indeks), lampiran, `work/` dan `derived/`; `runState` idle, tanpa sesi Claude dan tanpa riwayat thread; nama "<nama> (salinan)". Pesan pertama membuka sesi baru dengan ringkasan keadaan | Duplikat berguna untuk mencoba arah lain dari titik yang sama. Alternatif (hanya prompt) bisa dipilih pemilik nanti; perubahan cukup di `AssetService.duplicate` |
| 2026-11-14 | Tahap 5: **Hapus** = baris aset ditandai `deletedAt` (soft delete), sesi ditutup, build berjalan dibatalkan (container di-kill), job dibatalkan, lalu folder aset dihapus (folder versi read-only dibuka dulu) | Lampiran F; versi write-once tidak bisa dihapus tanpa `chmod` |
| 2026-11-14 | Tahap 5: driver palsu — `ScenarioAgentPort` + skenario bawaan yang membaca status lewat `list_versions`. Penanda `[tanya]`, `[tanya-banyak]`, `[macet]`, `[batas]`, `[mati]` hanya berlaku di pesan pemilik (bukan pesan `[Sistem]` yang mengutipnya). `RUNTIME_DRIVER=fixture` memakai pasangan `textured/peti-base` → `textured/peti` dan contact sheet di `tests/fixtures/contact-sheets/` (`bun scripts/fixture-sheets.ts`) | Skrip contoh peti dipakai skenario, jadi `fake × docker` juga valid; Coba lagi tidak memicu batas lagi |
| 2026-11-14 | Tahap 5: akar komposisi `server/compose.ts` satu-satunya pemilih driver (`AGENT_DRIVER` bawaan `sdk`, `RUNTIME_DRIVER` bawaan `docker`); pemulihan saat start dijalankan di sana sebelum server menerima request; folder job app di `data/jobs/` | Bawaan = jalur sungguhan; mode palsu harus dipilih eksplisit |
| 2026-11-14 | Tahap 5: cakupan lewat `bun run test:coverage` (masuk `bun run check`). Bun 1.4.4 mengecek ambang **per file** dan hanya file yang dimuat tes; mengisi `lines` saja ikut menegakkan `functions`, jadi `functions = 0` eksplisit. `sdk-adapter.ts`, `recording-port.ts`, dan `forge/builder.ts` tidak dimuat tes domain/agent (diuji lewat `check:auth`, eval, dan `RUNTIME_IT`) | Perilaku Bun diuji langsung, bukan dari ingatan |
| 2026-11-14 | Tahap 5: tes batas arsitektur `tests/architecture/boundaries.test.ts` (domain murni, services tidak bergantung pada agent/http/realtime, database hanya di `server/db`, web hanya `AppType`, Playwright hanya di `server/render`, CLI docker hanya di `server/runtime/docker.ts`) | AGENTS §3 kini dijaga tes, bukan hanya ulasan |
| 2026-11-14 | Tahap 5 (tinjauan agent): `turn_started` membersihkan `lastError`; sesi Claude yang gagal disiapkan → `SESSION_FAILED` tanpa melempar (aset tetap dibuat, detail hanya di log); `close()` sesi aset ikut membatalkan build yang berjalan | Temuan tinjauan sendiri; masing-masing diawali tes yang gagal |
| 2026-11-14 | Tahap 5 ditutup dengan tinjauan agent (delegasi pemilik); Tahap 6 dimulai | Laporan `docs/progress/tahap-05.md` |
| 2026-11-14 | Tahap 6: lampiran dicek dari isi (PNG/JPEG/WebP/GIF; GLB, glTF mandiri, OBJ, FBX, STL). Gambar di-re-encode ke PNG tanpa metadata: `<id>.png` ≤1568 px untuk Read Claude, `<id>-decal.png` ≤2048 px untuk `decal.from_image`; model disimpan apa adanya. glTF dengan `.bin`/tekstur terpisah ditolak (pesan: ekspor sebagai `.glb`). Nama di disk dari id; nama asli disanitasi untuk tampilan (kolom `attachments.name`, migrasi `0002_attachment_name`). Batas di `shared/limits.ts`: 8 file/pesan, gambar 20 MB dan 100 MP, model 50 MB, request 200 MB | Rencana Tahap 6; nama asli tidak pernah dipakai sebagai path |
| 2026-11-14 | Tahap 6: pesan pemilik berlampiran — gerbang `transition()` dicek dulu (gambar tidak diproses untuk aksi yang pasti ditolak), file + baris ditulis, lalu aksi diterapkan; bila status berubah di antaranya, lampiran dibatalkan lagi. Thread (`user`) menampilkan kata-kata pemilik + chip `attachments`; catatan lampiran (path absolut `refs/`, path container `/refs/<file>`) hanya terkirim ke Claude | Read Claude Code mewajibkan path absolut dan folder kerja Claude adalah `work/` |
| 2026-11-14 | Tahap 6: `refs/` dipasang read-only di `/refs` pada setiap build bila foldernya ada (bukan symlink). Cara mengimpor model referensi (`import_scene.gltf`, `wm.obj_import`, `wm.stl_import`, `import_scene.fbx`) ditulis di `runtime/knowledge/CONVENTIONS.md`; helper impor di `assetkit` hanya usulan (belum dibuat) | Tahap 6 hanya mewajibkan mount; terbukti di `RUNTIME_IT` (impor GLB, tulis ke `/refs` gagal) |
| 2026-11-14 | Tahap 6: API — daftar aset urut terakhir berubah (cari/filter/urut Tahap 10); aksi menjawab `{ asset }` terbaru; DELETE 204; thread per halaman (bawaan 200, maks 500) dengan `hasMore`; file versi hanya nama di manifest + contact sheet; versi/lampiran `private, max-age=31536000, immutable`, turunan `no-cache`; semua file `nosniff` + CSP `sandbox`; model lampiran `Content-Disposition` RFC 6266. Rute `finish`, `change-shape`, `resume`, dan `attachments/:id` ditambahkan ke Lampiran F | Kontrak dipakai web lewat `hc<AppType>` |
| 2026-11-14 | Tahap 6: error service → HTTP lewat tabel lengkap `SERVICE_STATUS` (tanpa `default`): 404 tidak ditemukan, 400 isi salah, 409 gerbang status, 413 terlalu besar, 415 tipe tidak didukung. Validasi zod → 400 `VALIDATION_FAILED` dengan nama field saja (nilai kiriman tidak digemakan). Body JSON ≤256 KB dan unggahan ≤200 MB lewat `bodyLimit` Hono (`PAYLOAD_TOO_LARGE`); `maxRequestBodySize` Bun 1 MB di atasnya | Kode baru wajib diputuskan statusnya; klien selalu menerima `{ code, message }` |
| 2026-11-14 | Tahap 6: hub realtime — protokol ai-team; topik `global` (perubahan daftar aset) dan `asset:<id>` (`{type:"thread", stored}` tersimpan + live, `resync` bila tertinggal >1000, `asset_deleted`). Backpressure: `send()` = -1 → sambungan padat sampai `drain` (handler `drain` dipasang di `main.ts`), event live dilewati; antrean >4 MB event live dilewati; >12 MB, atau event penting dibuang Bun (`send()` = 0) → sambungan ditutup 1013 dan klien replay dengan `after`. Detak `{op:"hb"}` 25 dtk; ping protokol dan sambungan mati ditangani Bun (`idleTimeout` 120 dtk). Hub dikunci dengan objek `ServerWebSocket` asli | Pembungkus `WSContext` dibuat ulang setiap event; 12 MB < `backpressureLimit` bawaan Bun 16 MB supaya hub yang memutus |
| 2026-11-14 | Tahap 6: `main.ts` menutup hub sebelum `server.stop()` (Bun menunggu sambungan yang masih terbuka); pembersihan container yatim hanya untuk `RUNTIME_DRIVER=docker`; server E2E Playwright memakai `AGENT_DRIVER=fake` + `RUNTIME_DRIVER=fixture` | Tes rutin tanpa kuota/Docker (AGENTS §10) |
| 2026-11-14 | Tahap 6: angka batas dipindah ke `shared/limits.ts` (`EVENTS_PAGE_MAX`, `OTHER_ANSWER_MAX_CHARS`) dan ditambah (`WS_*`, `JSON_BODY_MAX_BYTES`, `EVENTS_PAGE_DEFAULT`, lampiran). Nama aset dari pemilik divalidasi (`INVALID_NAME`: kosong, karakter kontrol, >80) alih-alih dipotong diam-diam | AGENTS §3 |
| 2026-11-14 | Tahap 6: builder fixture ikut menulis `web.glb` seperti builder sungguhan; `tsconfig.web.json` menyertakan `server/types` (tipe `AppType` menarik kode server sampai pipeline); `tsconfig.server.json` menyertakan `tests/architecture` (sebelumnya tidak ikut typecheck), `tests/support`, `tests/e2e-api` | Unduhan `web.glb` teruji tanpa Docker; typecheck menyeluruh |
| 2026-11-14 | Tahap 6: `bun run e2e:api` = `bun test ./tests/e2e-api`: proses `bun server/main.ts` di port 4342 (mode palsu, DATA_DIR sementara + pustaka material uji), client `hc<AppType>` + WebSocket, log server wajib tanpa warn/error. Echo Tahap 0 dihapus; halaman uji memakai probe realtime (sub `global` → `ready`) | DoD Tahap 6 |
| 2026-11-14 | Tahap 6 (tinjauan agent): replay berhalaman berhenti terlalu cepat bila halaman berisi baris event yang tidak lolos skema (halaman dianggap tidak penuh). `listEvents` kini melaporkan jumlah baris mentah (`rows`) dan `lastSeq`; replay memakai keduanya. Tes gagal ditulis dulu | Klien yang tersambung ulang bisa kehilangan event tanpa resync |
| 2026-11-14 | Tahap 6 (tinjauan agent): Coba lagi/Lanjutkan ikut mengutip lampiran permintaan terakhir (chip di event `user` → baris lampiran → catatan path absolut `refs/` disusun ulang). Bila sesi Claude gagal disiapkan, pesan pemilik kini tetap dicatat di thread (sebelumnya hilang, sehingga Coba lagi tidak mengutip apa pun) | Temuan peninjau independen + tes baru |
| 2026-11-14 | Tahap 6 (tinjauan agent): teks ke Claude selalu valid. Potongan per code point lewat `shared/text.ts` (nama lampiran, nama aset, kutipan, pratinjau event); runner mengganti surrogate tunggal di pesan dan jawaban "Lainnya" | API Claude menolak surrogate tunggal; teks itu masuk transkrip sesi dan membuat giliran berikutnya ikut gagal |
| 2026-11-14 | Tahap 6 (tinjauan agent): error teknis sesi Claude (gagal dimulai, proses mati) tidak lagi diteruskan ke klien. Pemilik menerima pesan umum berbahasa Indonesia; detail ke log lewat `onError` (runner → sesi → service → pino) | AGENTS §5; pesan mentah bisa berisi path home dan teks Inggris |
| 2026-11-14 | Tahap 6 (tinjauan agent): file kosong → `INVALID_FILE` "file kosong" (dulu terbaca sebagai tipe tidak didukung); pesan 413 memakai `formatBytes` (dulu "maksimal 0 MB" untuk body JSON). `shared/format.ts` dibuat lebih awal untuk ini; Tahap 7 menambah format angka dan tanggal. Unggahan yang asetnya dihapus di tengah jalan tidak membuat folder aset lagi. Angka batas lokal di skema rute dihapus (panjang dicek service/domain, ukuran oleh batas body); `ATTACHMENT_TEXT_SNIFF_BYTES` pindah ke `shared/limits.ts` | AGENTS §3 |
| 2026-11-14 | Tahap 6 (tinjauan agent), diterima tanpa perubahan: event `init` di thread membawa `sessionId` (app lokal satu pengguna; bukan kredensial); unggahan 200 MB bisa memakai memori ±3× ukurannya selama request (dicatat sebagai risiko; streaming bila perlu) | Lihat laporan Tahap 6 |
| 2026-11-14 | Tahap 6 ditutup dengan tinjauan agent (delegasi pemilik); Tahap 7 dimulai | Laporan `docs/progress/tahap-06.md` |
| 2026-11-14 | Tahap 7: komponen yang belum ada di FigCraft (Field, Textarea, Dialog, Toast, Empty state, Theme toggle, Menu umum, Chip akun, Item versi, Langkah progres terbuka, Meter, state tombol nonaktif/memuat/fokus) digambar dulu di frame #2743 "Tahap 7 · komponen tambahan", baru diimplementasikan. Disetujui agent (delegasi pemilik) | FigCraft tetap sumber kebenaran desain (AGENTS §2); PNG `design/exports/00-components-tahap7*.png` |
| 2026-11-14 | Tahap 7: ikon lewat `LucideProvider` (`strokeWidth 1.5` + `nonScalingStroke`). Ukuran ikon mengikuti komponen (Button md 16 / sm 14, IconButton md 18 / sm 16, NavItem 20). Di FigCraft, 38 ikon hasil swap (20 px) di rel, toolbar viewport, dan layar 01–03 kedua tema dikembalikan ke ukuran komponen; PNG desain diekspor ulang | Garis 1,5 px di semua ukuran, sama dengan FigCraft (ketebalan garis FigCraft tetap ~1,46 px saat ikon diubah ukurannya). Ikon 20 px di layar adalah efek swap instance, bukan keputusan desain |
| 2026-11-14 | Tahap 7: token `text/tertiary` dinaikkan untuk kontras AA: gelap #85858D → #8C8C93, terang #737379 → #6A6A70 (FigCraft → `tokens:sync` → PNG diekspor ulang). Meta di baris versi aktif memakai `text/secondary` | axe `color-contrast` gagal (4,28–4,33) pada label rel, toggle tema, dan teks meta di `bg/elevated`. Tersier di atas `bg/active` tetap di bawah 4,5 |
| 2026-11-14 | Tahap 7: `Menu` tidak modal secara bawaan | Menu modal Radix memberi `aria-hidden` pada app yang masih berisi elemen fokus (axe `aria-hidden-focus`, serius). Escape dan klik di luar tetap menutup menu; klik di luar ikut sampai ke sasarannya |
| 2026-11-14 | Tahap 7: ukuran file untuk pengguna memakai satuan desimal (1 KB = 1000) di `shared/format.ts`. Batas lampiran, unggahan, dan body JSON di `shared/limits.ts` ikut desimal (20 MB, 50 MB, 200 MB, 256 KB); batas memori dan keluaran job tetap MiB. Teks info tier di FigCraft diubah "±0,8 MB" → "±800 KB", sama dengan formatter | Budget tier dan desain memakai angka desimal; satu aturan format untuk semua tempat |
| 2026-11-14 | Tahap 7: nilai di luar skala token ditulis sebagai nilai arbitrer Tailwind sesuai FigCraft (radius 5/10 px, label NavItem 11/14 SemiBold, padding tooltip 5/8, garis lingkaran stepper 1,5 px). Bayangan tooltip di FigCraft diikat ke token `shadow/color`, sama dengan kode. Pilihan Segmented memakai garis dalam (`inset` shadow) supaya tidak menggeser tata letak | Nilai ada di desain; skala token tidak diperluas untuk satu pemakaian |
| 2026-11-14 | Tahap 7: layar yang belum digambar disusun dari komponen yang ada: dialog Panduan (langkah dua tahap + panel Paling cocok/Masih terbatas dari layar Studio), menu akun di avatar rel (chip akun, Pengaturan, pilihan tema), halaman Pengaturan sementara (tema saja), 404 dan error rute (Empty state) | Persetujuan desain 2026-11-13; Pengaturan lengkap di Tahap 11 |
| 2026-11-14 | Tahap 7: label tema "Sistem" (FigCraft Theme toggle). Kepala Langkah progres tanpa chevron (desain tanpa chevron; kepala tetap tombol `aria-expanded`). Chip akun menampilkan "Login lewat Claude Code" sampai data akun tersedia di Tahap 11 (desain: "Paket Max · masuk"). Teks pemakaian tier Ringan dan Maksimal ditulis agent (desain hanya memuat teks Sedang) | Sama dengan desain bila ada; teks baru dicatat |
| 2026-11-14 | Tahap 7: fokus awal Dialog jatuh ke kontrol pertama di isi, bukan ke tombol tutup di kepala (FigCraft #2837); tanpa kontrol lain, fokus ke wadah dialog. Field punya prop `disabled` yang memudarkan label dan teks bantuan (FigCraft: seluruh field 45%) | Tooltip tombol tutup tidak langsung muncul saat dialog dibuka |
| 2026-11-14 | Tahap 7: `ServerStatus` (placeholder Tahap 0) dihapus dari shell; status runtime dan akun tampil di Tahap 11. Galeri `/_komponen` (mode dev/tes) memuat semua komponen untuk axe dan screenshot. E2E menyimpan screenshot bila `SCREENSHOT_DIR` diisi; axe menunggu animasi berhingga selesai | Desain shell tidak punya indikator server. Axe yang berjalan saat toast masih fade-in menilai warna setengah transparan (kegagalan tidak stabil) |
| 2026-11-14 | Tahap 7: pemetaan status aset → nada Badge dibuat bersama daftar Gudang (Tahap 10); teks status sudah ada di `web/i18n/id.ts` | Status aset nyata baru dipakai di Gudang dan Studio |
| 2026-11-14 | Tahap 7 (pembersihan): import dan field privat yang tidak dipakai di `server/services/assets.ts` (sisa Tahap 6) dihapus; peringatan Biome menjadi 0 | AGENTS §4: tanpa kode mati |
| 2026-11-14 | Tahap 7: isi `<meter>` memakai `bg-none` pada pseudo-elemen. Tes E2E membandingkan warna piksel isi meter dengan token nada | Gradien hijau bawaan Chromium (`background-image`) menutupi warna token; tidak tertangkap axe maupun tes komponen |
| 2026-11-14 | Tahap 7 (tinjauan independen): cincin fokus hanya dari satu aturan global `:focus-visible` (`globals.css`); komponen hanya mengubah jaraknya. `outline-none` tidak dipakai pada elemen interaktif. Toast sonner (`<li tabindex=0>`) diberi cincin lewat CSS di luar layer dengan selektor lebih spesifik. E2E menekan Tab di galeri, Studio, Gudang, dan Pengaturan, lalu memeriksa gaya terhitung dan piksel cincin di setiap pemberhentian | Di Tailwind 4 `outline-none` mengisi `--tw-outline-style: none`, sehingga `focus-visible:outline-2` tidak menggambar apa pun: cincin fokus tidak terlihat di hampir semua kontrol (WCAG 2.4.7). Axe dan tes kelas tidak menangkapnya |
| 2026-11-14 | Tahap 7: tooltip terbuka saat fokus hanya bila interaksi terakhir dari keyboard; `TooltipProvider` mencatat `keydown`/`pointerdown`. Tooltip tidak lagi menjadi `aria-describedby` pemicu; pintasan diumumkan lewat `aria-keyshortcuts` | Chromium menganggap fokus skrip Radix (menu dibuka dengan mouse, fokus kembali ke pemicu) `:focus-visible`, sehingga tooltip "Akun" tetap terbuka setelah memilih tema dengan mouse. Tooltip mengulang nama tombol, jadi sebagai deskripsi dibaca dua kali |
| 2026-11-14 | Tahap 7: kartu toast tanpa `role` status/alert; pengumuman lewat wilayah sonner (`aria-live="polite"`), termasuk toast gagal | Live region bersarang bisa diumumkan dua kali. Bila kelak error perlu `assertive`, pakai wilayah alert tersendiri yang selalu ada |
| 2026-11-14 | Tahap 7: fokus awal Dialog menyaring kandidat (`hidden`, `inert`, nonaktif, `input[type=hidden]`), mencoba satu per satu sampai fokus benar-benar pindah, lalu jatuh ke wadah. Wadah diambil dari event Radix, bukan dari ref internal | Kontrol tersembunyi pertama (mis. input file) membuat fokus tertinggal di luar dialog; `ref` dari pemanggil menimpa ref internal |
| 2026-11-14 | Tahap 7: ProgressSteps mengikuti status keseluruhan setelah dirender. Pilihan buka/tutup pengguna hanya berlaku selama status sama. Langkah `pending` dianggap masih berjalan, jadi Tahap 9 harus menandai langkah dari proses yang dihentikan | Status hanya dibaca saat mount: daftar tidak menutup saat selesai dan tidak membuka saat proses baru |
| 2026-11-14 | Tahap 7: Button `loading` menahan klik, `pointerdown`, dan Enter/Spasi/panah di fase capture | Dengan `asChild` (mis. `<Link>`) handler anak tetap berjalan, dan pemicu menu Radix yang membungkus tombol tetap terbuka |
| 2026-11-14 | Tahap 7: `shared/format.ts`: NaN/tak hingga → "—" (`UNKNOWN_VALUE`); ukuran dan durasi negatif → 0; angka ringkas dibulatkan sebelum memilih satuan (999,6 → "1k"). Ringkasan tier memakai `bakeSizes()` (atlas bawaan 512, bukan 0) | Data rusak tidak boleh tampil sebagai "NaN hari lalu" atau "tekstur 0" |
| 2026-11-14 | Tahap 7 (aksesibilitas kecil): tautan "Lewati ke konten" memakai `not-focus-visible:sr-only`, jadi tampil sebagai Button sm utuh saat fokus. Grup tema di menu akun bernama "Tema" (`aria-labelledby`) | `not-sr-only` mengembalikan padding 0 dan teks bisa terlipat; grup radio tanpa nama membuat "Sistem" ambigu |
| 2026-11-14 | Tahap 7 (tes): assertion kelas varian Tailwind (`data-[state=checked]:…`, `aria-invalid:…`, `hover:…`, `disabled:…`) diganti pemeriksaan gaya terhitung di E2E terhadap token. Unit test memeriksa status semantiknya. Bar tier memakai `data-state` (sumber gaya sekaligus pegangan tes). Store tema dibuat baru di setiap tes rute. Tooltip E2E memakai jam palsu Playwright, bukan sleep. Galeri membentuk angka lewat formatter dan teks lewat `tSmoke`. Export yang tidak dipakai dihapus | Kelas yang ada di DOM tidak membuktikan gayanya tergambar, seperti terbukti pada cincin fokus |
| 2026-11-14 | Tahap 7 ditutup dengan tinjauan agent (delegasi pemilik); Tahap 8 dimulai | Laporan `docs/progress/tahap-07.md` |
| 2026-11-14 | Tahap 8: toolbar viewer mengikuti FigCraft yang diperbarui di tahap ini (#1152). Isinya segmen 4 mode (Tekstur, Clay, UV, Normal), Wireframe `W` sebagai lapisan di atas mode apa pun, Grid `G`, cahaya ikut kamera `L`, putar otomatis `R` (ikon saja), menu Sudut, Fokus `F`, Ambil gambar, dan Layar penuh. Toolbar berupa `fieldset` berlabel. Gizmo sumbu berupa tombol DOM di Radix Toolbar: satu pemberhentian Tab, panah untuk berpindah | PLAN menyebut Wireframe sebagai mode; sebagai lapisan ia bisa dipadukan dengan Clay/UV/Normal. `GizmoViewport` drei tidak bisa dipakai dengan keyboard. Biome meminta `fieldset` untuk `role=group` |
| 2026-11-14 | Tahap 8: setelan bawaan per tahap: bentuk dasar = Clay + wireframe, aset final = Tekstur. Mode yang tidak didukung model dinonaktifkan (Tekstur tanpa material, UV tanpa koordinat UV), dan pilihannya jatuh ke Clay. Bentuk dasar diekspor tanpa UV (`export_texcoords` mengikuti material), jadi UV selalu nonaktif di review bentuk dasar. Layar 02 di FigCraft diubah ke UV nonaktif dan catatan perilaku viewer ditambah; PNG `02-studio-review-bentuk-dasar` dan `00-components` diekspor ulang | Pola kotak UV tanpa UV tidak berarti. Desain menggambar UV aktif di state yang tidak mungkin terjadi |
| 2026-11-14 | Tahap 8: sudut 3/4 = arah (0,9; 0,62; 1,2) seperti prototipe. Sudut cepat dan transisi memakai `CameraControls` (polar 0..π). Sel grid lantai mengikuti ukuran model dengan deret 1-2-5, berlabel `formatLength` ("Grid 20 cm"). Lampu bawah menyala saat kamera di bawah lantai (rumus prototipe) | Perilaku `design/prototype/viewer-360.html` |
| 2026-11-14 | Tahap 8: konstanta adegan (lampu, lingkungan, material clay) dipindah ke `shared/scene.ts` dan dipakai bersama renderer (Tahap 2) dan viewer; golden render tidak berubah. Lingkungan memakai `RoomEnvironment` three sebagai PMREM, bukan file HDRI. Tone mapping `NeutralToneMapping`. Bayangan VSM dengan opasitas per tema; shadow map hanya diperbarui saat model, lampu, atau tema berubah | Contact sheet yang dilihat Claude dan viewer pemilik konsisten. Tanpa CDN (AGENTS §9). Tanpa render ulang shadow map di setiap frame |
| 2026-11-14 | Tahap 8: panel Detail tidak menutupi model. Pusat proyeksi digeser lewat `setViewOffset` sesuai lebar panel, sehingga model berada di tengah area bebas. Kamera dibuat `manual`, jadi aspect diatur sendiri: `setViewOffset` mengatur aspect, `clearViewOffset` tidak | Desain layar 02; panel bisa ditutup dan dibuka |
| 2026-11-14 | Tahap 8: putar otomatis mati secara bawaan (±20 dtk per putaran, berhenti saat diseret). Bila sistem meminta animasi dikurangi, tombolnya tetap bisa difokus tetapi `aria-disabled`, dengan alasan di nama dan tooltip; transisi kamera menjadi langsung | AGENTS §2 (`prefers-reduced-motion`). Tombol yang hilang atau `disabled` tidak menjelaskan alasannya |
| 2026-11-14 | Tahap 8: Layar penuh memakai Fullscreen API dokumen. Bila API tidak ada atau ditolak, viewer memenuhi jendela lewat CSS; Escape keluar dari keduanya. Kanvas bisa difokus (`role=application`) dengan orbit panah dan zoom +/−; satu `biome-ignore` (`noNoninteractiveTabindex`) beralasan di kode | Safari iPhone dan happy-dom tidak punya `requestFullscreen`. Zoom tidak punya tombol lain |
| 2026-11-14 | Tahap 8: konteks WebGL hilang → pesan + tombol muat ulang (kanvas dipasang ulang). Event dari kanvas yang sudah dilepas diabaikan; `forceContextLoss` dijadikan no-op setelah konteks hilang | three memanggil `forceContextLoss` saat dispose, dan pada konteks yang sudah hilang memunculkan warning konsol |
| 2026-11-14 | Tahap 8: objek hasil render (GLTF di cache `useGLTF`, material mode, material grid) dibuang lewat penghitung pemakai `web/features/viewer/lifetime.ts`; pembuangan ditunda ke microtask dan batal bila dipakai lagi. Cache `useGLTF` hanya dikosongkan bila masih berisi objek yang dibuang | R3F 9 meneruskan StrictMode ke pohon kanvas; cleanup lalu efek ulang berjalan sinkron. Membuang objek di cleanup membuat model hilang dan memicu loop muat ulang di build E2E (React dev) |
| 2026-11-14 | Tahap 8: cincin fokus kanvas tergambar di atas WebGL: wadah `isolate` + kanvas `-z-1`. Tombol di sisi kanan panel Detail memakai tooltip di bawah | Kanvas menutupi outline induknya. Bayangan tooltip samping menggelapkan sisi cincin fokus di tema gelap (E2E `focusRingProblems`) |
| 2026-11-14 | Tahap 8: pemicu Radix di dalam `Tooltip` mempertahankan `data-state` miliknya; `TriggerSlot` di `tooltip.tsx` membuang `data-state` tooltip. Pemicu menu Sudut tampil terbuka (`bg/hover`, `text/primary`) seperti desain | Pemicu menu menyebarkan prop yang diterimanya setelah `data-state` miliknya, jadi state tooltip (`closed`) menimpa `open`. Ditemukan lewat pembanding desain; tes komponen dan E2E gaya terhitung ditambahkan |
| 2026-11-14 | Tahap 8: ikon Sudut memakai geometri `Icon/axis-3d` FigCraft (siku + satu diagonal utuh) lewat `createLucideIcon` di `web/features/viewer/icons.ts` | lucide-react 1.72 menggambar diagonal `axis-3d` putus-putus dengan siku membulat; desain memakai bentuk lama |
| 2026-11-14 | Tahap 8: lebar segmen dan tombol berteks mengikuti lebar teks Chromium. FigCraft membulatkan lebar kotak teks ke atas, sehingga toolbar 574 px vs 577 px di desain dan tombol di kanannya bergeser 2–3 px. Tidak ditambal dengan lebar tetap | AGENTS §13 (toleransi rasterisasi teks); lebar tetap per label akan meniru artefak pengukuran, bukan maksud desain (padding) |
| 2026-11-14 | Tahap 8: teks budget (segitiga, ukuran, vertex, material, dimensi) dipindah ke `t.budget` dan dipakai panel Detail. Ditambah `useMediaQuery`/`useReducedMotion` (`web/lib/use-media-query.ts`) dan helper unduhan (`web/lib/download.ts`) | Teks yang sama akan dipakai Studio dan Gudang (Tahap 9–10) |
| 2026-11-14 | Tahap 8: halaman uji `/_viewer` (mode dev/tes) memuat fixture GLB Tahap 4 (`peti`, `makhluk`, bentuk dasar dan final) serta `rusak` untuk state error; angka panel sama dengan desain. Golden viewer 7 sudut × 2 tema disimpan ×0,5 di `tests/goldens/viewer/`, dibuat per sudut dengan animasi dikurangi; `compareGolden` menerima suite golden | Golden penuh 2× melewati batas waktu tes dan memperbesar repo; per sudut menghindari batas 30 dtk |
| 2026-11-14 | Tahap 8: `pngjs` dihapus dari dependensi langsung (usulan Tahap 2); tetap terpasang sebagai dependensi pixelmatch | PNG golden di-decode dengan sharp |
| 2026-11-14 | Tahap 8: FPS diukur lewat skrip, bukan manual: Chromium headless memakai GPU mesin ini (Radeon 780M, ANGLE GL-EGL). Saat putar otomatis hasilnya 60 fps di DPR 1 dan 2, untuk bentuk dasar maupun aset final | Pemilik sedang tidak di depan mesin (delegasi); SwiftShader di E2E tidak mewakili GPU |
| 2026-11-14 | Tahap 8, hasil tinjauan independen (subagent, 3 temuan sedang + 9 ringan): pintasan huruf R/F/W/G/L hanya berlaku saat fokus di dalam viewer (handler di `section` viewer, bukan `window`); klik kanvas memfokusnya. Escape tetap global selama layar penuh | WCAG 2.1.4: pintasan satu huruf harus bisa dimatikan, diubah, atau hanya aktif saat komponennya difokus. Opsi ketiga tidak butuh pengaturan baru dan tidak mengganggu mengetik di kolom pesan Studio |
| 2026-11-14 | Tahap 8 (tinjauan): fokus tidak jatuh ke `<body>` saat kontrol yang difokus dilepas. Tutup/buka panel Detail → tombol pasangannya; Muat ulang / Coba lagi → kanvas; konteks hilang atau GLB gagal saat kanvas difokus → tombol di pesan. Fokus hanya dipindah bila memang ada di elemen yang dilepas | WCAG 2.4.3. Klik di Safari tidak memfokus tombol, jadi fokus di tempat lain tidak ditarik |
| 2026-11-14 | Tahap 8 (tinjauan): status memuat, error, konteks hilang, dan WebGL tidak tersedia diumumkan lewat `LiveStatus` (`web/components/LiveStatus.tsx`), live region yang selalu terpasang dan diisi setelah commit pertama; teks memuat yang tampil tidak lagi `role=status`. Muat ulang dan coba lagi mengosongkan state siap, jadi state memuat tampil lagi | Region yang disisipkan bersama teksnya sering dilewatkan pembaca layar. Tanpa reset, viewport kosong tanpa keterangan dan "Ambil gambar" gagal selama GLB dimuat ulang |
| 2026-11-14 | Tahap 8 (tinjauan): tahap yang berganti tanpa viewer dipasang ulang (aset final datang, membuka versi bentuk dasar) mengembalikan mode dan wireframe ke bawaan tahap baru; grid, cahaya, dan putar otomatis tetap pilihan pemilik | `stage` sebelumnya hanya dibaca saat dipasang, sehingga aset final tampil tanpa tekstur |
| 2026-11-14 | Tahap 8 (tinjauan): layar penuh CSS dibuat modal: sisa halaman `inert` (`web/lib/inert.ts`, kecuali live region toast) dan layar penuh dokumen ditutup saat viewer dilepas | Tab dan Shift+Tab sebelumnya masuk ke rel yang tertutup viewer (WCAG 2.4.11) |
| 2026-11-14 | Tahap 8 (tinjauan): keyboard kanvas mengabaikan kombinasi Ctrl/Alt/Meta (zoom halaman dan "kembali" milik browser). Shift + panah menggeser 10% jarak kamera per tekan, setara Shift + seret. Logikanya fungsi murni `viewportKeyAction` | Ctrl + minus sebelumnya ditangkap sebagai zoom model. Geser sebelumnya hanya bisa dengan mouse (AGENTS §2). Klik ganda ke titik permukaan tetap tanpa padanan keyboard; padanannya Shift + panah lalu `+` |
| 2026-11-14 | Tahap 8 (tinjauan): putar otomatis searah prototipe (azimuth berkurang, seperti `OrbitControls.autoRotate`) | Arah sebelumnya terbalik dari prototipe |
| 2026-11-14 | Tahap 8 (tinjauan): bulatan negatif gizmo opasitas penuh (dulu 0,6); saat hover terisi warna sumbu. Diubah dulu di FigCraft (komponen #2464 + deskripsinya, catatan perilaku #2712), lalu `00-components` dan `02-studio-review-bentuk-dasar` diekspor ulang | Pada opasitas 0,6 kontras garisnya hanya 2,1–3,7:1 (WCAG 1.4.11 minta 3:1). Pada opasitas penuh: gelap 5,4/8,1/5,5, terang 3,6/3,7/4,2 |
| 2026-11-14 | Tahap 8 (tinjauan), perbaikan kode Tahap 2: halaman render membuang garis wireframe dan material Clay setiap render. `Renderer.gpuMemory()` (diagnosis, dipakai tes pipeline) membaca jumlah geometri dan tekstur di GPU halaman render | Halaman dipakai ulang antar-render; setiap render wireframe menimbun 1 geometri per mesh |
| 2026-11-14 | Tahap 8 (tinjauan): URL blob unduhan ("Ambil gambar") dibebaskan setelah 40 dtk, tidak langsung | Firefox dan Safari masih membaca URL beberapa saat setelah klik; jeda yang sama dengan FileSaver.js |
| 2026-11-14 | Tahap 8 (tinjauan): ganti versi tetap memasang ulang kanvas WebGL dan kamera kembali ke 3/4 → **Tahap 9** | Membandingkan v1 dan v2 dari sudut yang sama baru dibutuhkan di review Studio. Perbaikannya (batas error di dalam kanvas, kamera dipertahankan antar-versi) menyentuh struktur viewer, jadi dikerjakan bersama alur versinya |
| 2026-11-14 | Tahap 8 ditutup dan disetujui lewat tinjauan agent (delegasi pemilik): semua DoD terpenuhi, temuan tinjauan diperbaiki kecuali satu yang dipindah ke Tahap 9. Laporan `docs/progress/tahap-08.md`. Tahap aktif → Tahap 9 | Delegasi pemilik 2026-11-14: "lanjut aja setiap tahap sampai selesai, anda review, anda jawab, anda revisi sendiri" |
| 2026-11-14 | Tahap 9: sesi aset di rute `/studio/:assetId`, anak layout yang sama dengan Studio baru. Rel menandai Studio aktif di `/` dan `/studio/*` (layar 02), dengan `aria-current="page"` seperti NavLink untuk halaman turunan | Sesi bisa dibuka ulang lewat URL dan tombol kembali browser. Item rel mengikuti bagian app, bukan hanya alamat persis; desain 02 menampilkan Studio aktif di halaman sesi |
| 2026-11-14 | Tahap 9: topbar sesi mengikuti layar 02 (Tier `ml-3`, Badge `ml-2` = jarak desain 18/14 px). "Unduh" di topbar mengunduh `web.glb` versi yang **sedang dilihat** (nama `<nama-aset>-vN.glb`, tooltip), dan disembunyikan bila belum ada versi. Kartu Selesai di dock mengunduh versi **terkini**. Menu "…" (aksi aset: ekspor, duplikat, hapus) dipindah ke **Tahap 10** | Setelah membandingkan versi, yang diunduh adalah yang dilihat. Isi menu "…" bergantung pada fitur Tahap 10 dan belum dirancang |
| 2026-11-14 | Tahap 9: kartu "Terakhir dibuat" di Studio baru menampilkan waktu relatif (diperbarui tiap menit), bukan persen progres. Thumbnail menyusul di **Tahap 10** (turntable) | Daftar aset tidak punya persen progres per aset; persen palsu menyesatkan |
| 2026-11-14 | Tahap 9: panel Detail sesi. Meter budget seperti layar 02 (segitiga / target, ukuran web.glb / maks). Dimensi lebar × kedalaman × tinggi. Baris validasi dan Optimasi hanya bila versi itu punya datanya (versi Tahap 3 tidak punya). **Optimasi hanya untuk aset final** | Layar 02 (review bentuk dasar) tidak memuat Optimasi, dan PLAN menaruh laporan optimasi di review final. Komponen F #4112 hanya contoh netral, tanpa batas tahap |
| 2026-11-14 | Tahap 9: badge status dari `assetBadge` (`web/lib/asset-status.ts`): gagal → danger; Claude bekerja/menunggu → "Membuat…" accent; review → warning; selesai → success; selain itu nama tahap (netral) | Satu pemetaan untuk topbar sesi, kartu Studio, dan Gudang |
| 2026-11-14 | Tahap 9: viewer sesi mengikuti `currentVersion`. Pilihan versi pemilik di panel bertahan sampai versi terkini berubah, lalu viewer pindah ke versi baru | Build baru harus langsung terlihat, tetapi perbandingan versi lama tidak boleh tertimpa render ulang |
| 2026-11-14 | Tahap 9 (dari tinjauan Tahap 8): ganti versi tidak memasang ulang kanvas WebGL. Hanya adegan di dalam `<Canvas>` yang diganti (`key={src}`), dan sudut kamera dibawa lewat `CarriedView`. Test hook melapor `ready` hanya untuk file yang sedang diminta (`requestedSrc`) | Membandingkan v1 dan v2 dari sudut yang sama. Tanpa `requestedSrc`, E2E membaca adegan lama yang masih tampil selama GLB baru dimuat |
| 2026-11-14 | Tahap 9: `SessionViewerContext` sebagai celah tes. Tes halaman sesi memakai `FakeViewer`, bukan viewer lazy | happy-dom tidak pernah mencoba ulang komponen lazy yang suspend di luar `act` |
| 2026-11-14 | Tahap 9: composer. Tombol kamera hanya ada bila sebuah versi tampil; tangkapan gagal → toast. Composer nonaktif saat `waiting_user` (kartu dijawab dulu). `maxLength` dari `shared/limits.ts`, tanpa autofocus. Overlay petunjuk saat file diseret. Studio baru: klip (`ACCEPT_ALL`) + gambar (`ACCEPT_IMAGES`). react-dropzone `noPaste: true` (tempel ditangani composer) | Dropzone 20 menangani paste di root, sehingga tempel Ctrl+V menambah lampiran dua kali. Jawaban pertanyaan lewat kartu, bukan teks bebas, supaya Claude menerima jawaban terstruktur |
| 2026-11-14 | Tahap 9: kegagalan menjawab pertanyaan, aksi dock (setujui, selesai, Stop, ubah bentuk), dan kirim pesan → toast error berbahasa Indonesia dari `code` server | Aksi yang gagal tidak boleh diam; pesan sesuai §5 AGENTS |
| 2026-11-14 | Tahap 9: dialog "Ubah bentuk" membuka revisi dari `approvedBaseVersion ?? currentVersion` | Ubah bentuk dari review final kembali ke bentuk dasar yang disetujui (Lampiran C) |
| 2026-11-14 | Tahap 9: input file tersembunyi diberi label (axe). `mockFetch(path, request)` di `web/test-utils.tsx` meneruskan `Request` untuk memeriksa body (FormData). `InfoBlock` jadi komponen bersama; `assetsKey` disatukan di `web/lib/assets.ts` | Satu sumber key query; tes bisa memeriksa isi unggahan |
| 2026-11-14 | Tahap 9: thread. Ukuran brief "· origin di dasar"; Kategori = kategori · gaya; gelembung pemilik `max-w-74`; legend kartu pertanyaan `mb-2.5`; pesan menempel ke bawah (`mt-auto`) bila sedikit; event `user` ber-`origin` (pesan dari aksi dock) disembunyikan karena aksinya sudah tampil sebagai baris aksi | Ukuran diambil dari FigCraft (#3722); pesan sistem tidak tampil dua kali |
| 2026-11-14 | Tahap 9: dock. Kartu menunggu memakai ikon `circle-help`. State `none` (tanpa kartu) saat idle tanpa versi, gagal, atau dihentikan; thread sudah menampilkan sebabnya | Kartu kosong tanpa aksi hanya menambah gangguan |
| 2026-11-14 | Tahap 9: toast "siap direview/selesai" hanya untuk aset **lain** (aset yang dibuka sudah punya kartu dock), tanpa tombol "Buka". Halaman sesi punya h1 `sr-only` (nama aset) | Desain toast Tahap 7 tanpa tombol aksi. h1 untuk navigasi pembaca layar; judul visual ada di breadcrumb |
| 2026-11-14 | Tahap 9: info tier di composer memakai `DEFAULT_TIERS`; budget dari Pengaturan menyusul di Tahap 11 | Pengaturan budget belum ada; aset tetap memakai `tierSnapshot` dari server |
| 2026-11-14 | Tahap 9: penyimak global (`AssetWatcher`, komponen tanpa tampilan). Topik `global` menginvalidasi daftar dan detail aset yang berubah, dan daftar diambil ulang saat sambungan pulih. `useStudioBusy` (`select` + `placeholderData`) untuk titik proses di rel | Kerangka app tidak ikut render ulang setiap kali daftar aset berubah (sebelumnya memicu peringatan act tooltip di tes rute) |
| 2026-11-14 | Tahap 9: nama langkah pipeline di `shared/build-steps.ts` (`PIPELINE_STEPS`), dipakai server dan web. Fase kartu build dihitung dari jam klien; urutan: skrip → optimasi → render; baris build gagal dan dihentikan; label langkah Optimasi berbahasa Indonesia | Satu sumber nama langkah; progres tetap berjalan tanpa event per detik |
| 2026-11-14 | Tahap 9: chip contoh di Studio baru mengisi prompt lengkap (bukan hanya judul) | Contoh bisa langsung dikirim, dan menunjukkan prompt yang baik |
| 2026-11-14 | Tahap 9: "Minta revisi" memfokuskan composer; tangkapan viewport diberi nama `tampilan-vN.png` dengan meta "PNG · mode · ukuran" | Alur revisi tanpa mouse; nama file menjelaskan isinya |
| 2026-11-14 | Tahap 9: banner sambung ulang di bawah topbar selebar konten, tampil hanya saat `reconnecting`. `ReconnectNotice` (tampilan) dipisah dari `ReconnectBanner` (kapan tampil) supaya bisa ditampilkan di galeri. Viewport kosong memakai EmptyState sebelum build pertama | Komponen #4133 dari FigCraft; galeri `/_komponen` memuat semua state |
| 2026-11-14 | Tahap 9: dependensi baru **rehype-harden 1.1.9** (`bun add --exact`, TECH_STACK). Markdown dari Claude: tautan apa pun boleh, tetapi protokol berbahaya diblok; gambar jarak jauh dan `data:` diblok dengan kebijakan `text-only` | Bawaan streamdown mengizinkan gambar dari mana saja (bisa memuat dari jaringan) dan menampilkan "[blocked]" berbahasa Inggris dengan warna mentah |
| 2026-11-14 | Tahap 9: kartu pertanyaan. Radio "Lainnya" dinamai lewat `aria-labelledby`; baris opsi `<label htmlFor>` ke kontrolnya. Item thread dirender lewat komponen `ThreadEntry`. Thread gagal dimuat → tombol "Coba lagi" (`ThreadStore.retry`) | Nama aksesibel yang benar dan aturan Biome (`noLabelWithoutControl`, `useIterableCallbackReturn`); state error wajib punya jalan keluar (§8) |
| 2026-11-14 | Tahap 9: galeri `/_komponen` memuat bagian Studio (FigCraft #3722): kartu pertanyaan, kartu dock, revisi, blok thread, panel Detail, banner. Contoh panel Detail dipindah ke `web/features/smoke/sample-detail.ts`. Kunci i18n tak terpakai dihapus (`session.open`, `composer.tooLong`) | Komponen dasar baru wajib ada di galeri untuk axe dan screenshot (§8) |
| 2026-11-14 | Tahap 9: E2E. `scripts/e2e-data.ts` menyiapkan folder data server Playwright (izin tulis folder versi read-only dikembalikan, lalu dihapus) dan memasang pustaka material uji. `studio.e2e.ts` berjalan berurutan (`mode: "default"`) di skala 2. Tes sambung ulang memakai `routeWebSocket` dan event `online`. Helper `focusedRing` membaca cincin dari `<article>` bila elemen fokus tidak menggambar outline sendiri. Tautan Gudang di smoke test dicari di navigasi utama | Tanpa pustaka, tahap tekstur skenario palsu gagal `LIBRARY_MISSING`; `rm -rf` gagal pada folder versi 0555. Tes paralel saling memunculkan toast di screenshot |
| 2026-11-14 | Tahap 9: driver palsu menunggu `InputQueue.drained()` setelah mengirim tool_use, sebelum hook, izin, atau tool dijalankan | CLI asli mengirim pesan assistant jauh sebelum `can_use_tool`. Tanpa penantian, kartu pertanyaan tercatat sebelum thinking dan teks yang mendahuluinya, sehingga urutan thread di mode palsu salah |
| 2026-11-14 | Tahap 9: rute sesi `/studio/:assetId` dimuat lazy (chunk `StudioSessionPage` 540 kB). Chunk utama 710 kB, viewer tetap chunk lazy sendiri | Thread memakai streamdown (parser markdown + HTML, parse5), yang tidak dibutuhkan halaman lain. Tanpa pemisahan, chunk utama 1.249 kB dan build memunculkan peringatan ukuran chunk (batas 1.200 kB); menaikkan batas hanya menyembunyikan masalah |
| 2026-11-14 | Tahap 9: tier di topbar sesi berwarna `text/tertiary` (layar 02: `icon/color` dengan mode tersier), bukan mewarisi `text/primary` | Ditemukan saat membandingkan screenshot dengan desain 02 |
| 2026-11-14 | Tahap 9 → **Tahap 10**: thumbnail versi (baris versi di panel Detail, kartu "Terakhir dibuat") dan menu "…" di topbar sesi dipindah ke checklist Tahap 10. Sampai saat itu baris versi menampilkan kotak `bg/viewport` kosong; di tema terang kotak itu hampir tak terlihat di baris terpilih (`bg/viewport` #e6e6e9 vs `bg/active` #e7e7ea) | Versi belum menyimpan gambar pratinjau. Render turntable Tahap 10 menghasilkan gambar itu di `derived/`, jadi dibuat sekali di sana. Koreksi atas laporan Tahap 8, yang menyebut Studio Tahap 9 sudah memakai thumbnail asli |
| 2026-11-14 | Tahap 9, tinjauan agent (15 temuan, semua diperbaiki). **Temuan 1:** pesan selalu butuh teks, juga di composer dock; lampiran tanpa teks tidak bisa dikirim (tombol Kirim nonaktif). Prop `requireText` dihapus | Server menolak pesan kosong (`EMPTY_MESSAGE`), dan blok teks kosong kemungkinan ditolak API Claude. Tombol yang selalu berujung error menyesatkan |
| 2026-11-14 | Tahap 9, temuan 2: **viewer sempit**. Panel Detail (atau tombol bukanya) turun 12 px di bawah toolbar bila tidak muat di sampingnya (diukur `ResizeObserver`); tinggi panel berhenti sebelum gizmo. Toolbar membungkus ke baris kedua (`flex-wrap`, lebar maks viewer − 32). Petunjuk kontrol berhenti sebelum kolom gizmo. Di 1440 px tetap sama dengan layar 02. Di FigCraft: layar baru "02 Studio · review bentuk dasar · 1024 px", komponen "Toolbar viewport" diberi wrap (instance satu baris tidak berubah), aturan di "Catatan perilaku viewer"; render latar `design/tools/render/jobs-1024.json`. E2E 1440/1280/1024 memeriksa kotak tidak bertumpuk dan axe | Di 1280 px panel menutupi ujung toolbar (fokus tombol tersembunyi, WCAG 2.4.11). Di 1024 px toolbar terpotong dan petunjuk menabrak gizmo. PLAN Tahap 7: nyaman di 1280, tetap layak di 1024. Menurunkan panel menjaga susunan desain tanpa menutup kontrol; menutup panel otomatis menyembunyikan informasi yang dibutuhkan saat review |
| 2026-11-14 | Tahap 9, temuan 3 dan 15: pesan composer dan aksi lain memakai mutation terpisah, dipanggil lewat `mutateAsync` dengan penanganan per panggilan. Respons HTTP aksi hanya menulis cache detail bila belum ada event `state` WebSocket sejak aksi dimulai (penghitung revisi per aset) | `mutate()` TanStack 5 mengganti callback panggilan sebelumnya: pesan yang tertahan lalu Stop membuat draft tidak dikosongkan dan errornya diam. Respons yang tiba setelah event lebih baru memundurkan dock |
| 2026-11-14 | Tahap 9, temuan 4 dan 9: "Muat pesan sebelumnya" menjaga posisi baca dengan menambatkan pesan teratas yang terlihat sampai halaman lama selesai dimuat. `ThreadStore` memberi nomor jendela; resync membatalkan pemuatan halaman lama yang masih berjalan | Sebelumnya pemilik terlempar ke awal halaman lama. Halaman lama yang tiba setelah resync menyisakan celah seq di thread |
| 2026-11-14 | Tahap 9, temuan 5: saat mengirim, isian composer hanya-baca (bukan nonaktif); klik Kirim memindah fokus ke isian | Isian yang dinonaktifkan saat fokus menjatuhkan fokus keyboard ke `<body>` |
| 2026-11-14 | Tahap 9, temuan 6: live region (`LiveStatus`) mengumumkan judul kartu dock dan potongan balasan Claude yang baru (maks. `ANNOUNCE_EXCERPT_CHARS` = 280 code point, `shared/limits.ts`). Riwayat saat halaman dibuka dan delta stream tidak diumumkan | WCAG 4.1.3: pembaca layar tidak mendengar balasan, pertanyaan baru, atau "siap direview". Isi lengkap tetap dibaca di thread |
| 2026-11-14 | Tahap 9, temuan 7: panah ke "Lainnya" di kartu pertanyaan hanya memilihnya; fokus pindah ke isiannya hanya lewat klik atau Spasi | WCAG 3.2.2: navigasi panah tidak boleh memindah konteks |
| 2026-11-14 | Tahap 9, temuan 8: status kartu pertanyaan hanya dari event `question_resolved` (dijawab atau dibatalkan). Tanpa resolusi dan tidak sedang ditunggu, pilihannya terkunci | Respons jawaban bisa tiba sebelum event resolusi, sehingga kartu sempat tampil "dibatalkan" |
| 2026-11-14 | Tahap 9, temuan 10 dan 11: refetch detail yang gagal → toast "Data aset gagal diperbarui", data lama tetap tampil (halaman error hanya bila belum ada data). Tangkapan viewport gagal → toast dan log | Halaman error melepas sesi, sehingga draft composer dan sudut viewer hilang. Kegagalan tidak boleh diam (§4) |
| 2026-11-14 | Tahap 9, temuan 12: banner sambung ulang di dalam live region yang selalu terpasang (`ConnectionStatusRegion`: `role="status"`, "Status sambungan"; galeri `/_komponen` memakai wadah yang sama); saat banner hilang, fokus di tombolnya pindah ke `<main>`. Klien realtime: batas waktu handshake `HANDSHAKE_MS` 10 dtk, dan "Sambungkan sekarang" membatalkan soket yang masih CONNECTING | Region yang disisipkan bersama isinya sering tidak diumumkan. Handshake yang menggantung sebelumnya membuat tombol tidak berefek tanpa batas waktu |
| 2026-11-14 | Tahap 9, temuan 13: E2E memilih chip lampiran lewat role/nama (daftar "Lampiran yang akan dikirim"; lampiran di thread bernama "Lampiran"). Tes baru: muat ulang saat teks Claude sedang di-stream (aksi skenario `streamText`, penanda `[macet]` sekarang menulis potongan teks sebelum diam), lebar sempit, dan axe di state selesai, saat banner tampil, dan di 1280/1024 | AGENTS §10. Delta hanya dikirim langsung, tidak disimpan: tes memastikan potongan lama tidak diputar ulang atau ganda setelah muat ulang |
| 2026-11-14 | Tahap 9, temuan 14: komentar `web/components/Markdown.tsx` disesuaikan dengan perilaku harden yang sebenarnya (http/https dan path relatif, plus mailto/irc/xmpp/blob/`#`; javascript:, data:, file:, vbscript: diblok), dikunci tes | Komentar lama menyebut hanya http/https/mailto |
| 2026-11-14 | Tahap 9 (catatan C tinjauan, mengoreksi baris dock sebelumnya): setelah versi dikirim untuk review, kartu review/selesai tetap tampil walau giliran gagal atau terputus. State `none` hanya bila belum ada versi, atau status sedang bekerja (`*_WORKING`) tanpa giliran berjalan | Server tetap menerima Setujui/Selesai dalam kombinasi itu (mis. server restart setelah `submit_for_review` sebelum giliran selesai). Menyembunyikan tombolnya membuat pemilik buntu |
| 2026-11-14 | Tahap 9: E2E dibagi dua project Playwright. `chromium` untuk tes UI (paralel); `aset` untuk tes yang membuat aset (`ASSET_TESTS`, sekarang `studio.e2e.ts`), satu worker, baru berjalan setelah `chromium` selesai. Menjalankan tes aset saja memakai `--no-deps` | Run penuh gagal sekali: toast "siap direview" dari aset tes studio di worker lain menutupi gizmo di `/_viewer`. Kartu "Terakhir dibuat" di screenshot Studio baru juga ikut berubah-ubah. Tahap 10 menambah tes Gudang yang menghitung kartu, jadi isolasi ini dibutuhkan |
| 2026-11-14 | Tahap 9: toast status aset punya id per aset (`aset-status:<id>`, `notify` menerima `{ id }` dan punya `notify.dismiss`). Saat sesi aset dibuka, toast aset itu ditutup. Toast baru untuk aset yang sama menggantikan yang lama | Screenshot E2E 1024 px memperlihatkan toast "Peti kayu siap direview" di sesi Peti kayu sendiri: aset baru bisa selesai dibangun (mode palsu) sebelum navigasi ke sesinya selesai. Tes komponen gagal dulu tanpa perbaikan |
| 2026-11-14 | Tahap 9 ditutup dan disetujui lewat tinjauan agent (delegasi pemilik): tes lolos (`check`, E2E penuh, studio 3×, `e2e:api`, build), 15 temuan tinjauan + catatan C diperbaiki. Uji nyata DoD belum dijalankan karena memakai kuota, jadi menunggu izin pemilik. Laporan `docs/progress/tahap-09.md`. Tahap aktif → Tahap 10 | Delegasi pemilik 2026-11-14: "lanjut aja setiap tahap sampai selesai, anda review, anda jawab, anda revisi sendiri" |
| 2026-11-14 | Tahap 10: thumbnail dan turntable per versi. Halaman render memutar model 24 frame (504×378, strip 12.096 px ≤ 16.383) → `derived/vN/turntable.webp` dan `thumb.webp` (frame pertama), WebP berlatar transparan (kualitas 82, alpha 100). Dibuat setelah build (`onVersionCreated`), atau saat pertama diminta untuk versi dari sebelum Tahap 10. Tanpa renderer (`RUNTIME_DRIVER=fixture`) dipakai file `tests/fixtures/turntables/`. Golden baru: `tests/goldens/render/{peti,grid}-turntable-0.png` | Satu render untuk kartu Gudang, baris versi di panel Detail, dan kartu "Terakhir dibuat". Versi write-once, jadi hasil turunan di `derived/` |
| 2026-11-14 | Tahap 10: animasi turntable lewat CSS `background-position` `steps(24, jump-none)`, 2 dtk per putaran. Strip dimuat lewat `<img>` tersembunyi saat kartu disorot atau difokus, dan tidak dimuat sama sekali bila `prefers-reduced-motion`. Chip "360°" tampil setelah strip dimuat (tidak digambar di FigCraft; disusun dari chip yang ada) | Tanpa WebGL per kartu; Gudang tidak mengunduh 24 frame per aset saat dibuka; animasi dikurangi dihormati (§2) |
| 2026-11-14 | Tahap 10: preset ekspor. **Web** = `web.glb` versi apa adanya. **Unity** = GLB dari `base.glb`/`final.glb` tanpa ekstensi kompresi/kuantisasi, tekstur WebP/AVIF → PNG, divalidasi ulang (wajib 0 error). **Sumber** = ZIP satu folder akar `<nama>-vN-sumber/`: README (cara menjalankan ulang lewat `scripts/runtime.ts probe`), `scene.blend`, `script.py` (+ `base.py` aset final), `stats.json`, tekstur PNG. Unity dan Sumber di-cache di `derived/vN/` dan dibuat sekali (permintaan bersamaan menunggu proses yang sama). Estimasi ukuran: Web pasti, Unity/Sumber "≈" sampai file pertama kali dibuat | glTFast tanpa paket tambahan tidak membaca meshopt/WebP. Versi write-once, jadi cache tidak pernah basi |
| 2026-11-14 | Tahap 10: `.blend` disimpan harness setelah ekspor GLB (`assetkit.run --blend`, `assetkit.save_blend` dengan gambar dikemas), menjadi `scene.blend` di folder versi (opsional di allowlist output). `runtime/knowledge/API.md` dan pytest ikut diperbarui. Fixture `.blend` dibuat `bun scripts/runtime.ts blend-fixtures`. Versi aset final dari sebelum Tahap 10 tidak punya `.blend`; README Sumber mencatatnya | Preset Sumber butuh adegan Blender yang sama dengan GLB. Skrip Claude tidak dipercaya menyimpan file; ini tugas harness (§7) |
| 2026-11-14 | Tahap 10: unduh massal `GET /api/assets/export-zip?ids=…&preset=web\|unity` (rencana awal `POST`). ZIP di-stream (fflate `Zip`, file dibaca per potongan dengan backpressure); semua aset dicek sebelum stream dimulai, jadi error tetap berupa JSON; maks. `EXPORT_ZIP_MAX_ASSETS` = 100. Nama entri dari `safeFileStem` (huruf/angka Unicode dan `-`, unik dengan sufiks `-2`); `nosniff` + CSP `sandbox`. Di bar mode pilih berupa tautan `download` biasa | Dengan GET, browser mengunduh langsung dari tautan, tanpa memuat ZIP ke memori JS. Pemisah path dan titik tidak pernah lolos ke nama entri (zip-slip) |
| 2026-11-14 | Tahap 10: dialog ekspor mengunduh lewat `fetch` + Blob, bukan tautan. Setelah berhasil, estimasi versi itu diinvalidasi (ukuran "≈" menjadi pasti saat dibuka lagi) | Error server (mis. Unity gagal validasi) tampil sebagai toast dan dialog tetap terbuka. Bug estimasi basi ditemukan E2E; tes komponen kini memakai `staleTime` yang sama dengan app |
| 2026-11-14 | Tahap 10: cari Gudang di nama, prompt, dan kategori/ringkasan brief (LIKE, `%`/`_`/`\` dicari apa adanya), filter Tier, Tahap (bentuk dasar / aset final / selesai), Tanggal (24 jam / 7 hari / 30 hari; batas dihitung di klien dari jam yang disuntikkan), urut Terbaru / Terlama / Nama A–Z. Daftar membawa `versionCount`. State Gudang di URL (`replace`, tanpa entri riwayat per ketikan) dan dibawa ke Detail aset lewat state navigasi, jadi breadcrumb kembali ke daftar yang sama | Daftar bisa di-refresh dan dibagikan; Kembali tidak melewati puluhan entri |
| 2026-11-14 | Tahap 10: kolom cari Gudang memakai teks lokal. Nilai URL yang berasal dari ketikan sendiri diabaikan saat tiba (navigasi router berjalan sebagai transition, sering setelah beberapa ketikan lagi); perubahan dari luar (Hapus filter, tautan rel) menimpa isi kolom | Bug ditemukan E2E: mengetik cepat menghapus huruf (URL berakhir `?q=i`). Tes komponen gagal dulu (navigasi ditahan lewat loader) |
| 2026-11-14 | Tahap 10: yang tidak digambar di FigCraft disusun dari komponen yang ada: Empty state Gudang ("Belum ada aset" + Aset baru, "Tidak ada hasil" + Hapus filter, gagal dimuat + Coba lagi), letak bar mode pilih (melayang di tengah bawah area konten), keterangan batas ZIP (teks peringatan di bar, ikut diumumkan), state Detail aset (memuat, tidak ditemukan, gagal dimuat, sudah dihapus). Header kolom tampilan daftar `aria-hidden` (baris adalah `article`, bukan tabel) | Paritas desain (§2): penyimpangan dicatat. Mode pilih, daftar, dialog, dan menu "…" mengikuti frame Tahap 10 |
| 2026-11-14 | Tahap 10: aksi aset (menu "…": Lanjutkan di Studio, Ekspor, Ganti nama, Duplikat, Hapus) dipakai bersama oleh Gudang (grid dan daftar), Detail aset, dan topbar sesi Studio (`useAssetActions`; tiap halaman membuang aksi yang sudah menjadi tombol). Hapus: halaman membeku di data terakhir di balik dialog sampai pindah (Detail → Gudang dengan filter terakhir, Studio → Studio baru). Hapus dari Gudang memindah fokus ke aset tetangga, atau ke kolom cari | Tanpa kedipan "tidak ditemukan"; fokus keyboard tidak jatuh ke `<body>` |
| 2026-11-14 | Tahap 10: aset yang dihapus ditandai di cache query (`markAssetDeleted`, dari hapus di tab ini dan dari event `global` `deleted`). Detailnya tidak diambil lagi; halaman Detail dan Studio yang menampilkannya beralih ke "Aset sudah dihapus" | Sebelumnya `AssetWatcher` mengambil ulang detail yang pasti 404, dan Chromium mencatatnya sebagai error console. Ditemukan E2E; tes penyimak dan halaman Detail gagal dulu |
| 2026-11-14 | Tahap 10: Detail aset menampilkan semua lampiran aset (termasuk yang dikirim saat revisi), "Dibuat" sebagai tanggal-jam (`formatDateTime`: "14 Nov 2026, 09.12"), ringkasan brief (`BriefCard`, dipindah ke `web/components`), dan viewer + panel Detail yang sama dengan Studio. Rute `/gudang/:assetId` lazy (viewer dan panel Studio) | Lampiran disimpan per aset, bukan per pesan |
| 2026-11-14 | Tahap 10: komponen dasar baru Dropdown, SearchField, Checkbox, RadioCards, dan Segmented varian `icons` (item bernama lewat `name` + tooltip). Galeri `/_komponen` memuat bagian "Kartu aset · mode pilih" dan "Cari, filter, kotak centang, kartu pilihan"; Empty state galeri memakai teks `t.gudang.empty` | Komponen dasar baru wajib ada di galeri (§8) |
| 2026-11-14 | Tahap 10: kotak centang mode pilih (kartu dan baris) di atas lapisan klik judul (`z-1`) | Ditemukan E2E: `label::after` menutupi kotak centang, sehingga klik tepat di kotak tidak sampai ke kotak itu sendiri |
| 2026-11-14 | Tahap 10: tes. `gudang.e2e.ts` masuk `ASSET_TESTS`; aset dibuat lewat API dan ditunggu sampai siap direview sebelum halaman dibuka. `collectConsoleProblems` mencantumkan URL untuk "Failed to load resource". Preload tes web menutup semua toast sonner setelah tiap tes. `renderWithQuery` memakai `QUERY_STALE_TIME_MS` dari `web/lib/query.ts`. Shell E2E mengukur tombol "Aset baru" di topbar (Gudang kosong punya tombol kedua di Empty state) | sonner 2.0.8 memutar ulang toast yang masih aktif ke `Toaster` baru, sehingga toast tes sebelumnya muncul lagi. Cache tes harus sama dengan app supaya data basi ikut teruji |
| 2026-11-14 | Tahap 10: cek piksel cincin fokus E2E (`focusRingProblem`) membaca dua piksel pita cincin 2 px (piksel tengah dan kirinya) dan lolos bila salah satunya sama dengan token `accent-ring` (±6). `viewportPixels` menghitung skala dari lebar gambar (`deviceScaleFactor` 2 di tes shell) | Skia menghaluskan tepi dalam outline membulat (±97% warna) walau posisinya bulat. Tombol "Sedang berpikir…" di galeri bergeser karena bagian galeri baru, dan cek satu piksel jatuh tepat di tepi itu. Cincin yang tertutup atau terpotong tetap gagal (kedua piksel berbeda) |
| 2026-11-14 | Tahap 10: galeri `/_komponen` memakai thumbnail dan strip turntable fixture (`tests/fixtures/turntables/textured-peti.*`, diimpor `?url` seperti halaman uji viewer) untuk kartu "Peti harta kayu". Tes galeri memilih region "Kartu aset" dengan `exact: true` dan memeriksa bagian mode pilih | Chip "360°" sekarang baru tampil setelah strip dimuat; tanpa strip, state hover kartu tidak bisa diperiksa di galeri. Region "Kartu aset · mode pilih" ikut cocok dengan nama "Kartu aset" tanpa `exact` |
| 2026-11-14 | Tahap 10 (tinjauan): `.blend` Sumber dibersihkan sebelum disimpan. `assetkit.save_blend` membuang semua teks (`bpy.data.texts`) dan driver `SCRIPTED`, termasuk di node tree, lalu melaporkan jumlahnya (`removed`). README Sumber meminta Blender desktop tidak menjalankan skrip dari file. pytest + `API.md` ikut | Skrip Claude tidak dipercaya (§7): teks `use_module` dan driver Python ikut berjalan saat `.blend` dibuka di Blender desktop dengan *Auto Run* aktif |
| 2026-11-14 | Tahap 10 (tinjauan): error ekspor ke klien hanya pesan `UnityExportError` (mis. KTX2) atau pesan tetap "Ekspor gagal dibuat. Detailnya ada di log server." Error lain dicatat sekali lewat `onError` (op `export-<preset>`) | Pesan internal (path, error validator mentah) tidak boleh sampai ke klien (§5) |
| 2026-11-14 | Tahap 10 (tinjauan): ZIP dua langkah, menggantikan "tautan `download` biasa" di baris sebelumnya. `POST /api/assets/export-zip/prepare` memeriksa aset dan membuat GLB Unity lebih dulu; tombol ZIP memuat selama itu, error tampil sebagai toast. Setelah berhasil, tautan sementara (`download`) mengikuti `GET /api/assets/export-zip`, yang juga menyiapkan semua file sebelum stream dimulai | Dengan tautan biasa, error (mis. Unity gagal validasi) terunduh sebagai file JSON atau ZIP terpotong, tanpa pesan di app. Setelah pemeriksaan, GET memakai cache `derived/` |
| 2026-11-14 | Tahap 10 (tinjauan): thumbnail tidak lagi dirender saat gambar diminta. Daftar dan detail membawa `thumbnail: boolean` (`thumb.webp` dan `turntable.webp` ada). Bila belum ada, `ThumbnailService.schedule` membuatnya di latar satu per satu (versi yang gagal tidak dicoba lagi sampai server restart), lalu event `global` `asset updated` membuat web memuat ulang daftar. Selama belum ada, area gambar kartu dan baris versi kosong (latar saja) | Grid berisi aset lama memicu banyak render bersamaan (Chromium, batas waktu), dan render yang gagal diulang setiap permintaan |
| 2026-11-14 | Tahap 10 (tinjauan): cache Sumber per nama aset, `export-source-<sha256(nama), 16 hex>.zip`. Estimasi memakai file yang sama | Folder akar ZIP dan README memuat nama aset, jadi setelah ganti nama cache lama basi. Unity tetap satu file per versi (isinya tidak memuat nama) |
| 2026-11-14 | Tahap 10 (tinjauan): Duplikat hanya menyalin baris versi yang foldernya ikut tersalin, dan melewati entri tersembunyi (`.staging-*`, `*.tmp`) di `versions/` dan `derived/`. Hapus menunggu pekerjaan turunan aset itu (render thumbnail, ekspor) sebelum folder dibuang (`beforeRemoveDir`) | Build yang selesai saat Duplikat berjalan bisa meninggalkan baris tanpa folder. Ekspor yang masih berjalan bisa menulis ulang folder aset yang sudah dihapus |
| 2026-11-14 | Tahap 10 (tinjauan): fokus setelah hapus dari Detail aset atau sesi Studio. Navigasi membawa `state` `arrivalFocus` (zod, `web/lib/arrival-focus.ts`): Gudang memfokuskan kolom cari, Studio baru memfokuskan kolom prompt, sekali per entri riwayat (Back ke entri itu tidak memindah fokus lagi). `restoreFocus` tidak memfokuskan pembuka yang sudah lepas dari DOM | Menu "…" ikut hilang bersama halamannya, jadi fokus jatuh ke `body` |
| 2026-11-14 | Tahap 10 (tinjauan): gema kolom cari dikenali dari nomor ketikan di `state` navigasi (`searchEcho`, unik untuk seluruh app), menggantikan pencocokan nilai di baris sebelumnya | Router membatalkan navigasi yang tersusul, jadi hanya ketikan terakhir yang tiba. Dengan pencocokan nilai, "x" → "" → "x" meninggalkan gema yang menunggu, dan "Hapus filter" terbaca sebagai gema (kolom tidak kosong) |
| 2026-11-14 | Tahap 10 (tinjauan): dialog ekspor membatalkan unduhan saat `open` menjadi false, tidak menunggu isi dialog dilepas. File tidak disimpan bila sudah dibatalkan, dan tombol Unduh kembali normal | Radix menahan isi dialog selama animasi tutup, jadi respons yang tiba saat itu masih tersimpan sebagai file. Tes mensimulasikan animasi tutup lewat `animation-name` + `animationend` |
| 2026-11-14 | Tahap 10 (tinjauan): batas nama aset dihitung per code point di server dan dialog Ganti nama (tanpa `maxLength` HTML, error "Nama aset maksimal 80 karakter." langsung saat lewat batas); surrogate tunggal dibuang. Urut Nama memakai `Intl.Collator("id", { sensitivity: "base", numeric: true })` di repo (baris yang cocok diurutkan lalu dipotong `ASSET_LIST_MAX`), bukan `COLLATE NOCASE` | `maxLength` dan `String.length` menghitung unit UTF-16, jadi 80 emoji terpotong menjadi 40, padahal nama dari prompt boleh 80. `NOCASE` hanya mengenal ASCII: "Peti 10" sebelum "Peti 2", "Élan" sesudah "zebra". Cari (LIKE) tetap hanya mengabaikan huruf besar/kecil ASCII |
| 2026-11-14 | Tahap 10 (tinjauan): Gudang mengumumkan jumlah hasil cari/filter lewat `role="status"` tersembunyi yang selalu terpasang di bagian filter ("3 aset ditemukan" / "Tidak ada hasil"; kosong tanpa filter dan selama hasil dimuat) | WCAG 4.1.3: hasil berubah tanpa pindah fokus. Live region yang baru disisipkan sering tidak diumumkan |
| 2026-11-14 | Tahap 10 → **Tahap 11**: README Sumber dan `probe` menjalankan ulang skrip dengan `DEFAULT_TIERS[tier]`. Sampai Tahap 11 nilainya sama dengan `tierSnapshot` aset; begitu budget bisa diubah, Sumber harus membawa snapshot itu | Budget yang bisa diubah baru ada di Tahap 11 |
| 2026-11-14 | Tahap 10 ditutup dan disetujui lewat tinjauan agent (delegasi pemilik). Lolos: `check`, E2E penuh (83), `e2e:api`, `RUNTIME_IT` (26), `test:assetkit` (77), `test:pipeline` (17), build tanpa warning, `tokens:sync --check`. 14 temuan tinjauan: 13 diperbaiki dengan tes, 1 dipindah ke Tahap 11. Uji import Unity menunggu pemilik (panduan di laporan). Laporan `docs/progress/tahap-10.md`. Tahap aktif → Tahap 11 (belum dimulai) | Delegasi pemilik 2026-11-14: "lanjut aja setiap tahap sampai selesai, anda review, anda jawab, anda revisi sendiri" |
| 2026-11-14 | Pemilik: "sampai tahap 10 saja dulu". Delegasi berhenti di Tahap 10; Tahap 11 belum dimulai (tidak ada kode Tahap 11) dan baru dikerjakan bila pemilik memintanya | Permintaan pemilik |

# AGENTS.md — AI Asset Generate

Aturan untuk agent coding (Claude Code dan sejenisnya) di repo ini. `CLAUDE.md` memuat file ini, jadi semua agent
memakai aturan yang sama. Bahasa percakapan dengan pemilik: **Indonesia**.

**Proyek dalam satu paragraf.** App web lokal satu pengguna untuk membuat aset 3D `.glb` dari prompt dan lampiran.
Claude (sesi login Claude Code lewat Agent SDK, tanpa API key) menulis skrip Blender. Skrip dijalankan headless di
sandbox Docker; Claude melihat render-nya lalu memperbaiki sendiri. Ada dua tahap: bentuk dasar abu-abu → disetujui
pemilik → aset final bertekstur. Stack: Bun + Hono + SQLite/Drizzle di server; React + Vite + Tailwind + shadcn/ui +
React Three Fiber di web.

## 0. Baca dulu, setiap sesi
1. **[`docs/PLAN.md`](docs/PLAN.md):** penanda **Tahap aktif** di bagian atas, checklist tahap itu, dan Log keputusan.
2. **[`docs/TECH_STACK.md`](docs/TECH_STACK.md):** library dan versi yang dipakai, alasannya, dan opsi yang sudah ditolak.
3. **Laporan terakhir di [`docs/progress/`](docs/progress/):** temuan dan pertanyaan yang masih terbuka.
4. **Desain**, bila pekerjaan menyentuh UI: `design/ai-asset-generate.figcraft` (dibaca lewat MCP FigCraft, lihat §13)
   dan PNG di `design/exports/`.

Bila pemilik hanya bilang "lanjutkan", kerjakan tugas berikutnya yang belum dicentang di tahap aktif.

## 1. Alur kerja bertahap
- **Kerjakan hanya tahap aktif.** Jangan mengerjakan tugas tahap lain "sekalian", sekecil apa pun. Temuan untuk tahap
  lain dicatat di laporan. Permintaan eksplisit pemilik di luar tahap aktif boleh dikerjakan dan dicatat di Log keputusan.
- Saat mulai, ubah status tahap aktif di `docs/PLAN.md` (header dan tabel status) menjadi `berjalan`.
- Kerjakan per tugas: kode + tes → `bun run check` → centang `[x]`. Jangan mencentang yang belum terverifikasi.
- Perubahan rencana (tugas baru atau dihapus, dependensi baru, pendekatan berbeda) dicatat di **Log keputusan**.
  Bila perubahan itu menyentuh lingkup atau perilaku produk, tanya pemilik dulu.
- **Menutup tahap:**
  1. jalankan semua perintah Definition of Done tahap itu;
  2. tulis `docs/progress/tahap-NN.md` dari template di [`docs/progress/README.md`](docs/progress/README.md);
  3. ubah status tahap menjadi `menunggu review`;
  4. **berhenti**, lalu laporkan ringkas ke pemilik beserta path laporannya.

  Penanda "Tahap aktif" hanya dipindah setelah pemilik menyetujui secara eksplisit.
- Bila ragu soal lingkup, UX, atau keputusan yang sulit dibatalkan, tanya pemilik dengan pilihan dan rekomendasi.
  Jangan menebak.
- **Selalu minta izin pemilik dulu untuk:**
  - perintah yang memakai kuota Claude: `eval:*`, `AGENT_DRIVER=sdk`, uji nyata;
  - commit, push, atau membuat branch (lihat §11);
  - menghapus isi `data/` (aset pemilik) atau apa pun di luar repo ini.
- Jangan mengubah repo lain. Kode dari `/var/www/ai-team` **disalin** lalu disesuaikan, bukan di-import lintas proyek.

## 2. Produk & desain
- **Bahasa:**
  - teks UI berbahasa Indonesia, seluruhnya di `web/i18n/id.ts`;
  - identifier dan nama file dalam bahasa Inggris;
  - komentar kode, README, dan prompt untuk Claude berbahasa Indonesia.
- **Gaya:** modern, bersih, tidak mencolok.
  - Hanya pakai token dari `web/styles/tokens.css` (hasil `bun run tokens:sync`).
  - Tanpa warna mentah di komponen, tanpa gradien, tanpa glow.
- **FigCraft adalah sumber kebenaran desain.**
  - Layar yang belum digambar disusun dari komponen dan token yang sudah ada.
  - Kebutuhan visual baru yang signifikan dirancang dulu di FigCraft dan disetujui pemilik.
  - **Jangan membuat prototipe HTML.** `design/prototype/viewer-360.html` hanya acuan perilaku viewer.
- **Jangan pernah membuat Artifact** atau halaman claude.ai apa pun, termasuk Claude Docs. Laporan, rencana, dan bukti
  disimpan sebagai file lokal di repo; beri path lengkap dan cara membukanya (`xdg-open <path>`).
- **Aksesibilitas wajib:**
  - semua fitur bisa dipakai dengan keyboard, fokus terlihat;
  - label dan `aria-*` benar;
  - kontras AA di kedua tema;
  - hormati `prefers-reduced-motion`.

## 3. Arsitektur
- **Arah dependensi:**
  - `shared` ← `server/domain` (murni, tanpa I/O) ← `server/services` ← `server/http`, `server/agent`, `server/realtime`;
  - `web` hanya bergantung pada `shared` dan tipe `AppType` dari server.
- **Satu pintu per integrasi:**

  | Integrasi | Satu-satunya tempat |
  |---|---|
  | Agent SDK | `server/agent/sdk-adapter.ts` |
  | Docker | `server/runtime/docker.ts` |
  | Chromium renderer | `server/render/` |
  | Database | `server/db/repos/` |

- **Budget dan status:**
  - angka batas dan budget hanya di `shared/limits.ts`;
  - aset memakai `tierSnapshot` miliknya sendiri, bukan budget global yang berlaku sekarang;
  - status aset hanya berubah lewat `transition()` di `server/domain/status.ts` (aturan di PLAN Lampiran C).
- **Gerbang ditegakkan di server**, yaitu di handler HTTP dan tool `forge`. Ini mencakup dua tahap, budget, batas
  build, dan kunci REVIEW. Prompt dan tombol UI yang dinonaktifkan bukan pengaman.
- **Versi aset write-once.** Setelah `vN` terbentuk, isinya tidak diubah. Hasil turunan ditulis ke `derived/`.
- **Database:**
  - skema berubah → `bun run db:generate`, dan SQL migrasinya ikut di-commit;
  - jangan pakai `drizzle-kit push`;
  - transaksi `bun:sqlite` sinkron, jadi tidak ada `await` di dalamnya.

## 4. TypeScript & Bun
- **Tipe ketat** sesuai `tsconfig.json` (basis untuk `tsconfig.server.json` dan `tsconfig.web.json`):
  - jangan memakai `any`, `@ts-ignore`, atau `@ts-expect-error`;
  - hindari non-null assertion (`!`);
  - bila tipe library salah, buat pembungkus kecil bertipe dengan komentar alasannya.
- **Validasi zod di setiap batas:** request HTTP, pesan WebSocket, env, input tool MCP, JSON dari disk atau container,
  dan respons layanan luar.
- **Tidak ada promise mengambang:** selalu `await`, atau `void p.catch(logError)` untuk fire-and-forget yang disengaja.
- **Error bertipe** dengan `code` stabil (lihat `server/http/errors.ts`). Jangan melempar string.
- **Proses anak:**
  - `Bun.spawn` dengan array argumen, tidak pernah lewat shell;
  - selalu ada timeout dan `AbortSignal`;
  - proses dibunuh saat dibatalkan.
- **File:**
  - path dari luar disanitasi dan dicek dengan `realpath` terhadap root yang diizinkan;
  - tulis file secara atomik: file sementara di folder yang sama → `rename`.
- **Dependensi:**
  - hanya yang tercantum di `docs/TECH_STACK.md`;
  - tambah atau upgrade lewat `bun add --exact`, lalu perbarui TECH_STACK dan Log keputusan;
  - `bun.lock` ikut di-commit.
- **Gaya kode:**
  - fungsi kecil dan nama yang jelas;
  - named export (default export hanya bila alat mewajibkan, misalnya config Vite atau Playwright);
  - tanpa kode mati atau kode yang dikomentari.

## 5. Server (Bun + Hono)
- **Hanya bind `127.0.0.1`.** Pagar Host/Origin berlaku untuk semua rute **dan** sebelum upgrade WebSocket.
  Alasannya: user mesin ini anggota grup `docker`, yang setara root. API yang bisa dijangkau dari jaringan atau dari
  situs lain (DNS rebinding) sama dengan memberi akses root.
- **Error ke klien:** bentuknya `{ code, message }`, pesan berbahasa Indonesia, tanpa stack trace. Detailnya ditulis ke log.
- **Unggahan:**
  - batas ukuran dan jumlah diambil dari `shared/limits.ts`;
  - tipe dicek dari isi (magic byte), bukan dari ekstensi;
  - gambar di-re-encode dengan sharp, metadata dibuang;
  - nama file disanitasi.
- **WebSocket:**
  - pakai protokol di `server/realtime/`: sub/unsub, replay `after`, resync, heartbeat;
  - `maxPayloadLength` 64 KB;
  - perhatikan backpressure: delta boleh dibuang, event penting tidak.
- **Respons besar** (file versi, ZIP) di-stream. Atur `idleTimeout` Bun, karena bawaannya hanya 10 dtk.
- **Log pino** terstruktur dengan `assetId`/`jobId`/`sessionId`. Jangan pernah mencatat:
  - data base64 atau gambar;
  - isi env, token, atau kredensial;
  - isi skrip lengkap.

## 6. Claude Agent SDK
- **Tanpa API key.**
  - Jangan pernah memakai `ANTHROPIC_API_KEY` atau `ANTHROPIC_AUTH_TOKEN`.
  - Env proses Claude selalu dari `agentEnv()`. Opsi `env` SDK **mengganti** seluruh env, jadi `agentEnv()` menyalin
    `process.env` lalu menghapus kedua variabel itu.
- **Satu pintu:**
  - hanya `server/agent/sdk-adapter.ts` yang meng-import `query`; kode lain memakai `AgentPort`;
  - semua opsi sesi berasal dari satu factory, `server/agent/options.ts`.
- **Akses Claude dijaga tiga lapis:**
  1. allowlist `tools`;
  2. aturan izin + `canUseTool` yang menolak secara bawaan;
  3. hook PreToolUse dengan cek `realpath`.

  Mengubah salah satu lapis wajib disertai tes penolakan. Jangan pernah memberi Bash, WebFetch/WebSearch, Task/Agent,
  NotebookEdit, atau tool `mcp__claude_ai_*`.
- **Hasil tool `forge` ringkas:** JSON + maksimal **1** gambar ≤1024 px. Jangan mengirim GLB, base64 besar, atau log
  panjang ke Claude.
- **Cek opsi dan tipe di `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`** sebelum memakainya, jangan dari ingatan.
- **Upgrade SDK:** rekam ulang `tests/fixtures/sdk/`, jalankan tes kontrak, dan catat di TECH_STACK.
- **Fixture:** stream yang direkam disanitasi dulu (email, id akun, path home). Data pribadi pemilik tidak boleh masuk
  ke kode, tes, atau fixture.
- **Kuota:** tes rutin memakai `AGENT_DRIVER=fake`. Driver `sdk` memakai kuota pemilik, jadi hanya dengan izin.
- **Quirks yang sudah diketahui** (dari ai-team `server/agent/runner.ts` dan `server/roles.ts`):
  - `interrupt({ cancelQueued: true })` belum tercantum di `sdk.d.ts`, tetapi diteruskan oleh `sdk.mjs` → cast
    terbatas di adapter;
  - hasil (`result`) dicocokkan ke pesan pengguna lewat `user_message_uuids`, bukan lewat urutan;
  - pesan yang masih ter-buffer bisa datang setelah `close()` → abaikan;
  - loop `for await` pembaca stream harus tetap hidup selama sesi;
  - saat Stop, interrupt dulu, baru batalkan kartu pertanyaan yang terbuka;
  - aturan izin `ask` dievaluasi **sebelum** `allow`;
  - `permissionMode: "auto"` butuh dukungan model; bila tidak didukung, Claude Code diam-diam turun ke `default`.
    Jangan bergantung padanya; izin diatur eksplisit;
  - tool `mcp__claude_ai_*` dari akun claude.ai bisa ikut muncul di sesi → selalu masuk daftar tolak.
- **Batas pemakaian** dideteksi lewat `rate_limit_event` dan `USAGE_LIMIT_ERROR_PREFIXES` → `runState: failed` dengan
  `code: USAGE_LIMIT` dan waktu reset.

## 7. Runtime 3D (Docker + Blender)
- **Docker:**
  - Blender dan `bpy` tidak pernah dijalankan di host. Semua job lewat `server/runtime/docker.ts`.
  - Flag sandbox dijaga tes snapshot. Mengubahnya berarti memperbarui snapshot dan mencatat alasannya di Log keputusan.
  - Setiap container berlabel `aag.job`. Tidak boleh ada container tersisa setelah job atau tes.
  - Jangan menyentuh container, image, atau volume milik proyek lain. Tanpa `docker system prune`.
- **Output container tidak dipercaya:** dibaca dengan `lstat`, hanya file biasa, nama di-allowlist, ukuran dibatasi,
  dan symlink tidak diikuti.
- **`assetkit`:**
  - pakai data API atau `bpy.context.temp_override`, bukan operator yang butuh UI;
  - jumlah thread Cycles diambil dari env;
  - setiap helper punya pytest;
  - perubahan API ikut memperbarui `runtime/knowledge/API.md` dan cookbook dalam perubahan yang sama.
- **Tugas harness** (tidak dipercayakan ke skrip Claude): ekspor glTF dan cek budget. Tahap 1 selalu tanpa material.
- **Pipeline:** validasi `gltf-validator` dijalankan sebelum kompresi meshopt. GLB untuk Unity tanpa ekstensi kompresi.

## 8. Web (React)
- **Data server** lewat client `hc` + TanStack Query. Event WebSocket menginvalidasi atau me-merge cache. Tanpa polling.
- Setiap tampilan data punya state **memuat**, **kosong**, dan **error**.
- **Komponen:**
  - `web/components/ui/` hanya berisi komponen dasar shadcn yang sudah memakai token;
  - komponen fitur ada di `web/features/<fitur>/`.
- **Ikon:** `lucide-react` lewat `LucideProvider` di `web/app/App.tsx` (`strokeWidth={1.5}` + `nonScalingStroke`), jadi
  garis tetap 1,5 px di semua ukuran, sama dengan FigCraft. Ukuran mengikuti komponen: Button md 16 / sm 14, IconButton
  md 18 / sm 16, NavItem 20. Ikon tanpa label otomatis `aria-hidden`.
- **Galeri `/_komponen`** (hanya mode dev/tes) memuat semua komponen dasar dalam state-nya untuk axe dan screenshot.
  Komponen dasar baru ikut ditambahkan ke sana.
- **Teks dari Claude** dirender dengan streamdown. Jangan pernah memakai `dangerouslySetInnerHTML`.
- **State:** pakai state lokal dulu. Library state global baru butuh alasan di Log keputusan.

## 9. Viewer 3D (React Three Fiber)
- **Render sesuai kebutuhan:**
  - `<Canvas frameloop="demand">`, dan panggil `invalidate()` saat ada perubahan;
  - jangan `setState` di `useFrame`; pakai ref.
- **Dispose** geometry, material, dan texture saat unmount atau saat ganti aset.
- **Tanpa aset dari CDN:**
  - cahaya lingkungan lokal (`RoomEnvironment` three), tanpa HDRI atau preset `Environment` dari CDN;
  - `useGLTF(url, false, true)`: Draco mati, meshopt aktif.
- Viewer di-lazy-load sebagai chunk terpisah.
- `window.__viewer` hanya ada di mode tes.

## 10. Tes & definisi selesai
- **Tes ikut setiap perubahan:**
  - setiap fitur datang bersama tesnya dalam perubahan yang sama;
  - perbaikan bug dimulai dengan tes yang gagal.
- **Tes deterministik:** tanpa jaringan, tanpa sleep, jam disuntikkan, data acak dengan seed.
- **Lapisan dan driver:** lapisan tes dan matriks driver ada di PLAN §6. Tes rutin memakai
  `AGENT_DRIVER=fake` + `RUNTIME_DRIVER=fixture`.
- **Pemilih elemen:** tes komponen dan E2E memilih elemen lewat role dan nama (`getByRole`), bukan kelas CSS.
- **Golden image** hanya diperbarui lewat `UPDATE_GOLDENS=1`, dan perubahannya disebut di laporan tahap.
- **Tes tidak dikompromikan:**
  - jangan commit `.only` atau `.skip`;
  - jangan melemahkan, menghapus, atau melewati tes supaya lolos. Perbaiki kodenya, atau laporkan masalahnya.
- **Selesai berarti:**
  - `bun run check` hijau;
  - DoD tahap terpenuhi;
  - halaman `docs/fitur/` atau `docs/teknis/` yang terkait ikut diperbarui bila fitur, API, skema, atau batas berubah;
  - tidak ada error atau warning baru di console browser maupun log server.

  Bila sesuatu tidak bisa diverifikasi, tulis begitu di laporan.

## 11. Git
Repo baru di-`git init` di Tahap 0. Aturan berikut disalin apa adanya dari AGENTS.md ai-team milik pemilik:

- Commit only when the user explicitly asks. Otherwise, leave changes uncommitted in the working tree.
- Do not push or create branches unless the user explicitly asks. Commit to the current branch.
- Stage specific files with `git add <path>`. Do not use `git add .` or `git add -A`.
- Write commit messages in English, even if the conversation is in another language.
- Use the Conventional Commits format: `<type>(<optional scope>): <description>`
    - Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
    - Mark breaking changes with `!`, for example `feat(api)!: remove legacy login endpoint`
    - Examples: `fix(auth): handle expired token`, `docs: update setup guide`
- Never add AI attribution to commit messages. This includes `Co-Authored-By` trailers for Claude or any other AI, and lines such as "Generated with Claude Code".

## 12. Perintah
| Perintah | Fungsi | Ada sejak tahap |
|---|---|---|
| `bun install --frozen-lockfile` | Pasang dependensi sesuai `bun.lock` | 0 |
| `bun run dev` | Server (`127.0.0.1:4340`) + Vite (`127.0.0.1:4341`). Berhenti dengan pesan jelas bila port sudah dipakai | 0 |
| `bun run check` | lint + typecheck + test + cakupan. Wajib hijau sebelum mencentang tugas | 0 |
| `bun run lint` / `format` / `typecheck` | Biome; `tsc --noEmit` untuk server dan web | 0 |
| `bun run test` | `test:server` + `test:web` | 0 |
| `bun run build` / `start` | Build web (lalu `scripts/check-bundle.ts`: tanpa kode khusus tes, viewer di chunk terpisah, chunk awal ≤300 kB gzip), lalu jalankan server produksi | 0 |
| `bun run build:test` | Build mode test ke `dist-test/` (berisi `/_smoke`); dipakai server E2E di `127.0.0.1:4342` | 0 |
| `bun run e2e:smoke` / `e2e` | Playwright + axe. Dengan `SCREENSHOT_DIR=docs/progress/tahap-NN`, screenshot bukti (shell, galeri `/_komponen`) disimpan ke folder itu | 0 |
| `bun run check:auth` | Cek login Claude lewat `accountInfo()`, tanpa memanggil model | 0 |
| `bun run tokens:sync` | Token FigCraft → `web/styles/tokens.css` + `tokens.ts`. `--check` hanya membandingkan | 0 |
| `bun run db:generate` | Buat migrasi SQL dari skema Drizzle | 0 |
| `bun run runtime:build` / `test:assetkit` | Bangun image `asset-forge`; pytest di dalam image | 1 |
| `bun run runtime:samples` | Jalankan `runtime/samples/*.py` lewat runner → `tests/fixtures/glb/` (GLB + statistik) | 1 |
| `bun scripts/runtime.ts textured-samples` / `probe <skrip.py> [--base \| --textured TIER]` | Contoh bertekstur + bentuk dasar pasangannya → `tests/fixtures/glb/textured/`; jalankan satu skrip (mentah, lewat harness bentuk dasar, atau bertekstur) dan cetak waktu/RAM | 4 |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | Tes runtime nyata dengan Docker, termasuk alur penuh `AGENT_DRIVER=fake` × `RUNTIME_DRIVER=docker` (tanpa kuota) | 1 |
| `bun run test:coverage` | Cakupan baris ≥90% per file di `server/domain` dan `server/agent` (ambang di `bunfig.toml`) | 5 |
| `bun scripts/fixture-sheets.ts` | Render ulang contact sheet fixture (`tests/fixtures/contact-sheets/`) untuk `RUNTIME_DRIVER=fixture` | 5 |
| `AGENT_DRIVER=fake RUNTIME_DRIVER=fixture bun run dev` | App tanpa Claude dan tanpa Docker (skenario palsu; penanda `[tanya]`, `[tanya-banyak]`, `[macet]`, `[batas]`, `[mati]`, `[keluar]` di pesan) | 5 |
| `bun run test:pipeline` / `pipeline:demo` | Tes renderer + golden (butuh Chromium); demo skrip → versi v1 di `.tmp/pipeline-demo/` | 2 |
| `UPDATE_GOLDENS=1 bunx playwright test tests/e2e/viewer.e2e.ts` | Buat ulang golden viewer (`tests/goldens/viewer/`, 7 sudut × 2 tema); tanpa env itu golden hanya dibandingkan | 8 |
| `bun run eval:base` / `eval:texture` | Evaluasi kualitas dengan Claude sungguhan. **Butuh izin** | 3 / 4 |
| `bun run textures:sync` | Unduh pustaka material CC0 (butuh jaringan) | 4 |
| `bun run e2e:api` | Alur penuh lewat HTTP + WebSocket terhadap proses server di port 4342, mode palsu; log server wajib bersih | 6 |
| `bun run doctor` | Cek kesiapan mesin (Bun, `claude` + login, Docker + image, Chromium, disk, port, `data/`); tanpa kuota | 12 |

- Perintah dari tahap yang belum dikerjakan memang belum ada; perintah itu dibuat di tahap yang tercantum.
- Port app ini 4340/4341/4342 (`shared/ports.ts`). Port lain di mesin ini: ai-team 4320/4321, learning-system dan
  automated-test-app 4330/4331. Hentikan proses dev yang dijalankan di latar setelah verifikasi selesai, lewat PID-nya
  (bukan `pkill -f`, karena pola bisa cocok dengan shell pembunuhnya sendiri).

## 13. Jebakan yang sudah diketahui
**Mesin dan tooling**
- CLI `claude` ada di `~/.local/bin`, dan Agent SDK memanggilnya dari `PATH`. Service systemd wajib memasukkan
  `~/.local/bin` dan `~/.bun/bin` ke `PATH`.
- TypeScript 7 belum punya API programatik, jadi alat berbasis API TS (aturan bertipe ESLint, knip) tidak berjalan.
  Lint memakai Biome.
- `bpy==5.2.4` hanya tersedia untuk CPython 3.13 (manylinux x86_64). Python host (3.14) tidak bisa dipakai.

**Server dan tes**
- Optional call `f?.(await g())` tidak mengevaluasi argumennya bila `f` tidak ada, jadi `g()` tidak pernah dipanggil.
  Hitung hasilnya dulu ke variabel (kasus nyata: `onDone` opsional di `server/services/maintenance.ts`).
- Server menjalankan pemeliharaan saat start (backup `data/backups/`, bersih-bersih `data/jobs/` dan `derived/`). Server
  tes dengan `DATA_DIR` sementara ikut membuat backup di sana; itu wajar.
- Bun `idleTimeout` bawaan 10 dtk memutus respons yang lambat.
- Preload happy-dom mengganti global seperti `fetch`, jadi hanya dipakai untuk tes web. Menjalankan satu file tes web
  juga butuh preload itu: `bun test --preload ./tests/setup/happy-dom.ts web/<file>`.
- happy-dom 21 tidak menjalankan `<script>` inline, dan `prefers-color-scheme` bawaannya `light`. Skrip tema diuji
  lewat `new Function(themeBootScript())`.
- Tipe `fetch` Bun mewajibkan properti `preconnect`, jadi mock memakai `Object.assign(fake, { preconnect })`.
- `hono/bun` deprecated, jadi pakai `@hono/bun`. Handler `websocket`-nya tidak meneruskan event `drain`, jadi
  `main.ts` memasang `drain` sendiri. `WSContext` dibuat ulang setiap event dan `ws.raw` bertipe longgar: hub mengenali
  sambungan dari objek `ServerWebSocket` asli (dicek di `server/realtime/route.ts`).
- `ServerWebSocket.send()` Bun: -1 = masuk antrean (backpressure), 0 = dibuang (antrean melewati
  `backpressureLimit` 16 MB atau sambungan menutup), >0 = byte terkirim.
- `server.stop()` Bun menunggu sambungan yang masih terbuka; tutup hub WebSocket dulu.
- `String.length` dan `slice` menghitung unit UTF-16, jadi bisa membelah emoji menjadi surrogate tunggal. API Claude
  menolak teks seperti itu, dan teks itu tersimpan di transkrip sesi. Potong teks lewat `shared/text.ts`; runner
  mengganti surrogate tunggal sebelum mengirim ke Claude.
- Form `hc`/Hono: key berakhiran `[]` (mis. `files[]`) selalu menjadi array.
- Tipe `AppType` membuat typecheck web ikut membaca kode server (sampai pipeline); deklarasi ambient di
  `server/types/` harus ikut di `tsconfig.web.json`.
- `bun --watch` tidak keluar saat server gagal bind port; karena itu `scripts/dev.ts` mengecek port lebih dulu.
- Agent SDK tidak mengisi `apiKeySource` untuk sesi login (bukan `"none"`). `check:auth` menganggap kosong = tanpa
  API key, dan gagal bila ada sumber API key apa pun.
- Biome 2.6 ikut memformat Markdown, jadi `*.md` dikecualikan di `biome.json`.
- `coverageThreshold` Bun 1.4.4 dicek **per file**, dan hanya untuk file yang dimuat tes. Mengisi `lines` saja ikut
  menegakkan `functions` dengan nilai bawaan, jadi `functions` diset eksplisit di `bunfig.toml`.
- Server MCP dari `createSdkMcpServer` hanya bisa tersambung ke satu transport: buat baru untuk setiap proses Claude
  (`Forge.mcpServer()`), termasuk di tes `InMemoryTransport`.
- `bun test` memuat `main` CJS drei (paket tanpa `exports`), yang me-`require` R3F dan three versi CJS. Akibatnya tes web
  mencetak `DeprecationWarning [THREE_CJS_DEPRECATED]` sekali per proses. Plugin runtime Bun (`onResolve`, `onLoad`) di
  preload tidak mengubahnya. Peringatan ini sudah diketahui; jangan disembunyikan.
- happy-dom tidak punya WebGL2 (`getContext("webgl2")` → null) dan Fullscreen API, sama seperti Safari iPhone. Viewer
  punya jalur tanpa keduanya, dan tes komponen memakai jalur itu.
- Server uji di latar dari shell: jalankan `bun server/main.ts &` sebagai perintah sendiri. Di ujung rantai
  `cd … && … &`, `$!` adalah PID subshell, dan membunuhnya tidak menghentikan bun (port 4342 tetap terpakai).
- Cleanup Testing Library hanya membuang pohon dari `render`. Tes yang menempel elemen langsung ke `document.body` wajib
  membuangnya di `afterEach`; sisa elemen ikut terbaca `getByRole` di tes lain.
- Driver palsu (`server/agent/scenario-port.ts`): pesan yang dikirim skenario baru tercatat saat runner membacanya.
  Sebelum hook, izin, atau tool dijalankan, tunggu `InputQueue.drained()`, supaya urutan event sama dengan CLI asli.
  Tanpa itu kartu pertanyaan tercatat sebelum thinking yang mendahuluinya.
- Folder data server Playwright disiapkan `scripts/e2e-data.ts`: folder versi read-only (`rm -rf` gagal) dan pustaka
  material uji. Tanpa pustaka, tahap tekstur skenario palsu gagal `LIBRARY_MISSING`.
- Semua tes E2E berbagi satu server dan folder data: aset baru memunculkan toast "siap direview" (bisa menutupi gizmo
  viewer) dan kartu "Terakhir dibuat" di halaman tes lain. Tes yang membuat aset ada di project Playwright `aset`
  (`ASSET_TESTS` di `playwright.config.ts`, satu worker), yang baru berjalan setelah project `chromium` selesai. File
  E2E baru yang membuat aset wajib masuk `ASSET_TESTS`. Filter file tidak berlaku untuk project dependensi: untuk
  menjalankan tes aset saja, tambahkan `--no-deps` (mis. `bunx playwright test tests/e2e/studio.e2e.ts --no-deps`).
- Script `focus()` di tes komponen dibungkus `act`. Peringatan act dari Tooltip juga muncul bila kerangka app render ulang
  saat query selesai di luar `act`; data turunan untuk kerangka memakai `select` + `placeholderData` (`useStudioBusy`).
- happy-dom tidak pernah mencoba ulang komponen lazy yang suspend di luar `act`. Tes halaman sesi memakai
  `SessionViewerContext` + `FakeViewer`, bukan viewer lazy.
- `expect(elemen).toBeNull()` yang gagal di dalam `waitFor` membuat Bun memformat seluruh elemen DOM secara sinkron
  (ratusan ms per cek). Timer dan `requestAnimationFrame` app ikut tertunda, sehingga `waitFor` habis waktu walau
  elemennya sebenarnya akan hilang (mis. toast sonner, ±200 ms). Untuk menunggu elemen hilang, pakai
  `waitForElementToBeRemoved`.
- happy-dom: `createEvent.paste` tidak membawa `clipboardData`. Isi lewat `Object.defineProperty` (`files`, `items`,
  `types`), seperti helper di `Composer.test.tsx`.
- happy-dom tidak menghitung tata letak (`getBoundingClientRect` dan ukuran scroll selalu 0). Tes posisi gulir
  mensimulasikannya: `Object.defineProperty` untuk `scrollTop`/`scrollHeight`/`clientHeight` dan `spyOn` pada
  `HTMLElement.prototype.getBoundingClientRect` (`simulateLayout` di `ThreadView.test.tsx`). Kode yang mengukur
  tata letak memakai posisi desain bila lebar wadahnya 0.
- Delta stream (`seq` null) hanya dikirim ke pelanggan yang sudah tersambung dan tidak disimpan. E2E yang perlu melihat
  teks sedang di-stream memulai giliran setelah halaman berlangganan, mis. pesan revisi dengan penanda `[macet]`.
- `bun test` berjalan di zona waktu UTC (bila `TZ` tidak diset). Waktu fixture yang tampil sebagai jam ditulis dengan
  `Date.UTC(…)`, supaya hasilnya sama di mesin mana pun.
- sonner 2.0.8: daftar toast global untuk satu proses, dan `Toaster` baru memutar ulang toast yang masih aktif. Preload
  tes web menutup semua toast (`toast.dismiss()`) setelah tiap tes; tanpa itu toast tes sebelumnya muncul lagi.
- Router data React Router menjalankan navigasi sebagai transition, jadi URL bisa tertinggal beberapa ketikan. Kolom yang
  menulis isinya ke URL menyimpan teks sendiri dan mengabaikan gema dari ketikannya sendiri (`GudangSearch`). `act`
  Testing Library menuntaskan transition di setiap ketikan; navigasi lambat disimulasikan dengan `loader` rute yang
  ditahan.
- Dialog Radix yang modal memberi `aria-hidden` pada isi halaman lain. Query tes untuk isi di balik dialog memakai
  `{ hidden: true }`.
- `<header>` topbar ada di dalam `<main>`, jadi bukan landmark `banner` (`getByRole("banner")` tidak menemukannya). Tes
  mencarinya lewat `closest("header")` dari isinya.
- happy-dom tidak menjalankan animasi CSS, jadi Radix Presence langsung melepas isi dialog saat ditutup. Perilaku selama
  animasi tutup diuji dengan `<style>` yang memberi `[data-state="closed"]` sebuah `animation-name`, lalu
  `animationend` dikirim sendiri (tes dialog ekspor di `AssetActions.test.tsx`).
- Entri awal router (`createMemoryRouter`, juga browser tanpa `history.state`) berkunci `"default"`, jadi bukan
  identitas entri yang unik. Jangan menyimpan state per entri riwayat dengan kunci itu (`web/lib/arrival-focus.ts`).
- `zipStream` membaca entri lebih dulu sampai antreannya penuh (1 MB), jadi file kecil sudah terbaca sebelum `rm` di tes.
  Tes stream yang putus di tengah memakai file yang memang tidak pernah ada.

**3D dan pipeline**
- `bpy` 5.2 sebagai modul: `import bmesh` (juga `mathutils`) baru berhasil **setelah** `import bpy`.
- `bmesh.ops.create_*(calc_uvs=True)` butuh layer UV yang sudah ada (`bm.loops.layers.uv.new()`); tanpa itu bake gagal
  "No active UV layer". `Material.use_nodes` deprecated di 5.2 (dihapus di 6.0); material baru sudah memakai node.
- Job container berjalan dengan `--user <uid:gid pemilik>` supaya file di `/job` milik pemilik; image punya user
  non-root sendiri (10001) sebagai cadangan.
- gltf-transform `prune()` mengganti tekstur warna polos dengan faktor material, dan `weld`/`join` "memperbaiki" indeks
  di luar batas. Fixture tes tekstur harus bermotif; tes validator gagal memakai posisi NaN.
- Folder versi read-only (0555/0444): menghapusnya (tes, demo, hapus aset di Tahap 10) perlu `chmod u+w` dulu.
- Halaman render tidak bisa memakai `window` dari kode server (tsconfig server tanpa DOM): panggil lewat
  `page.evaluate("…")` dan validasi hasilnya dengan zod.
- Ekspor Blender tidak selalu identik byte demi byte (mis. `laras.glb` berbeda 654 byte, statistik sama).
  `runtime:samples` menimpa semua fixture GLB; fixture yang dipakai golden render jangan ikut diganti tanpa alasan.
- `gltf-validator` tidak bisa membaca `EXT_meshopt_compression` → validasi sebelum kompresi.
- Halaman render dipakai ulang antar-render: semua yang dibuat per render (garis wireframe, material Clay, model, grid)
  wajib di-dispose. Tes pipeline menjaganya lewat `Renderer.gpuMemory()`.
- Cutter `mod.boolean` menambah slot material kosong di objek target. Bake atlas mengisinya dengan material pertama
  objek (`bake._ensure_material`); tanpa itu bake gagal "No active image found in material slot".
- Beberapa objek high-poly untuk satu low harus di-bake bersama dalam satu pass selected-to-active; bake terpisah
  saling menimpa hasil normal.
- Unduhan ambientCG di-redirect (302) ke `acg-download.struffelproductions.com`; host itu ada di allowlist
  `scripts/textures/library.ts`. API v3 tidak memberi checksum → `runtime/materials.lock.json` (TOFU).
- Folder versi bentuk dasar dari Tahap 3 tidak punya field `stage` di `stats.json`; pembaca memakai bawaan `base`.
- Atlas warna tersimpan sRGB: nilai piksel di pytest dibandingkan dalam sRGB (#808080 ≈ 0,5), bukan linear.
- `mod.mirror(axis="Y")` membalik arah bagian (telapak, moncong). Contoh dan resep membuat pasangan depan/belakang
  terpisah untuk bagian berarah.
- WebP maksimal 16383 px per sisi (relevan untuk strip turntable).
- drei: preset `Environment` dan decoder Draco mengambil file dari CDN.
- SwiftShader: `GridHelper` hanya menggambar satu arah garis → grid memakai tekstur canvas, atau `<Grid>` drei
  (shader; terbukti tampil di E2E Tahap 0).
- drei `<Bounds>` memanggil `controls.target.copy()` dan tidak cocok dengan `CameraControls` (error di setiap frame).
  Bingkai model dengan `CameraControls.fitToBox`. `GizmoHelper` aman dipakai bersama `CameraControls`.
- R3F 9.8.2 masih membuat `THREE.Clock` (deprecated sejak three r183). Peringatan itu disaring di
  `web/lib/three-console.ts`, hanya untuk pesan yang persis sama; jangan menambah filter lain di sana tanpa catatan.
- `design/tools/render/` masih meng-import three dan playwright dari `/var/www/THREE.Terrain` dan `/var/www/ai-team`.
  Hanya untuk aset desain; app memakai `server/render/` (sudah di-port di Tahap 2). Adegannya berkabut (2,2–5,0 m):
  `margin` besar menjauhkan kamera sampai model hilang. Untuk model yang tampak lebih kecil, lebarkan `fov`
  (contoh `jobs-1024.json`).
- Build E2E (`NODE_ENV=test`) dan `bun run dev` memakai React development + StrictMode, dan R3F 9 meneruskan StrictMode
  ke pohon kanvas: cleanup lalu efek ulang berjalan sinkron dalam satu commit. Objek hasil render (GLTF dari
  `useGLTF`, material) dibuang lewat `hold`/`holdCached` (`web/features/viewer/lifetime.ts`). Jangan `dispose()` atau
  `useGLTF.clear` langsung di cleanup: model hilang dan viewer memuat ulang tanpa henti.
- Kamera R3F `manual`: `setViewOffset` mengatur `aspect` ke ukuran bidang penuh, sedangkan `clearViewOffset` tidak.
  Aspect dikembalikan sendiri (`web/features/viewer/camera.ts`).
- three memanggil `forceContextLoss()` saat renderer dibuang. Pada konteks yang sudah hilang, panggilan itu memunculkan
  warning "WEBGL_lose_context extension not supported", jadi viewer menjadikannya no-op setelah `webglcontextlost`.
  Event dari kanvas yang sudah dilepas bisa datang setelah viewer dipasang ulang → abaikan.
- Kanvas WebGL menutupi outline induknya: wadah diberi `isolate` dan kanvas `-z-1`, supaya cincin fokus tergambar.
- Chromium headless memakai SwiftShader secara bawaan. Dengan `--use-angle=gl-egl`, Chromium memakai GPU mesin ini
  (Radeon 780M), misalnya untuk mengukur FPS. E2E dan golden tetap memakai SwiftShader supaya deterministik.
- Bentuk dasar diekspor tanpa UV (`export_texcoords` mengikuti material), jadi mode UV viewer nonaktif di review
  bentuk dasar.
- `.blend` bisa membawa kode yang berjalan saat dibuka di Blender desktop: teks `use_module` dan driver `SCRIPTED`
  (juga di node tree material). Driver biasa (AVERAGE dan sejenisnya) tidak menjalankan Python. `save_blend`
  (`_strip_python` di `runtime/assetkit/assetkit/io.py`) membuang **semua** datablock teks dan semua driver `SCRIPTED`
  sebelum menyimpan.

**Web**
- Token memakai `@theme static`, bukan `@theme inline`: `inline` menanam nilai tema gelap ke kelas utilitas, sehingga
  tema terang tidak berlaku.
- `--text-*: initial` membuang ukuran teks bawaan Tailwind (`text-sm`, `text-xl`, …). Pakai text style FigCraft
  (`text-body`, `text-label`, …). Komponen pihak ketiga yang memakai kelas bawaan (mis. heading streamdown) perlu
  dipetakan ke text style.
- shadcn CLI 4.23 menulis `import { cn } from "cn"` (paket npm `cn`). Ambil sumber komponen lewat
  `bunx shadcn add <nama> --view`, lalu ganti import-nya ke `@/lib/utils.ts`. Jangan memasang paket `cn`.
- Teks khusus halaman uji ada di `tSmoke`, terpisah dari `t`, supaya tidak ikut ke build produksi.
- Radix RadioGroup memilih item saat fokus pindah karena tombol panah, dan fokusnya dipindah lewat `setTimeout`. Tes
  menahan tombol sampai pilihan berubah: user-event `{ArrowRight>}` → `waitFor` → `{/ArrowRight}`; Playwright
  `keyboard.down` → `expect` → `keyboard.up`.
- Menu Radix yang modal memberi `aria-hidden` pada seluruh app (axe `aria-hidden-focus`, serius). `Menu` di
  `web/components/ui/menu.tsx` tidak modal secara bawaan; jangan diubah tanpa tes axe.
- Teks `text/tertiary` di atas `bg/active` di bawah AA (4,15 gelap / 4,35 terang). Baris aktif (mis. versi terpilih)
  memakai `text/secondary`.
- **Cincin fokus** hanya dari aturan global `:focus-visible` di `web/styles/globals.css`; komponen hanya mengubah
  jaraknya (`focus-visible:outline-offset-1`). Jangan memberi `outline-none` pada elemen interaktif: di Tailwind 4
  kelas itu mengisi `--tw-outline-style: none`, dan `focus-visible:outline-2` pun tidak menggambar apa-apa. E2E
  `focusRingProblems` memeriksa gaya dan piksel cincin di setiap pemberhentian Tab.
- Chromium menganggap fokus skrip Radix (menu dibuka dengan mouse, fokus kembali ke pemicu) `:focus-visible`. Karena
  itu tooltip memutuskan buka-saat-fokus dari interaksi terakhir yang dicatat `TooltipProvider`. Radix Tooltip
  menggabungkan `aria-describedby` pemicu dengan id isinya, jadi mengoper `undefined` tidak menghapusnya.
- happy-dom: `focus()` pada `input[type=hidden]` dan elemen `display:none` tetap berhasil, dan `:focus-visible` cocok
  untuk fokus apa pun. Perilaku yang bergantung pada keduanya diuji di Chromium.
- CSS sonner disisipkan tanpa layer setelah stylesheet app (`outline: 0` pada toast). Penimpaannya juga di luar layer,
  dengan selektor lebih spesifik (`[data-sonner-toaster] [data-sonner-toast]`).
- Timer di E2E (jeda tooltip, Radix mengembalikan fokus lewat `setTimeout`) dimajukan dengan `page.clock.install` +
  `pauseAt` + `runFor`, bukan sleep.
- `rerender` Testing Library pada pohon dari `renderUi` mengganti pembungkusnya, sehingga komponen dipasang ulang.
  Tes state lintas prop memakai `render` langsung.
- `box-shadow` Tailwind 4 berlapis (`--tw-*-shadow`): gaya terhitung memuat lapisan transparan, jadi cek dengan
  `toContain`. Kelas varian (`hover:`, `data-[state=…]:`) dibuktikan lewat gaya terhitung di E2E, bukan string kelas.
- Chromium headless dengan `deviceScaleFactor` emulasi menggambar kotak di posisi px CSS bulat: elemen di x 15,5
  tergambar di 16 walaupun `boundingBox()` = 15,5. Geometri dibandingkan lewat `boundingBox()`, bukan piksel.
- Bandingkan screenshot dengan ekspor FigCraft secara wajar: lebar kotak teks FigCraft dibulatkan ke atas dan
  rasterisasi teks berbeda, sehingga teks bisa bergeser ≤1,5 px.
  Selisih ini menumpuk di baris berteks: toolbar viewer 574 px vs 577 px di desain.
- Radix mengembalikan fokus ke pemicu menu, dan memindah fokus roving (Toolbar, gizmo), lewat `setTimeout`. Tes menunggu
  `toBeFocused()` sebelum membuka menu lagi atau menekan panah berikutnya; tanpa itu menu langsung tertutup.
- Playwright menganggap `aria-disabled="true"` nonaktif, jadi `click()` menunggu sampai timeout. Buktikan klik
  diabaikan dengan `toBeDisabled()` lalu `click({ force: true })`.
- `Tooltip` membungkus pemicu lewat Slot, dan prop pemicu tooltip menimpa prop yang sama milik pemicu Radix lain di
  dalamnya. `TriggerSlot` membuang `aria-describedby` dan `data-state` tooltip. Gaya terbuka pemicu menu memakai
  `data-[state=open]`.
- Bayangan tooltip di sisi kiri/kanan menggelapkan sisi cincin fokus pemicunya di tema gelap. Tombol di tepi panel
  memakai `tooltipSide="bottom"`.
- Event keyboard dari portal Radix (mis. menu toolbar viewer) ikut naik ke `onKeyDown` leluhurnya di pohon React,
  walau di DOM berada di `<body>`. Handler pintasan menyaring target menu (`isTypingTarget`).
- Biome menolak `role="group"` pada `div` (`useSemanticElements`) → `fieldset` berlabel. `tabIndex` pada wadah
  `role="application"` butuh `biome-ignore` beralasan.
- lucide-react 1.72 menggambar sebagian ikon berbeda dari komponen `Icon/*` FigCraft (mis. `axis-3d`). Bandingkan ikon
  baru dengan desain. Bila berbeda, tulis geometri desain lewat `createLucideIcon` (`web/features/viewer/icons.ts`).
- react-dropzone 20 menangani paste di elemen root. Composer menangani tempel sendiri, jadi dropzone memakai
  `noPaste: true`; tanpa itu Ctrl+V menambah lampiran dua kali.
- streamdown 2.7: harden bawaannya mengizinkan gambar dari mana saja (termasuk `data:`), dan isi yang diblok tampil
  "[blocked]" berbahasa Inggris dengan kelas warna mentah. Konfigurasi sendiri ada di `web/components/Markdown.tsx`;
  jangan memakai `<Streamdown>` langsung.
- Biome `noLabelWithoutControl` tidak mengenali komponen input buatan sendiri: pakai `<label htmlFor>` ke id kontrolnya.
  `useIterableCallbackReturn` menolak `switch` di dalam `map` → pecah menjadi komponen (mis. `ThreadEntry`).
- Viewer: saat ganti versi, adegan lama tetap tampil sampai GLB baru dimuat. Test hook melapor `ready` hanya untuk file
  yang sedang diminta (`requestedSrc`), jadi menunggu `ready` setelah ganti versi tidak membaca adegan lama.
- `mockFetch(path, request)` (`web/test-utils.tsx`) meneruskan `Request`, jadi tes bisa membaca body (FormData unggahan).
- TanStack Query 5: `mutate(vars, { onSuccess, onError })` mengganti callback panggilan sebelumnya pada mutation yang
  sama, sehingga callback aksi yang masih berjalan tidak pernah dipanggil. Aksi yang bisa bertumpuk memakai
  `mutateAsync` dengan penanganan per panggilan, atau mutation terpisah (lihat `StudioSessionPage`).
- TanStack Query 5: refetch yang gagal tetap menyimpan `data` lama tetapi membuat `status: "error"`. Halaman error
  penuh hanya untuk `isLoadingError`; `isRefetchError` cukup toast.
- React: cleanup `useLayoutEffect` komponen yang dilepas berjalan sebelum elemennya dibuang dari DOM, jadi fokus masih
  terbaca di sana (dipakai `ReconnectBanner` untuk memindah fokus sebelum tombolnya hilang).
- Radio native: tombol panah memilih radio berikutnya dan memicu `change` (juga `click`). Spasi pada radio yang sudah
  terpilih tidak memicu apa-apa. Perilaku "pilih lalu pindah fokus" harus membedakan panah dari klik/Spasi (WCAG 3.2.2).
- Live region yang disisipkan bersama isinya sering tidak diumumkan pembaca layar. Pasang wadah `role="status"` sejak
  awal (kosong), lalu isi atau kosongkan isinya.
- Playwright `check()`/`click()` menuntut elemen itu sendiri yang menerima klik. Lapisan klik `label::after` (kartu dan
  baris aset) menutupi kotak centang yang ada sebelumnya di DOM, jadi kotak centang diberi `z-1`.
- Chromium mencatat "Failed to load resource" di console untuk fetch yang dijawab 4xx/5xx, walaupun app menangani
  error-nya, dan E2E menghitungnya sebagai masalah console. Jangan mengambil ulang sumber yang pasti tidak ada lagi
  (detail aset yang dihapus ditandai lewat `markAssetDeleted`).
- Screenshot Playwright berukuran piksel perangkat: dengan `deviceScaleFactor: 2` (mis. `shell.e2e.ts`), klip 1 piksel CSS
  menjadi gambar 2×2. Helper yang membaca piksel menghitung skala dari lebar gambar (`viewportPixels`).
- Chromium headless: `context.grantPermissions(["notifications"])` hanya mengubah Permissions API;
  `Notification.permission` tetap `"denied"`. E2E yang butuh izin notifikasi menimpa getter `Notification.permission`
  lewat `addInitScript`.
- Status kesehatan di E2E: akun palsu selalu login dan runtime fixture selalu siap. Banner akun/runtime diuji dengan
  `page.route("**/api/health/…")`; jawaban 200 (bukan 4xx) supaya console bersih.
- Info tier di composer memakai angka ringkas (`9k segitiga`), bukan `9.000`.
- Skia menghaluskan tepi dalam outline yang membulat (±97% warna cincin) walau posisinya bulat. Cek piksel cincin fokus
  membaca kedua piksel pita 2 px dan cukup satu yang sama persis (`focusRingProblem`).

**FigCraft**
- MCP FigCraft hanya jalan bila app FigCraft berjalan dengan port kontrol 47800. Bila muncul `CONNECTION_CLOSED`:
  1. jalankan `figcraft-live --automation-write-root /var/www/ai-asset-generate`;
  2. lalu `/mcp` → figcraft → Reconnect.
- Mengubah komponen tunggal menjadi set (`component.addVariant`) atau memanggil `instance.setProperties` pada instance
  bersarang menghapus override gambar → jalankan ulang `image.replace` pada instance yang terdampak.
- Hapus node dengan `edit.delete`; tidak ada `node.delete`.
- Menukar ikon di instance (swap ke `Icon/*`) memakai ukuran komponen ikon, 20 px. Setelah swap, kembalikan ukurannya
  ke spesifikasi tombol (14/16/18). Ketebalan garis ikon tetap ~1,46 px saat diubah ukurannya.
- Token berubah → simpan file, `variable.export {format:"json", path:"design/tokens/figcraft-variables.json"}`,
  `bun run tokens:sync`, lalu ekspor ulang PNG layar yang terdampak ke `design/exports/` (skala 2).
- Screenshot layer dirender di atas latar putih. Untuk PNG satu halaman, ekspor persegi latar yang dikunci di belakang konten.

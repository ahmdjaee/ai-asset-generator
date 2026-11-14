# Tech stack & hasil riset library

Hasil riset 13 Nov 2026 untuk **AI Asset Generate**: app lokal satu pengguna yang membuat aset 3D `.glb` lewat
Claude (sesi login Claude Code) dan Blender headless. Rencana kerjanya ada di [`PLAN.md`](PLAN.md), aturan agent di
[`../AGENTS.md`](../AGENTS.md).

**Aturan pakai dokumen ini**
- Versi di bawah dicek lewat `npm view` / PyPI pada 13 Nov 2026. Di Tahap 0, versi ini di-pin **persis** (tanpa `^`/`~`).
- Setiap upgrade atau tambahan dependensi wajib:
  1. memperbarui tabel di dokumen ini;
  2. mengisi bagian [Status kompatibilitas](#status-kompatibilitas);
  3. mencatat alasannya di Log keputusan `PLAN.md`.

## Gambaran arsitektur

```
Browser: React 19 + Vite + Tailwind 4 + shadcn/ui, viewer R3F/drei
   │ HTTP (client hc + TanStack Query)          │ WebSocket /api/ws (event live)
   ▼                                            ▼
Server: Bun + Hono, hanya 127.0.0.1:4340
   ├─ domain + services  — status aset, gerbang tahap, versi ─── bun:sqlite + Drizzle (data/app.db)
   ├─ agent              — Claude Agent SDK (sesi login), MCP in-process "forge"
   ├─ jobs               — 1 job berat sekaligus, pool maks. 2 proses Claude
   ├─ runtime            — docker run asset-forge: bpy 5.2 + assetkit + xatlas, --network none
   ├─ pipeline           — gltf-transform + meshoptimizer + sharp + gltf-validator
   └─ render             — Playwright Chromium + three (SwiftShader) → contact sheet, thumbnail, turntable
```

## Prinsip pemilihan
1. **Jangan membangun dari nol.** Pakai library open-source yang matang, aktif dirawat, dan berlisensi permisif
   (MIT, Apache-2.0, BSD, ISC).
2. **Fitur bawaan Bun didahulukan** bila sudah cukup: `bun test`, `bun:sqlite`, `Bun.spawn`, WebSocket native.
3. **Modul ai-team yang sudah terbukti dipakai ulang** (lihat [di bawah](#modul-yang-dipakai-ulang-dari-ai-team)).
   Modul-modul itu tidak bergantung pada Express.
4. **Satu alat untuk satu kebutuhan.** Library UI lain atau dependensi baru tidak ditambahkan tanpa alasan yang dicatat.
5. **Klaim API dicek langsung di paketnya**, bukan dari ingatan:
   - isi tarball drei dan Hono;
   - driver `bun-sqlite` Drizzle;
   - `sdk.d.ts` Agent SDK.

## Pilihan per lapisan

### Runtime, bahasa, dan tooling
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| Bun | 1.4.4 | MIT | Runtime server, package manager, test runner | Sudah terpasang di mesin |
| `typescript` | 7.0.2 | Apache-2.0 | Type-check (`tsc --noEmit`) | Compiler native (Go), 8–12× lebih cepat. Belum punya API programatik, sehingga alat berbasis API TS tidak dipakai |
| `@biomejs/biome` | 2.6.7 | MIT / Apache-2.0 | Lint + format | Pengganti ESLint + Prettier; tidak butuh API TS |
| `lefthook` | 2.2.2 | MIT | Git hooks | pre-commit: Biome + typecheck; pre-push: tes |
| `@types/bun` | 1.4.4 | MIT | Tipe Bun | |

### Server
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `hono` | 4.13.18 | MIT | Router HTTP di `Bun.serve` | Client RPC `hc` bertipe (`hono/client`) |
| `@hono/bun` | 1.0.1 | MIT | Adapter Bun resmi untuk Hono: `upgradeWebSocket`, `websocket`, `serveStatic`, `getConnInfo` | Pengganti `hono/bun`, yang sudah deprecated dan akan dihapus di Hono v5. Handler `websocket`-nya tidak meneruskan event `drain` (lihat Status kompatibilitas) |
| `@hono/zod-validator` | 0.9.1 | MIT | Validasi request | Peer: `zod ^3.25 \|\| ^4`, `hono >=4.11.2` |
| `zod` | 4.6.7 | MIT | Skema di semua batas | Dipakai bersama server dan web; juga peer dependency Agent SDK |
| `drizzle-orm` | 0.45.4 | Apache-2.0 | Query bertipe di `bun:sqlite` | Driver `drizzle-orm/bun-sqlite` + `migrator` tersedia |
| `drizzle-kit` | 0.31.11 | MIT | Membuat migrasi SQL | Hanya `generate`; migrasi dijalankan app saat start |
| `pino` | 10.4.0 | MIT | Log terstruktur | Dibaca lewat journald saat berjalan sebagai service |
| `fflate` | 0.8.3 | MIT | ZIP (unduh massal, preset Sumber) | Streaming |

### Claude
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.323 | Ketentuan Anthropic (lihat README paket) | Sesi Claude memakai login Claude Code, tanpa API key | ai-team memakai 0.3.310. Opsi yang dipakai sudah dicek di `sdk.d.ts` (lihat di bawah) |
| `@anthropic-ai/sdk` | 1.8.0 | Apache-2.0 | Peer dependency Agent SDK (tipe pesan) | |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | Peer dependency Agent SDK | Juga dipakai di tes: tool `forge` dipanggil lewat `InMemoryTransport` |

Opsi `query()` yang terbukti ada di `sdk.d.ts`:
- **Tool:** `tools` (allowlist), `allowedTools` / `disallowedTools`, `canUseTool`, `hooks`.
- **MCP:** `mcpServers` (dengan `alwaysLoad`, `timeout`), `strictMcpConfig`.
- **Konfigurasi sesi:** `settingSources`, `settings`, `systemPrompt` (preset `claude_code` + `append`), `env` (mengganti seluruh env).
- **Lokasi:** `cwd`, `additionalDirectories`.
- **Model dan thinking:** `model`, `effort`, `thinking` (`{type: "adaptive", display: "summarized" | "omitted"}`).
- **Batas:** `maxTurns`, `maxBudgetUsd`.
- **Sesi:** `includePartialMessages`, `resume`, `persistSession`, `abortController`.

Pada objek `Query`: `interrupt()`, `accountInfo()`, `supportedModels()`.

Ekspor tambahan: pesan `rate_limit_event` dan konstanta `USAGE_LIMIT_ERROR_PREFIXES`.

### Runtime 3D (di dalam container Docker)
| Komponen | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| Docker Engine | 29.7.2 | Apache-2.0 | Sandbox | Dipanggil lewat CLI dengan `Bun.spawn` (argumen array), tanpa dockerode |
| `python:3.13-slim` | 3.13 (`sha256:e48f59cd…ed90`) | PSF | Image dasar | Di-pin dengan digest. Library sistem untuk wheel bpy (hasil `ldd`): `libgl1 libsm6 libx11-6 libxfixes3 libxi6 libxkbcommon0 libxrender1` |
| `bpy` (Blender sebagai modul Python) | **5.2.4** | GPL-3.0 | Pemodelan, UV, bake Cycles CPU, ekspor glTF | Blender 5.2 = LTS 2026, didukung sampai Jul 2028. Wheel hanya untuk CPython 3.13 (manylinux_2_28 x86_64, ±403 MB) |
| `xatlas` | 0.0.11 | MIT | UV atlas | Lebih rapi daripada Smart UV Project untuk aset game |
| `numpy` | 2.5.4 | BSD-3 dkk. | Kebutuhan bpy/xatlas | Semua paket Python (termasuk dependensi turunan) di-pin exact di `runtime/requirements.txt` |
| `pytest` | 9.2.0 | MIT | Tes `assetkit` di dalam image | |
| `assetkit` | (milik proyek) | — | Helper Python di atas bpy | Lapisan stabil supaya skrip Claude tidak rapuh antar-versi Blender |

**Cadangan Blender**
- Bila glTF exporter atau bake Cycles bermasalah dalam mode modul: tarball resmi `blender-5.2.4-linux-x64` (`blender -b -P`).
- Bila Claude kesulitan dengan API 5.x: Blender 4.5 LTS (didukung sampai Jul 2027; `bpy==4.5.x` di Python 3.11).
- Keputusan dicatat di Log keputusan.

### Pipeline glTF dan render
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `@gltf-transform/core`, `/functions`, `/extensions` | 4.5.1 | MIT | Optimasi: dedup, weld, simplify, prune, tekstur, meshopt | |
| `meshoptimizer` | 1.3.0 | MIT | Simplify + kompresi `EXT_meshopt_compression` | |
| `sharp` | 0.35.5 | Apache-2.0 | Resize/re-encode gambar & tekstur, WebP, contact sheet | |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 | Validasi resmi Khronos | Jalankan **sebelum** kompresi meshopt |
| `playwright` | 1.65.0 | Apache-2.0 | Chromium headless (SwiftShader) untuk render | Satu browser hidup lama, halaman dipakai ulang |
| `three` | 0.187.0 | MIT | Scene render headless, sama dengan viewer | |
| `pixelmatch` | 8.0.0 | ISC | Tes golden image (render pipeline dan viewer) | PNG di-decode dengan sharp. `pngjs` dihapus dari dependensi langsung di Tahap 8; paket itu tetap terpasang sebagai dependensi pixelmatch |

### Web UI
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `react`, `react-dom` | 19.3.1 | MIT | UI | Tipe: `@types/react`, `@types/react-dom` 19.3.0 |
| `vite` + `@vitejs/plugin-react` | 8.3.8 + 6.3.0 | MIT | Dev server dan build | Sama dengan ai-team |
| `tailwindcss` + `@tailwindcss/vite` | 4.3.5 | MIT | Styling dengan token | Tanpa file config; token di CSS (`@theme`) |
| `shadcn` (CLI) + `radix-ui` | 4.23.0 + 1.8.1 | MIT | Komponen aksesibel: Dialog, Menu, Tooltip, RadioGroup (Segmented), Toolbar (gizmo sumbu), Popover, Tabs, Checkbox… | Kode komponen masuk repo (`web/components/ui`) dan di-style dengan token FigCraft. CLI 4.23 menulis `import { cn } from "cn"` (paket npm `cn`); di proyek ini diganti `@/lib/utils.ts`, yang mengenal token FigCraft. Paket `cn` tidak dipasang |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | 0.7.1, 2.1.1, 3.7.0, 1.4.0 | Apache-2.0 / MIT | Pendukung shadcn | |
| `lucide-react` | 1.72.0 | ISC | Ikon | Ikon di desain memang Lucide (mis. `rotate-3d`, `axis-3d`). Dipasang lewat `LucideProvider` (`strokeWidth={1.5}` + `nonScalingStroke`): garis 1,5 px di semua ukuran, sama dengan FigCraft |
| `sonner` | 2.0.8 | MIT | Toast | |
| `react-dropzone` | 20.2.0 | MIT | Drag & drop lampiran | Tempel gambar (Ctrl+V) ditangani handler kecil di composer, dengan `noPaste: true`: dropzone 20 juga menangani paste di root, sehingga tanpa itu lampiran masuk dua kali |
| `streamdown` | 2.7.1 | Apache-2.0 | Markdown untuk teks Claude yang sedang di-stream | Aman (sanitize/harden). Butuh `@source` Tailwind dan `streamdown/styles.css`; tanpa plugin code/math/mermaid. Heading-nya memakai ukuran teks bawaan Tailwind yang sudah diganti token, jadi elemen markdown dipetakan ke text style (`.markdown` di `web/styles/globals.css`, Tahap 9) |
| `rehype-harden` | 1.1.9 | MIT | Konfigurasi harden untuk markdown Claude (`web/components/Markdown.tsx`) | Sudah dependensi streamdown (`^1.1.8`, satu salinan di `bun.lock`); di-pin langsung supaya plugin-nya bisa diimpor dengan opsi sendiri (Tahap 9) |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | Font Inter lokal | Tanpa CDN |
| `@tanstack/react-query` | 5.107.1 | MIT | Data server, cache, invalidasi | Diinvalidasi oleh event WebSocket |
| `react-router` | 8.5.1 | MIT | Routing (Studio, Gudang, Detail, Pengaturan) | |

### Viewer 3D
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `three` + `@types/three` | 0.187.0 | MIT | Renderer WebGL | Browser memakai iGPU AMD mesin ini |
| `@react-three/fiber` | 9.8.2 | MIT | React renderer untuk three | Versi 9 untuk React 19. Masih membuat `THREE.Clock` (deprecated sejak three r183), jadi peringatannya disaring di `web/lib/three-console.ts` |
| `@react-three/drei` | 10.7.9 | MIT | Helper siap pakai | Sudah ada `CameraControls`, `GizmoHelper`, `GizmoViewport`, `Bounds`, `Grid`, `Environment`, `ContactShadows`, `Wireframe`, `useGLTF` (meshopt). `Bounds` tidak bisa dipakai bersama `CameraControls`; bingkai model lewat `CameraControls.fitToBox`. Viewer Tahap 8 hanya memakai `CameraControls` dan `useGLTF`. Gizmo sumbu adalah tombol DOM (Radix Toolbar) supaya bisa dipakai dengan keyboard; grid lantai memakai shader sendiri |

### Tes dan kualitas
| Paket | Versi | Lisensi | Peran | Catatan |
|---|---|---|---|---|
| `bun test` | (Bun) | MIT | Unit dan integrasi | Cakupan lewat `--coverage` + ambang di `bunfig.toml` |
| `@happy-dom/global-registrator` | 21.0.4 | MIT | DOM untuk tes komponen | Preload **hanya** untuk tes web, karena preload ini mengganti global seperti `fetch` |
| `@testing-library/react` + `user-event` | 16.3.3 + 14.6.10 | MIT | Tes komponen lewat role/nama | |
| `@playwright/test` | 1.65.0 | Apache-2.0 | E2E | Dijalankan dengan Node, bukan `bun --bun` |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | Audit aksesibilitas | Hanya dev dependency |

### Aset CC0 dan token desain
| Sumber | Lisensi | Dipakai untuk | Catatan |
|---|---|---|---|
| ambientCG (API v3) | CC0 | Pustaka material PBR lokal: kayu, logam, batu, kain, plastik… | ±60 material terkurasi, 1K/2K, diunduh **sekali** lewat `bun run textures:sync` ke `data/library/materials/`. API v3 aktif (2.934 aset) |
| Poly Haven (HDRI) | CC0 | Cadangan pencahayaan viewer dan render (1–2 file HDRI 1K) | **Belum dipakai.** Renderer (sejak Tahap 2) dan viewer (Tahap 8) memakai `RoomEnvironment` three, yang dibuat lokal sebagai PMREM tanpa file dan tanpa CDN. HDRI dipertimbangkan lagi bila mode Tekstur butuh pantulan yang lebih kaya. Bila dipakai: unduh manual dari situs; API Poly Haven **tidak** dipakai karena syarat penggunaan komersialnya belum konsisten antar-halaman resmi |
| FigCraft `variable.export` | — | Token warna Gelap/Terang (koleksi Theme, 32 warna) | Ekspor JSON disimpan di repo, lalu `scripts/sync-tokens.ts` memetakannya ke `web/styles/tokens.css` dengan nama semantik (`--color-bg-app`, `--color-text-primary`, `--color-border-strong`, `--color-axis-x`, …) |

## Dipertimbangkan, tidak dipakai
| Opsi | Alasan |
|---|---|
| Express 5 (dipakai ai-team) | Hono lebih ringan di Bun, punya RPC bertipe, validator, dan helper WebSocket Bun. Modul ai-team yang dipakai ulang tidak bergantung pada Express |
| Elysia | Hanya berjalan di Bun; ekosistem lebih kecil |
| Next.js / Remix / SSR | Tidak diperlukan untuk app lokal satu pengguna |
| Dev server HTML bawaan Bun | Vite lebih matang (plugin Tailwind/React, ekosistem R3F) |
| `<model-viewer>` | Tidak punya mode Clay, Wireframe, UV, dan Normal, serta tidak punya kontrol gizmo sesuai desain |
| Babylon.js | R3F lebih menyatu dengan React; GLB tetap kompatibel dengan Babylon |
| Redis / BullMQ | Berlebihan; antrean in-process dengan semaphore ai-team sudah cukup |
| Prisma | Lebih berat; Drizzle + `bun:sqlite` sudah cukup |
| JSON/JSONL saja (pola ai-team) | Gudang butuh cari/filter/urut, dan status + event perlu satu transaksi. SQLite bawaan Bun |
| ESLint, typescript-eslint, knip | Butuh API programatik TypeScript yang belum ada di TS 7.0 |
| Storybook | Desain sudah ada di FigCraft. Komponen diuji lewat tes komponen + axe |
| Model AI 3D lokal (TRELLIS, Hunyuan3D-2, TripoSR) | Butuh GPU NVIDIA/CUDA; mesin ini memakai iGPU AMD. Keputusan mesin: Claude + Blender |
| BlenderMCP (`ahujasid/mcp-for-blender`, MIT) | Menjalankan kode di Blender GUI tanpa sandbox. Hanya acuan desain tool |
| Draco | Decoder bawaan drei diambil dari CDN; meshopt sudah cukup |
| KTX2 (toktx) | Butuh biner KTX-Software. Opsi setelah rilis |
| dockerode | CLI `docker` dengan argumen array lebih sederhana dan mudah di-snapshot |

## Acuan ide (bukan dependensi)
- **LL3M** (`threedle/ll3m`) dan **SceneCraft**: LLM menulis kode Blender, lalu memperbaikinya dari render (loop
  kritik visual). Polanya masuk ke system prompt: build → lihat contact sheet → bandingkan dengan brief → perbaiki.
- **Infinigen** (`princeton-vl/infinigen`, BSD-3): generator prosedural (pohon, batu, furnitur). Kandidat setelah rilis.

## Modul yang dipakai ulang dari ai-team
Disalin lalu disederhanakan, bukan di-import lintas proyek. Lokasi asal di `/var/www/ai-team`.

| Asal | Dipakai untuk | Penyesuaian |
|---|---|---|
| `server/config.ts` → `agentEnv()` | Env proses Claude tanpa API key | Tambah `CLAUDE_AGENT_SDK_CLIENT_APP` |
| `server/routes/health.ts` | Cek login (`accountInfo()`) tanpa memanggil model | Pindah ke rute Hono |
| `server/agent/runner.ts` (`TaskRunner`) | Input streaming, jembatan AskUserQuestion, resume, interrupt, idle shutdown, quirks SDK | Tanpa role/workspace. Constructor parameter properties ditulis ulang (`erasableSyntaxOnly`). Tambah pool proses dan pilih banyak |
| `server/agent/events.ts` | Pesan SDK → event UI | Tambah ringkasan berpikir dan progres build |
| `server/agent/bus.ts`, `semaphore.ts` | Bus event dan antrean | Penyimpanan event di SQLite |
| `server/realtime.ts` | Protokol WebSocket (sub/unsub, replay `after`, resync, heartbeat, backpressure) | Di atas `@hono/bun`, bukan `ws` |
| `server/http-guard.ts` | Pagar Host/Origin | Middleware Hono, juga sebelum upgrade WebSocket |
| `scripts/check-runner.ts` | `FakeQuery` untuk tes | Dijadikan driver palsu + DSL skenario |
| `web/realtime.ts`, `web/useTaskThread.ts`, `web/theme.ts` | Koneksi live, merge event berdasarkan seq, tema tanpa kedip | Data lewat TanStack Query |
| `web/components/Cards.tsx` (`QuestionCard`) | Kartu pertanyaan | Tambah pilih banyak + "Lainnya" |
| `deploy/ai-team.service` | systemd user unit | `PATH` wajib memuat `~/.local/bin` |

## Status kompatibilitas
Diisi dan dibuktikan di **Tahap 0** (dan setiap upgrade). Format: `[x] tanggal — hasil singkat`.

**Toolchain**
- [x] 13 Nov 2026 — TS 7.0.2: `tsc -p tsconfig.server.json` dan `tsc -p tsconfig.web.json` lolos dengan `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Tipe `bun` dan `vite/client` bisa dipakai
  bersama. `tsconfig.json` menjadi basis (bukan `tsconfig.base.json`), karena Bun dan shadcn CLI membaca file itu.
- [x] 13 Nov 2026 — Biome 2.6.7:
  - `globals.css` dengan `@import`, `@source`, `@apply`, dan `@theme` terbaca (`css.parser.tailwindDirectives`);
  - file probe membuktikan aturan yang menangkap kasus uji: `noFloatingPromises` (`simpan();` ditandai,
    `void simpan().catch(…)` tidak), `noExplicitAny`, dan larangan `process`/`Bun` di `web/`;
  - `recommended: true` sudah deprecated, diganti `preset: "recommended"` (`biome migrate`);
  - Biome 2.6 ikut memformat Markdown, jadi `*.md` dikecualikan.

**Web**
- [x] 13 Nov 2026 — Vite 8.3.8 (Rolldown): `build` dan `build --mode test` tanpa warning export yang hilang.
  - Chunk 3D (three + R3F + drei) ±980 kB dimuat lazy, jadi `chunkSizeWarningLimit` dinaikkan ke 1200 kB.
  - Build produksi tidak memuat halaman `/_smoke`, baik kode maupun teksnya.
- [x] 13 Nov 2026 — R3F 9.8.2 + React 19.3: console bersih di StrictMode (Vite dev) dan di build test, kedua tema.
  - R3F masih membuat `THREE.Clock`, yang deprecated sejak three r183, sehingga setiap `<Canvas>` memunculkan warning.
    Pesan itu (dan hanya itu) disaring lewat `setConsoleFunction` three di `web/lib/three-console.ts`.
  - Dispose diuji di Tahap 8 lewat event `dispose` three (`materials.test.ts`, `lifetime.test.tsx`), termasuk siklus
    efek StrictMode: R3F 9 meneruskan StrictMode ke pohon kanvas, jadi objek hasil render dibuang lewat penghitung
    pemakai (`web/features/viewer/lifetime.ts`), bukan langsung di cleanup efek.
- [x] 13 Nov 2026 — drei 10.7.9: E2E memastikan tidak ada permintaan ke luar localhost. Preset `Environment` dan Draco
  tidak dipakai.
  - `GizmoHelper` mendukung `CameraControls` (`getTarget`/`setPosition`).
  - `Bounds` **tidak**: ia memanggil `controls.target.copy()`, yang membuat error di setiap frame. Viewer memakai
    `CameraControls.fitToBox`.
- [x] 14 Nov 2026 — Viewer Tahap 8 (three 0.187 + R3F 9.8.2 + drei 10.7.9):
  - E2E + golden 7 sudut × 2 tema lolos di SwiftShader; 0 frame saat diam; console bersih; tanpa permintaan keluar.
  - FPS di GPU mesin ini (Radeon 780M lewat ANGLE GL-EGL, Chromium headless, putar otomatis): 60 fps di DPR 1 dan 2,
    untuk bentuk dasar maupun aset final bertekstur.
  - `bun test` memuat `main` CJS drei (paket tanpa `exports`), yang me-`require` R3F dan three versi CJS, sehingga tes
    web mencetak `DeprecationWarning [THREE_CJS_DEPRECATED]` sekali per proses. Plugin runtime Bun (`onResolve`,
    `onLoad`) di preload tidak mengubah resolusi ini. Build Vite memakai ESM (tanpa peringatan).
- [x] 13 Nov 2026 — streamdown 2.7.1 dengan `@source` + `streamdown/styles.css` (di `@layer components`): heading,
  paragraf, tebal, dan list tampil. Ukuran heading memakai kelas bawaan Tailwind yang sudah diganti token, jadi
  elemen markdown dipetakan ke text style di Tahap 9.
- [x] 14 Nov 2026 — streamdown 2.7.1 + rehype-harden 1.1.9: bawaan streamdown memasang harden dengan
  `allowedImagePrefixes: ["*"]` dan `allowDataImages: true`, jadi gambar markdown dari mana saja dimuat dari jaringan,
  dan isi yang diblok tampil sebagai "[blocked]" berbahasa Inggris dengan kelas warna mentah. `Markdown.tsx` memasang
  ulang `raw` + `sanitize` bawaan dan harden sendiri: tautan bebas (protokol berbahaya tetap diblok), gambar jarak jauh
  dan `data:` diblok dengan kebijakan `text-only` (`web/components/Markdown.test.tsx`).
- [x] 13 Nov 2026 — shadcn CLI 4.23: `add button --dry-run` membaca `components.json` dengan benar
  (`web/components/ui/button.tsx`). CLI menulis `import { cn } from "cn"` (paket npm `cn`) tanpa opsi untuk
  mematikannya, jadi komponen disalin dari `--view` dan import-nya diganti `@/lib/utils.ts`.

**Server**
- [x] 13 Nov 2026 — Hono WebSocket di Bun (`@hono/bun` 1.0.1):
  - pagar Host/Origin berjalan sebelum upgrade: handshake dari Origin asing ditolak (tes integrasi);
  - `maxPayloadLength` 64 KB: pesan yang lebih besar menutup koneksi (tes integrasi);
  - `idleTimeout` HTTP 120 dtk dipasang di `Bun.serve`;
  - backpressure → **Tahap 6**: handler `websocket` dari `@hono/bun` hanya meneruskan `open`/`message`/`close`, tanpa
    `drain`. Hub Tahap 6 menambah handler `drain` sendiri pada objek `websocket` dan membaca nilai balik `send()`
    (`-1` berarti backpressure).
- [x] 13 Nov 2026 — Drizzle 0.45.4 + `bun:sqlite`: migrasi berjalan saat start dan aman dijalankan ulang;
  `journal_mode=wal`, `foreign_keys=1`, dan `busy_timeout=5000` terbukti lewat `PRAGMA`; transaksi sinkron di-rollback
  saat error.
- [x] 13 Nov 2026 — Semua paket server ter-import di Bun dan menjalankan satu operasi kecil
  (`tests/smoke/imports.test.ts`):
  - GLB dari gltf-transform lolos gltf-validator dengan 0 error;
  - kompresi meshopt terbaca ulang (butuh `KHR_mesh_quantization` ikut terdaftar);
  - sharp mengubah PNG ke WebP; fflate ZIP bolak-balik;
  - hono, drizzle, pino, zod, Agent SDK, dan MCP `InMemoryTransport` ter-import;
  - Chromium Playwright 1254 terpasang.

  `gltf-validator` tidak membawa tipe, jadi diberi deklarasi minimal di `server/types/gltf-validator.d.ts`.

**Claude**
- [x] 13 Nov 2026 — `bun run check:auth` lewat Agent SDK 0.3.323: email akun tampil, langganan terbaca,
  `apiProvider: firstParty`, tanpa memanggil model.
  - Untuk sesi login, SDK tidak mengisi `apiKeySource` sama sekali (bukan `"none"`). Skrip menampilkannya sebagai
    `none (tidak dilaporkan SDK)` dan gagal bila SDK melaporkan sumber API key apa pun.

**Tes**
- [x] 13 Nov 2026 — Playwright Test 1.65 (Node) + Chromium SwiftShader, `e2e:smoke` 8/8 lolos di kedua tema:
  - kanvas WebGL tidak kosong (cek piksel lewat sharp);
  - axe 0 masalah serius/kritis;
  - console tanpa error/warning.
- [x] 13 Nov 2026 — `bun test` + happy-dom 21 + Testing Library: 42 tes web lolos, termasuk keyboard pada toggle tema.
  `fetch` di-mock dengan `spyOn`; tipe `fetch` Bun mewajibkan properti `preconnect`.

**Runtime 3D** (Tahap 1)
- [x] `bpy==5.2.4` di container: glTF exporter dan bake Cycles CPU berjalan dalam mode modul (Tahap 1, probe di
  `runtime/probes/`). Tarball Blender tidak diperlukan

## Catatan lisensi
- **Blender / `bpy` (GPL):** aman untuk pemakaian lokal. Aset yang dihasilkan bukan karya turunan GPL. Bila kelak
  `assetkit` (yang meng-import `bpy`) didistribusikan, ia ikut GPL.
- **Agent SDK:** tunduk pada ketentuan Anthropic. Login langganan Claude hanya untuk pemakaian pribadi. Bila app kelak
  publik atau multi-pengguna, harus pindah ke API key.
- **Material ambientCG dan HDRI Poly Haven:** CC0, tanpa kewajiban atribusi.
- **`@axe-core/playwright` (MPL-2.0):** hanya dev dependency.

## Sumber
- Status LTS Blender: [endoflife.date/blender](https://endoflife.date/blender),
  [Evolutions to Blender Release Cycle](https://devtalk.blender.org/t/evolutions-to-blender-release-cycle/44253)
- `bpy` di PyPI: <https://pypi.org/project/bpy/>
- TypeScript 7.0: [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7.0/)
- API ambientCG: <https://docs.ambientcg.com/api/v2/> (v2 dibekukan; gunakan v3: `https://ambientcg.com/api/v3/assets`)
- Syarat API Poly Haven: [polyhaven.com/our-api](https://polyhaven.com/our-api),
  [Poly-Haven/Public-API](https://github.com/Poly-Haven/Public-API), [polyhaven.com/corporate](https://polyhaven.com/corporate)
- Acuan ide: [LL3M](https://github.com/threedle/ll3m), [SceneCraft](https://alphaxiv.org/abs/2403.01248),
  [planner–actor–critic dengan BlenderMCP](https://arxiv.org/html/2601.05016v1),
  [Infinigen](https://github.com/princeton-vl/infinigen)
- Paket npm: `npm view <paket> version license` pada 13 Nov 2026

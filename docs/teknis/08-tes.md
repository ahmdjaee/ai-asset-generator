# Tes

Lapisan tes, perintahnya, driver palsu, dan cara menambah tes baru tanpa memakai kuota Claude atau Docker.

## Lapisan tes
Ringkasan resminya ada di [PLAN §6](../PLAN.md#6-strategi-tes); perintah lengkap di
[AGENTS §12](../../AGENTS.md#12-perintah). Skrip di bawah berasal dari `package.json`.

| Lapisan | Lokasi | Perintah | Kapan |
|---|---|---|---|
| Unit & integrasi server/shared | `*.test.ts` di samping kode (`server/`, `shared/`, `scripts/`), `tests/smoke/`, `tests/architecture/` | `bun run test:server` | Setiap perubahan |
| Komponen web | `web/**/*.test.ts(x)` | `bun run test:web` (preload happy-dom) | Setiap perubahan |
| Cakupan | `server/domain`, `server/agent` | `bun run test:coverage` | Bagian dari `check` |
| E2E + aksesibilitas | `tests/e2e/*.e2e.ts` | `bun run e2e` / `e2e:smoke` (tag `@smoke`) | Perubahan UI; DoD |
| Alur API penuh | `tests/e2e-api/flow.test.ts` | `bun run e2e:api` | DoD |
| Renderer & golden | `tests/pipeline/` | `bun run test:pipeline` (butuh Chromium) | Perubahan `server/render/` |
| `assetkit` | `runtime/tests/` (pytest) | `bun run test:assetkit` (di dalam image) | Perubahan `runtime/` |
| Runtime nyata | `tests/integration/runtime/` | `RUNTIME_IT=1 bun test tests/integration/runtime` | DoD tahap terkait |
| Evaluasi Claude | `scripts/eval-base.ts`, `scripts/eval-texture.ts` → `eval/runs/` | `bun run eval:base` / `eval:texture` | **Hanya dengan izin pemilik** (memakai kuota) |

`bun run check` = `lint` + `typecheck` + `test` (`test:server` + `test:web`) + `test:coverage`. Wajib hijau sebelum
mencentang tugas. Hook git di `lefthook.yml`: Biome dan typecheck saat pre-commit, `bun run test` saat pre-push.

Tes runtime nyata dilewati (`describe.skipIf`) tanpa `RUNTIME_IT=1`; flag-nya dibaca di
`tests/integration/runtime/helpers.ts`.

## Matriks driver
Driver dipilih lewat env (`AGENT_DRIVERS`, `RUNTIME_DRIVERS` di `server/config.ts`) dan dirakit di `server/compose.ts`.

| | `RUNTIME_DRIVER=fixture` | `RUNTIME_DRIVER=docker` |
|---|---|---|
| `AGENT_DRIVER=fake` | Setiap perubahan: tes rutin, E2E, `e2e:api` | DoD tahap: `tests/integration/runtime/fake-agent.test.ts` (tanpa kuota) |
| `AGENT_DRIVER=sdk` | — | Uji nyata, **hanya dengan izin** |

- **`fake`:** `ScenarioAgentPort` ([`server/agent/scenario-port.ts`](../../server/agent/scenario-port.ts)) memutar
  skenario dari [`server/agent/scenarios.ts`](../../server/agent/scenarios.ts). Penanda di pesan memicu skenario khusus:
  `[tanya]`, `[tanya-banyak]`, `[macet]`, `[batas]`, `[mati]`, `[keluar]`.
- **`fixture`:** `FixtureAssetBuilder` ([`server/agent/forge/fixture-builder.ts`](../../server/agent/forge/fixture-builder.ts))
  mengambil GLB, contact sheet, dan turntable dari `tests/fixtures/`, tanpa Docker dan Chromium. Contact sheet fixture
  dirender ulang dengan `bun scripts/fixture-sheets.ts`.
- **Kontrak SDK:** `server/agent/contract.test.ts` memutar stream nyata yang direkam di `tests/fixtures/sdk/`.
  Upgrade SDK berarti merekam ulang fixture ini (lihat [Claude Agent](02-claude-agent.md)).
- Bawaan env adalah `sdk` × `docker`; tes dan `e2e` mengisi `fake` × `fixture` sendiri.

## Tes web dan happy-dom
- Preload [`tests/setup/happy-dom.ts`](../../tests/setup/happy-dom.ts) memasang DOM, lalu setelah tiap tes: `cleanup()`,
  `toast.dismiss()`, mengosongkan `localStorage`, dan membuang atribut tema.
- happy-dom mengganti global seperti `fetch`, jadi preload hanya untuk tes web. Satu file tes web:
  `bun test --preload ./tests/setup/happy-dom.ts web/<file>`.
- Helper di [`web/test-utils.tsx`](../../web/test-utils.tsx): `renderUi` (router + query client), `renderWithQuery`,
  `mockFetch`, `jsonResponse`.
- Banyak keterbatasan happy-dom (tanpa layout, WebGL2, animasi CSS) tercatat di
  [AGENTS §13](../../AGENTS.md#13-jebakan-yang-sudah-diketahui).

## Cakupan
[`bunfig.toml`](../../bunfig.toml): `coverageThreshold = { lines = 0.9, functions = 0.0 }`, dicek **per file** dan hanya
untuk file yang dimuat tes. Folder di luar `server/domain` dan `server/agent` masuk `coveragePathIgnorePatterns`.

## E2E (Playwright)
Konfigurasi di [`playwright.config.ts`](../../playwright.config.ts):
- server: `scripts/e2e-data.ts` menyiapkan `.tmp/e2e/data` (folder data kosong + pustaka material uji), lalu
  `build:test` dan `bun server/main.ts` di port E2E (`E2E_PORT` di `shared/ports.ts`, sekarang 4342) dengan
  `AGENT_DRIVER=fake`, `RUNTIME_DRIVER=fixture`, `NODE_ENV=test`;
- WebGL lewat SwiftShader supaya deterministik; `forbidOnly: true`, `retries: 0`;
- **project `aset`:** file yang cocok `ASSET_TESTS` (sekarang `gudang`, `states`, `studio`) membuat aset, jadi berjalan
  satu worker setelah project `chromium` selesai. File E2E baru yang membuat aset wajib masuk pola ini. Untuk menjalankan
  tes aset saja, tambahkan `--no-deps`.

Helper di [`tests/e2e/helpers.ts`](../../tests/e2e/helpers.ts): `collectConsoleProblems`, `collectExternalRequests`,
`seriousA11yViolations` (axe), `focusRingProblems`, `saveScreenshot`. Dengan `SCREENSHOT_DIR=docs/progress/tahap-NN`,
screenshot bukti disimpan ke folder itu.

## Golden image
Pembanding di [`tests/pipeline/golden.ts`](../../tests/pipeline/golden.ts) (pixelmatch), dipakai `test:pipeline`
(`tests/goldens/render/`) dan `tests/e2e/viewer.e2e.ts` (`tests/goldens/viewer/`).
- Golden hanya ditulis dengan `UPDATE_GOLDENS=1`, misalnya
  `UPDATE_GOLDENS=1 bunx playwright test tests/e2e/viewer.e2e.ts`.
- Saat gagal, gambar aktual dan diff disimpan di `.tmp/goldens-diff/`.
- Perubahan golden disebut di laporan tahap.

## `e2e:api`
[`tests/e2e-api/flow.test.ts`](../../tests/e2e-api/flow.test.ts) menjalankan proses server sungguhan di port E2E dalam
mode palsu, lalu menempuh alur penuh lewat HTTP (`hc<AppType>`) + WebSocket: buat aset berlampiran → pertanyaan →
review → revisi → setujui → tekstur → selesai → unduh. Tes ini juga:
- gagal bila port sudah dipakai proses lain;
- gagal bila log server berisi warn atau error (definisi selesai);
- mengukur puncak RSS server (`VmHWM`) terhadap `SERVER_PEAK_RSS_BUDGET_KB` (sekarang 400 MB).

## Tes arsitektur dan build
| Tes | Menjaga |
|---|---|
| [`tests/architecture/boundaries.test.ts`](../../tests/architecture/boundaries.test.ts) | Arah dependensi: `server/domain` murni, `shared` mandiri, database hanya lewat `server/db`, web hanya `shared` + `AppType`, Playwright hanya di `server/render`, CLI docker hanya dari `server/runtime/docker.ts` |
| [`server/agent/boundaries.test.ts`](../../server/agent/boundaries.test.ts) | `query` hanya di `sdk-adapter.ts`, web tidak meng-import SDK, tidak ada yang membaca `ANTHROPIC_API_KEY` |
| [`tests/architecture/deploy.test.ts`](../../tests/architecture/deploy.test.ts) | Unit systemd (PATH, mode production, tanpa API key) |
| [`tests/architecture/docs.test.ts`](../../tests/architecture/docs.test.ts) | Tautan dan anchor di dokumentasi valid; setiap halaman `docs/fitur` dan `docs/teknis` terdaftar di `docs/README.md` |
| [`scripts/check-bundle.ts`](../../scripts/check-bundle.ts) | Dijalankan setelah `bun run build`: tanpa kode halaman uji, three.js hanya di chunk viewer, chunk awal ≤ `ENTRY_GZIP_BUDGET_BYTES` (sekarang 300 kB gzip) |

## Aturan
Dari [AGENTS §10](../../AGENTS.md#10-tes--definisi-selesai):
- setiap fitur datang bersama tesnya; perbaikan bug dimulai dengan tes yang gagal;
- deterministik: tanpa jaringan, tanpa sleep, jam disuntikkan (`fakeClock` di `server/services/test-support.ts`,
  `page.clock` di E2E), data acak dengan seed;
- pilih elemen lewat role dan nama (`getByRole`), bukan kelas CSS;
- jangan commit `.only` atau `.skip`; jangan melemahkan atau melewati tes supaya lolos;
- tidak ada error atau warning baru di console browser maupun log server.

## Menambah tes baru
| Yang diuji | Pola yang ditiru |
|---|---|
| Fungsi murni domain/shared | `server/domain/status.test.ts`, `shared/limits.test.ts` |
| Service dengan database | `server/services/assets.test.ts` + `server/services/test-support.ts` (SQLite di memori, migrasi asli, jam palsu) |
| Rute HTTP | `server/http/routes/assets.test.ts` + `openTestApi()` dari `tests/support/api.ts` (service asli, driver palsu) |
| WebSocket | `server/realtime/realtime.test.ts` + `tests/support/ws.ts` |
| Pagar Claude | `server/agent/guard.test.ts` (wajib ada tes penolakan) |
| Komponen dasar | `web/components/ui/button.test.tsx` + `renderUi` |
| Halaman dengan data | `web/features/gudang/GudangPage.test.tsx` + `mockFetch` |
| Alur UI | `tests/e2e/*.e2e.ts`; masukkan ke `ASSET_TESTS` bila membuat aset |
| Helper `assetkit` | `runtime/tests/test_*.py` (setiap helper punya pytest) |

## Lihat juga
- [Claude Agent](02-claude-agent.md)
- [Runtime 3D](03-runtime-3d.md)
- [Frontend](07-frontend.md)
- [Menambah fitur](09-menambah-fitur.md)
- [`PLAN.md`](../PLAN.md)
- [`AGENTS.md`](../../AGENTS.md)

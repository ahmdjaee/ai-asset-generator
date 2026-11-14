# Tahap 5 — Inti server: domain, data, runner

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **Inti server lengkap dan bisa dites tanpa Claude maupun Docker.** Status aset tersimpan di SQLite dan hanya berubah
  lewat `transition()`. Semua aksi pemilik (buat, kirim pesan, jawab, setujui, revisi, selesai, ubah bentuk, stop,
  coba lagi, lanjutkan, duplikat, hapus) ada di satu service. Gerbangnya ditegakkan di server.
- **Sesi Claude** berjalan lewat runner dengan pool maks. 2 proses (LRU, idle 5 menit). Runner menangani pilih banyak
  + "Lainnya", Stop (interrupt + batalkan build), dan batas pemakaian (`USAGE_LIMIT` + waktu reset).
- **Driver palsu** (`AGENT_DRIVER=fake`, `RUNTIME_DRIVER=fixture`) menjalankan alur penuh sampai DONE tanpa kuota dan
  tanpa Docker. Kombinasi `fake × docker` juga lolos dengan Blender sungguhan (16,8 dtk).
- **Semua DoD terpenuhi:** `bun run check` hijau, cakupan baris per file ≥90% (total 98,7%), laporan ini.

## Yang dikerjakan
- **Skema + migrasi** `0001_core.sql`:
  - `assets` (snapshot tier, `status`, `runState`, `lastError`, `sessionId`, `deletedAt`), `versions`,
    `events` (unik `assetId+seq`), `jobs`, `questions`, `attachments`, `settings`;
  - file utama: `server/db/schema.ts`.
- **Repositori** `server/db/repos/` (assets, versions, events, jobs, questions, attachments, settings), transaksi
  sinkron lewat `transact`. Tambahan Tahap 5: `cancelUnfinishedJobs`, `lastRequest`, `copyVersions`, `copyAttachments`.
- **Domain murni** `server/domain/status.ts`: `transition(state, action) → { state, effects }`, tabel lengkap status ×
  aksi dan `runState` × aksi. Efeknya `deliver` (pesan ke Claude) dan `interrupt`.
- **Batas build per pesan** disimpan di database (`buildsThisMessage`), dengan kunci REVIEW. Tool `forge` memakai
  `AssetStore` asli: setiap build/submit/brief lewat `transition()` dalam satu transaksi bersama event `state`.
- **Runner** `server/agent/runner.ts` + pool `server/agent/pool.ts`:
  - maks. 2 proses hidup; LRU hanya untuk proses yang bisa digusur; antrean FIFO; `withSlot` untuk cek kesehatan;
  - idle 5 menit → proses ditutup, pesan berikutnya me-resume sesi;
  - pilih banyak + "Lainnya" (`answer()` dengan validasi);
  - Stop = interrupt + batalkan build; jam dan timer disuntikkan;
  - batas pemakaian dari `rate_limit_event` / `USAGE_LIMIT_ERROR_PREFIXES` → `failed` + `USAGE_LIMIT` + `resetsAt`.
- **Event store + bus:**
  - `server/services/asset-store.ts` (`AssetStore`, `EventLog`) dan `server/services/bus.ts`;
  - event delta dan progres hanya live.
- **Service aset** `server/services/assets.ts`:
  - satu-satunya pintu aksi pemilik dan pencatat event sesi (kartu pertanyaan, job, giliran selesai, gagal);
  - sesi Claude disuntikkan lewat port `AgentFactory`; services tidak meng-import `server/agent`.
- **Pemulihan saat start** (`AssetService.recover()`, dipanggil `createServices` sebelum server menerima request):
  - job yang belum selesai → dibatalkan (event `build_finished CANCELLED`);
  - kartu pertanyaan terbuka → dibatalkan;
  - aset `running`/`waiting_user` → `interrupted` + pemberitahuan;
  - "Lanjutkan" me-resume sesi lama dengan pesan bahwa proses terputus, ditambah kutipan permintaan terakhir.
- **Driver palsu:**
  - `server/agent/scenario-port.ts` (FakeQuery + DSL: `say`, `think`, `write`, `forge`, `ask`, `usageLimit`, `hang`,
    `crash`). Tool melewati pagar asli (hook PreToolUse + `canUseTool`) dan server MCP `forge` asli;
  - `server/agent/scenarios.ts`: skenario bawaan yang bekerja menurut status aset;
  - `server/agent/forge/fixture-builder.ts`: GLB fixture + contact sheet siap pakai (`tests/fixtures/contact-sheets/`,
    dibuat dengan `bun scripts/fixture-sheets.ts`).
- **Akar komposisi** `server/compose.ts`: driver dipilih dari `AGENT_DRIVER` / `RUNTIME_DRIVER` (`server/config.ts`,
  `.env.example`). `main.ts` merakit service dan menutupnya saat berhenti.
- **Penyesuaian kode lama ke store database:** `scripts/eval-base.ts`, `scripts/eval-texture.ts`, dan
  `tests/integration/runtime/agent-stop.test.ts`. `Forge.approveBase()` dihapus; persetujuan = aksi pemilik.
- **Tes batas arsitektur** `tests/architecture/boundaries.test.ts`.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos — lint + typecheck; 585 tes server, 42 tes web, 245 tes di run cakupan; 0 gagal |
| `bun run test:coverage` | lolos — setiap file `server/domain` dan `server/agent` ≥90% baris; total 98,66% |
| `RUNTIME_IT=1 bun test tests/integration/runtime/fake-agent.test.ts tests/integration/runtime/agent-stop.test.ts` | 2/2 lolos dalam 16,8 dtk; 0 container `aag.job` tersisa |
| `PORT=4342 DATA_DIR=<tmp> AGENT_DRIVER=fake RUNTIME_DRIVER=fixture bun server/main.ts` | log hanya "server berjalan" (driver tercatat) dan "server berhenti"; tanpa error/warning |

**Tes wajib PLAN** (semua di `server/services/assets.test.ts`, 20 tes, kecuali disebut lain):

| Tes wajib | Tes |
|---|---|
| Tabel lengkap status × event | `server/domain/status.test.ts` (67 tes, termasuk tabel `runState` × aksi) |
| Jalur bahagia | prompt → bentuk dasar → setujui (dengan catatan) → tekstur → selesai; urutan event, job, dan versi diperiksa |
| Loop revisi | dua revisi → v2, v3; brief tidak diulang; jatah build direset |
| Build ke-9 ditolak | 8 build gagal, build ke-9 → `BUILD_CAP_REACHED` tanpa memanggil builder |
| Tekstur sebelum disetujui ditolak | `BASE_NOT_APPROVED`, tanpa job |
| Bentuk menyimpang ditolak | `SHAPE_DRIFT`, versi tidak dibuat, job `failed` |
| Stop di tengah build | interrupt + sinyal build dibatalkan, job `cancelled`, aset idle, pesan berikutnya berjalan |
| Restart di tengah job | service baru di DB yang sama → `recover()` → `interrupted` → Lanjutkan me-resume sesi lama |
| Batas pemakaian | `failed` + `USAGE_LIMIT` + `resetsAt` (detik → ms) → Coba lagi |
| Pilih banyak | kartu → `waiting_user` → jawaban tidak sah ditolak → jawaban + "Lainnya" diteruskan |

Tes tambahan: pilih satu, Stop saat menunggu jawaban, proses Claude mati → `SESSION_FAILED` → Coba lagi, Stop saat
berpikir, duplikat, hapus, hapus saat build, sesi gagal disiapkan, gerbang aksi, pemulihan kartu terbuka.

## Angka
- **Cakupan baris** (`bun run test:coverage`, per file):
  - terendah: `server/agent/events.ts` 91,26%, `fake-port.ts` 94,20%, `forge/server.ts` 94,85%;
  - `server/domain/*` 100%; total 98,66%.
  - Tidak dihitung karena tidak dimuat tes domain/agent: `sdk-adapter.ts`, `recording-port.ts`, dan `forge/builder.ts`
    (`DockerAssetBuilder`). Ketiganya diuji lewat `check:auth`, eval, dan `RUNTIME_IT`.
- **Alur penuh `fake × docker`** (tier Ringan, bentuk dasar + bake tekstur): bersama tes Stop 16,8 dtk.

## Screenshot & file
Tahap ini tanpa UI. File yang relevan:
- Laporan ini: `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-05.md`
- Skenario service: `xdg-open /var/www/ai-asset-generate/server/services/assets.test.ts`
- Contact sheet fixture: `xdg-open /var/www/ai-asset-generate/tests/fixtures/contact-sheets`

## Keputusan
Semua tercatat di Log keputusan `docs/PLAN.md` (baris 2026-11-14 bertanda "Tahap 5"). Ringkasnya:
- skema event: `user.origin`, `build_started.stage`; event `user` dicatat saat masuk antrean;
- pool, batas pemakaian, dan pesan `[Sistem]` (lanjutkan/coba lagi mengutip permintaan terakhir; pembuka sesi baru);
- `Forge.approveBase()` dihapus, persetujuan lewat `transition()`;
- **duplikat** = salinan penuh tanpa sesi dan tanpa riwayat thread (dijawab agent; lihat Pertanyaan);
- **hapus** = soft delete + tutup sesi + batalkan build + hapus folder;
- driver palsu dan penanda skenario; akar komposisi; cakupan per file; tes batas arsitektur;
- hasil tinjauan agent: `turn_started` membersihkan `lastError`, sesi gagal disiapkan tidak melempar, `close()`
  membatalkan build.

## Temuan & risiko
- **Dev server pemilik ikut memuat kode baru.** `bun run dev` dari terminal VS Code (PID 632891) memakai `--watch`.
  Server itu sekarang merakit service dengan driver sungguhan di `data/` milik pemilik: migrasi `0001_core` diterapkan,
  `data/jobs/` dibuat, dan `recover()` berjalan di tabel aset yang masih kosong. Belum ada rute aset, jadi tidak ada
  aksi Claude dan tidak ada kuota terpakai. Proses itu tidak saya hentikan karena milik pemilik.
- **`docker run` tanpa `--pull=never`.** Bila image runtime belum dibangun, Docker mencoba menarik `asset-forge:<tag>`
  dari Docker Hub (gagal, tetapi tetap ada permintaan jaringan). Menambah flag ini mengubah snapshot flag sandbox,
  jadi saya catat untuk Tahap 11 (status "runtime belum siap") dan tidak dikerjakan di sini.
- **Versi di disk tanpa baris database.** Bila server mati tepat di antara rename folder versi dan `insertVersion`,
  folder `vN` ada tetapi tidak tercatat. Build berikutnya tetap benar (nomor dari disk), hanya `vN` tidak tampil.
  Usulan: sinkronisasi di `bun run doctor` (Tahap 12).
- Dengan `RUNTIME_DRIVER=fixture`, job tidak pernah berstatus `running` (jalur job berat tidak dipakai). Hanya
  berpengaruh di mode palsu.
- Pesan yang masih antre setelah giliran gagal (`TURN_FAILED`) tetap dikirim; status kembali `running` dan error lama
  dibersihkan. Pesan antre setelah batas pemakaian dibuang dengan pemberitahuan.
- Skenario palsu selalu membuat peti, apa pun promptnya. Ini cukup untuk E2E, tetapi bukan uji kualitas.

## Belum dikerjakan / dipindah
- Semua tugas Tahap 5 selesai.
- **Menunggu izin pemilik** (di luar delegasi):
  - `eval:base` / `eval:texture` dengan skrip yang sudah dipindah ke store database: baru diverifikasi lewat
    typecheck, belum dijalankan karena memakai kuota;
  - uji nyata `AGENT_DRIVER=sdk` lewat service aset (kuota);
  - commit.

## Pertanyaan untuk pemilik
Tidak ada yang memblokir. Satu pertanyaan sudah dijawab agent sesuai delegasi, dan bisa diubah kapan saja:
- **Duplikat**: salinan penuh (status, versi, brief, lampiran) tanpa sesi Claude dan tanpa riwayat percakapan. Bila
  Anda lebih suka duplikat = mulai ulang dari prompt yang sama, perubahan cukup di `AssetService.duplicate`.

## Usulan tahap berikutnya
Tahap 6 — API & realtime:
- rute Hono sesuai Lampiran F di atas `AssetService` (`hc` bertipe, zod, error `{ code, message }`);
- WebSocket `/api/ws` dengan topik `global` dan `asset:<id>` (sub/unsub, replay `after`, resync, heartbeat,
  backpressure: delta boleh dibuang);
- unggah lampiran (magic byte, re-encode sharp);
- `bun run e2e:api` dalam mode palsu (3× berturut-turut).

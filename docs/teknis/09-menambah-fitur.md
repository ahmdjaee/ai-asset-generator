# Menambah fitur

Alur kerja, letak kode baru, dan checklist sebelum sebuah perubahan dianggap selesai.

## Alur kerja bertahap
Proyek dikerjakan per tahap di [`docs/PLAN.md`](../PLAN.md). Aturan lengkapnya di
[AGENTS §1](../../AGENTS.md#1-alur-kerja-bertahap); ringkasnya:

1. Baca penanda **Tahap aktif** di bagian atas PLAN, checklist tahap itu, dan Log keputusan.
2. Kerjakan hanya tahap aktif. Temuan untuk tahap lain dicatat di laporan. Permintaan eksplisit pemilik di luar tahap
   aktif boleh dikerjakan dan dicatat di Log keputusan.
3. Per tugas: kode + tes → `bun run check` hijau → centang `[x]`.
4. Perubahan rencana (tugas baru, dependensi baru, pendekatan lain) dicatat di **Log keputusan**. Bila menyentuh lingkup
   atau perilaku produk, tanya pemilik dulu.
5. Menutup tahap: jalankan Definition of Done tahap, tulis `docs/progress/tahap-NN.md` dari template di
   [`progress/README.md`](../progress/README.md), ubah status menjadi `menunggu review`, lalu berhenti.

Status tahap: `belum mulai` → `berjalan` → `menunggu review` → `disetujui`. Penanda tahap aktif hanya dipindah setelah
pemilik setuju.

## Di mana kode baru diletakkan
Arah dependensi: `shared` ← `server/domain` ← `server/services` ← `server/http`, `server/agent`, `server/realtime`.
`web` hanya bergantung pada `shared` dan tipe `AppType`. Dijaga `tests/architecture/boundaries.test.ts`; detail di
[Arsitektur](01-arsitektur.md).

| Jenis perubahan | Tempat |
|---|---|
| Tipe, skema zod, dan konstanta yang dipakai server dan web | `shared/` (mis. `shared/asset.ts`, `shared/realtime.ts`) |
| Angka batas dan budget | Hanya [`shared/limits.ts`](../../shared/limits.ts) |
| Aturan bisnis murni (tanpa I/O) | `server/domain/` (mis. transisi status di `server/domain/status.ts`) |
| Akses database | `server/db/repos/`; skema di `server/db/schema.ts`, migrasi di `server/db/migrations/` |
| Logika aplikasi (menggabungkan repo, runtime, bus) | `server/services/` |
| Endpoint HTTP | `server/http/routes/<nama>.ts`, didaftarkan di `createApi` dalam `server/app.ts` |
| Event realtime | Skema di `shared/realtime.ts`, hub di `server/realtime/` |
| Sesi Claude, opsi, pagar | `server/agent/` (opsi hanya dari `options.ts`, SDK hanya dari `sdk-adapter.ts`) |
| Tool `forge` untuk Claude | `server/agent/forge/` |
| Prompt sistem Claude | `server/agent/prompts/system.md` |
| Docker | Hanya `server/runtime/docker.ts` |
| Optimasi dan validasi glTF | `server/pipeline/` |
| Render (Chromium) | `server/render/` |
| Helper Blender (`assetkit`) | `runtime/assetkit/assetkit/` + pytest di `runtime/tests/` + `runtime/knowledge/API.md` dan cookbook |
| Merakit service dan driver | `server/compose.ts` |
| Komponen dasar UI | `web/components/ui/` (+ galeri `/_komponen`) |
| Komponen bersama lintas fitur | `web/components/` |
| Halaman dan komponen fitur | `web/features/<fitur>/`; rute di `web/app/routes.tsx` |
| Hook data, realtime, utilitas web | `web/lib/` |
| Teks UI | `web/i18n/id.ts` (`t`; teks halaman uji di `tSmoke`) |
| Skrip pengembang | `scripts/` + perintah di `package.json` |

## Checklist perubahan
- [ ] **Tes** ikut dalam perubahan yang sama; perbaikan bug dimulai dengan tes yang gagal ([Tes](08-tes.md)).
- [ ] **`bun run check`** hijau; untuk UI juga `bun run e2e` (atau bagian terkait), tanpa error/warning baru di console
      dan log server.
- [ ] **Teks UI** berbahasa Indonesia, hanya di `web/i18n/id.ts`.
- [ ] **Angka batas** baru di `shared/limits.ts`, bukan angka lepas di kode.
- [ ] **Validasi zod** di setiap batas: request HTTP, pesan WebSocket, env, input tool MCP, JSON dari disk atau
      container.
- [ ] **Skema database** berubah → `bun run db:generate`, SQL migrasinya ikut di-commit. Jangan `drizzle-kit push`.
- [ ] **Status aset** hanya berubah lewat `transition()` di `server/domain/status.ts`.
- [ ] **Gerbang** (dua tahap, budget, batas build, kunci review) ditegakkan di server, bukan hanya di UI.
- [ ] **Visual baru yang signifikan** dirancang dulu di FigCraft dan disetujui pemilik; layar lain disusun dari komponen
      dan token yang ada. Jangan membuat prototipe HTML.
- [ ] **Komponen dasar baru** ditambahkan ke galeri `/_komponen` (`web/features/smoke/ComponentsPage.tsx`).
- [ ] **Aksesibilitas:** bisa dipakai dengan keyboard, label dan `aria-*` benar, kontras AA di kedua tema.
- [ ] **Pagar Claude** diubah → tambah tes penolakan; **flag Docker** diubah → perbarui snapshot dan Log keputusan.
- [ ] **Dependensi baru** hanya lewat `bun add --exact`, lalu perbarui [`TECH_STACK.md`](../TECH_STACK.md) dan Log
      keputusan.
- [ ] **Jebakan baru** yang ditemukan dicatat di [AGENTS §13](../../AGENTS.md#13-jebakan-yang-sudah-diketahui).
- [ ] **Dokumentasi** di `docs/teknis/` dan `docs/fitur/` yang terkait ikut diperbarui. Halaman baru didaftarkan di
      `docs/README.md` (dijaga `tests/architecture/docs.test.ts`).

## Izin pemilik
Selalu minta izin dulu untuk:

| Tindakan | Alasan |
|---|---|
| `eval:*`, `AGENT_DRIVER=sdk`, uji nyata | Memakai kuota Claude pemilik |
| Commit, push, membuat branch | Lihat konvensi git di bawah |
| Menghapus isi `data/` atau apa pun di luar repo | `data/` berisi aset pemilik |

Tes rutin selalu memakai `AGENT_DRIVER=fake` dan `RUNTIME_DRIVER=fixture`, jadi tidak butuh izin.

## Konvensi git
Aturan lengkap di [AGENTS §11](../../AGENTS.md#11-git). Ringkasnya:
- commit hanya bila pemilik meminta; tanpa push atau branch baru kecuali diminta;
- stage file satu per satu (`git add <path>`), bukan `git add .` atau `-A`;
- pesan commit berbahasa Inggris, format Conventional Commits (`feat(web): …`, `fix(server): …`);
- tanpa atribusi AI di pesan commit.

Hook `lefthook.yml` menjalankan Biome + typecheck saat pre-commit dan `bun run test` saat pre-push.

## Lihat juga
- [Arsitektur](01-arsitektur.md)
- [Data](05-data.md)
- [Frontend](07-frontend.md)
- [Tes](08-tes.md)
- [`PLAN.md`](../PLAN.md)
- [`TECH_STACK.md`](../TECH_STACK.md)
- [Laporan tahap](../progress/README.md)
- [`AGENTS.md`](../../AGENTS.md)

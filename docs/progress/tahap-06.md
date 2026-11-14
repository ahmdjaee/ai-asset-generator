# Tahap 6 — API & realtime

| | |
|---|---|
| Tanggal | 2026-11-14 |
| Status | disetujui (tinjauan agent, delegasi pemilik 2026-11-14) |
| Kondisi repo | belum di-commit (repo belum punya commit; commit menunggu izin) |

## Ringkasan
- **Semua perilaku server bisa diakses lewat HTTP dan WebSocket.** Rute `/api/assets…` memakai validasi zod, error
  `{ code, message }` berbahasa Indonesia, dan kontrak bertipe `hc<AppType>`. Klien web Tahap 7 tinggal memakainya.
- **Lampiran** (gambar dan model 3D) bisa dikirim bersama prompt, pesan, atau revisi. Tipenya dicek dari isi dan
  gambar di-re-encode tanpa metadata. Claude menerima path absolut untuk dilihat dengan Read, dan build container
  mendapat folder `/refs` read-only.
- **Realtime** `/api/ws` dengan protokol ai-team: topik `global` dan `asset:<id>`, replay `after`, resync, detak, dan
  backpressure (delta boleh dibuang, event penting tidak).
- **Semua DoD terpenuhi:** `bun run e2e:api` lolos 3× berturut-turut, `bun run check` hijau, laporan ini.

## Yang dikerjakan
- **Rute Hono** sesuai Lampiran F (diperbarui dengan rute yang benar-benar ada):
  - file utama: `server/http/routes/assets.ts`, `server/http/validate.ts` (zod → `VALIDATION_FAILED`, batas body),
    `server/http/files.ts` (header file), `server/http/errors.ts` (tabel status lengkap untuk error service);
  - aksi menjawab `{ asset }` terbaru; buat dan duplikat 201; hapus 204;
  - ganti nama (`PATCH`) dengan validasi `INVALID_NAME`.
- **Sisi baca** `server/services/asset-queries.ts`: daftar, detail (tanpa `sessionId`), thread per halaman + `hasMore`,
  replay untuk hub, dan penyajian file versi/lampiran (lstat file biasa + realpath di bawah folder aset).
- **Unggah lampiran** `server/services/attachments.ts`:
  - magic byte: PNG, JPEG, WebP, GIF; GLB, glTF mandiri, OBJ, FBX (biner/ASCII), STL (biner/ASCII);
  - gambar → `refs/<id>.png` (≤1568 px) + `refs/<id>-decal.png` (≤2048 px), sharp dengan `limitInputPixels`;
  - model disimpan apa adanya; glTF dengan file luar ditolak (pesan: ekspor sebagai `.glb`);
  - tulis atomik; nama asli disanitasi hanya untuk tampilan (migrasi `0002_attachment_name`).
- **Alur pesan berlampiran** di `AssetService`: gerbang `transition()` dicek dulu → file diproses → file + baris
  ditulis → aksi diterapkan. Bila status berubah di tengah jalan, file dan baris dibersihkan lagi. Buat aset yang gagal
  tidak meninggalkan folder.
- **Claude dan lampiran:**
  - catatan `[Lampiran pemilik]` berisi path absolut `refs/` dan path container `/refs/<file>`, hanya untuk Claude;
  - thread menampilkan kata-kata pemilik + chip lampiran (`user.attachments`);
  - `refs/` dipasang read-only di `/refs` pada setiap build; cara impor model ditulis di
    `runtime/knowledge/CONVENTIONS.md`.
- **Hub realtime** `server/realtime/hub.ts` + `route.ts` + `shared/realtime.ts`:
  - pagar Host/Origin sebelum upgrade, `maxPayloadLength` 64 KB, maks. 64 langganan per sambungan;
  - replay dan langganan dalam satu langkah sinkron (tanpa celah), resync bila tertinggal >1000 event;
  - backpressure dari nilai balik `send()` + handler `drain` yang dipasang di `main.ts`;
  - server berhenti → sambungan ditutup 1001 sebelum `server.stop()`.
- **Echo Tahap 0 dihapus.** Halaman uji memakai probe realtime (`global` → `ready`).
- **`bun run e2e:api`** `tests/e2e-api/flow.test.ts`: proses `bun server/main.ts` sungguhan di port 4342 (mode palsu,
  `DATA_DIR` sementara), client `hc<AppType>` + WebSocket. Penolong bersama: `tests/support/api.ts`,
  `tests/support/ws.ts`.
- **Pendukung:** builder fixture ikut menulis `web.glb`; server E2E Playwright memakai driver palsu; pembersihan
  container yatim hanya untuk `RUNTIME_DRIVER=docker`; angka batas baru di `shared/limits.ts`.

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos — lint + typecheck; 672 tes server, 42 tes web, 252 tes di run cakupan; 0 gagal |
| `bun run test:coverage` | lolos — setiap file `server/domain` dan `server/agent` ≥90% baris; total 98,71% |
| `bun run e2e:api` (3× berturut-turut, diulang setelah perbaikan hasil tinjauan) | 1/1 lolos setiap kali; alur penuh ±0,3 dtk, total ±1,1 dtk; log server tanpa warn/error |
| `RUNTIME_IT=1 bun test tests/integration/runtime/build-version.test.ts tests/integration/runtime/fake-agent.test.ts` | 5/5 lolos, termasuk impor GLB dari `/refs` dan tulis ke `/refs` gagal; 0 container `aag.job` tersisa |
| `bun run e2e:smoke` | 8/8 lolos (2 tema; probe realtime "Realtime tersambung"; axe dan console bersih) |
| `bun run build` | tanpa warning |

**Tes wajib PLAN:**

| Tes wajib | Tes |
|---|---|
| Protokol WebSocket: replay, resync, heartbeat | `server/realtime/hub.test.ts` (15 tes, soket palsu, jam disuntikkan) + `server/realtime/realtime.test.ts` (4 tes, server Bun sungguhan): urutan replay `after` lalu `ready`, resync >1000, `{op:"hb"}` |
| Delta dibuang saat buffer penuh, event penting tidak | `hub.test.ts`: `send()` = -1 → delta dilewati sampai `drain`; antrean >4 MB → delta dilewati; >12 MB atau event penting dibuang (`send()` = 0) → tutup 1013 |
| Pagar: 403 Host/Origin asing, upgrade ditolak | `server/http/routes/assets.test.ts` (aksi + upgrade, Origin dan Host) + `realtime.test.ts` (handshake dari Origin asing) |
| Unggahan: tipe palsu, terlalu besar, nama berbahaya | `server/services/attachments.test.ts` (24 kasus: magic byte, ekstensi palsu, bom piksel, batas ukuran/jumlah, `../../etc/passwd.png`, nama 300 karakter) + rute 415/413/400 tanpa aset terbuat |

Tes tambahan: kompensasi lampiran saat status berubah di tengah unggahan, gerbang dicek sebelum gambar diproses,
penyajian file (symlink dan path di luar folder aset ditolak, header cache dan `Content-Disposition`), thread per
halaman, replay melewati baris rusak di batas halaman, dan tes untuk setiap temuan peninjau (lihat Temuan).

## Angka
- **Cakupan baris:** total 98,71%; semua file `server/domain` dan `server/agent` ≥90% (ambang per file).
- **`e2e:api`:** alur buat → tanya → jawab → review → revisi → setujui → tekstur → selesai → unduh ±0,3 dtk dalam mode
  palsu; termasuk menyalakan dan mematikan server ±1,1 dtk.
- **Batas** (`shared/limits.ts`): 8 file per pesan; gambar ≤20 MB dan ≤100 MP; model ≤50 MB; request ≤200 MB;
  body JSON ≤256 KB; pesan WebSocket ≤64 KB; replay ≤1000 event; antrean WebSocket 4 MB (lewati delta) / 12 MB (putus).

## Screenshot & file
Tahap ini tanpa UI baru (halaman uji hanya mengganti teks status WebSocket). File yang relevan:
- Laporan ini: `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-06.md`
- Alur `e2e:api`: `xdg-open /var/www/ai-asset-generate/tests/e2e-api/flow.test.ts`
- Kontrak rute: `xdg-open /var/www/ai-asset-generate/server/http/routes/assets.ts`

## Keputusan
Semua tercatat di Log keputusan `docs/PLAN.md` (baris 2026-11-14 bertanda "Tahap 6"). Ringkasnya:
- pipeline lampiran, path absolut untuk Read Claude, `/refs` read-only;
- kontrak API (aksi menjawab `{ asset }`, thread per halaman, header cache file);
- tabel status HTTP lengkap untuk error service;
- ambang backpressure dan hub yang dikunci dengan objek `ServerWebSocket` asli (dibuktikan: Bun memberi objek yang
  sama ke `open`, `message`, dan `drain`);
- angka batas pindah ke `shared/limits.ts`; nama aset divalidasi, tidak dipotong diam-diam.

## Temuan & risiko
**Tinjauan independen.** Satu subagent meninjau kode Tahap 6 tanpa diberi kesimpulan saya. Fokusnya keamanan,
kebenaran, dan aturan AGENTS. Tidak ada celah keamanan serius:
- pagar Host/Origin menolak DNS rebinding, `Origin: null`, trik userinfo, dan port loopback lain;
- penyajian file hanya menerima file biasa di dalam folder aset, dengan `nosniff` dan CSP `sandbox`;
- sharp diberi batas piksel;
- replay dan langganan berjalan tanpa celah;
- backpressure dan penutupan hub benar.

Temuannya, semua diperbaiki dengan tes gagal lebih dulu kecuali yang disebut "diterima":

| # | Temuan | Tindakan |
|---|---|---|
| 1 | Coba lagi/Lanjutkan mengutip kata-kata pemilik tanpa lampirannya | Lampiran ikut dikutip dengan path absolut. Tes baru juga menemukan bug Tahap 5: bila sesi Claude gagal disiapkan, pesan pemilik tidak tercatat sama sekali. Sekarang dicatat di thread dan dikutip saat Coba lagi |
| 2 | Potongan nama file per unit UTF-16 bisa membelah emoji (API Claude menolak surrogate tunggal) | `shared/text.ts` (per code point) di semua potongan teks; runner mengganti surrogate tunggal di pesan dan jawaban "Lainnya" |
| 3 | Pesan error mentah (Inggris, bisa berisi path home) sampai ke klien lewat `lastError` | Pesan umum berbahasa Indonesia; detail ke log lewat `onError` |
| 4 | Pesan 413 body JSON: "maksimal 0 MB" | `formatBytes` → "maksimal 256 KB" |
| 5 | File kosong dilaporkan sebagai tipe tidak didukung | Dicek lebih dulu → "file kosong" |
| 6 | Aset dihapus saat lampiran diproses → folder `refs/` dibuat lagi | Aset dicek sebelum folder dibuat; sisa folder dibersihkan |
| 7 | Unggahan 200 MB memakai memori ±3× ukurannya | **Diterima** sebagai risiko (lihat bawah) |
| 8 | Angka batas lokal di skema rute | Dihapus; panjang dicek service/domain, ukuran oleh batas body |

**Temuan saya sendiri:** replay berhalaman bisa berhenti terlalu cepat bila ada baris event rusak tepat di batas
halaman. Klien yang tersambung ulang bisa kehilangan event. Sudah diperbaiki dengan tes.

**Risiko yang tersisa:**
- **Dev server pemilik sekarang punya rute aset sungguhan.** `bun run dev` dari terminal VS Code (PID 632891) memuat
  ulang kode ini dengan driver `sdk` + `docker` di `data/` milik pemilik.
  - Membuat aset dari browser di port 4341 akan memakai kuota Claude. Itu memang perilaku produk.
  - Rute itu hanya bisa dijangkau dari mesin ini (127.0.0.1 + pagar Host/Origin).
  - Saya hanya mengirim `GET /api/health` ke server itu, untuk memastikan server tetap hidup setelah hot reload.
- **Memori unggahan.** Request multipart dibaca utuh ke memori (Hono/Bun `formData`, lalu salinan per file). Unggahan
  200 MB bisa memakai ±600–800 MB sesaat. Untuk app lokal satu pengguna ini diterima. Bila terasa berat, unggahan bisa
  dialirkan langsung ke disk atau batas request diturunkan.
- **`sessionId` di thread.** Event `init` membawa `sessionId` ke `GET /events` dan WebSocket, padahal `AssetView`
  sengaja tidak menyertakannya. Untuk app lokal satu pengguna ini bukan kredensial, jadi diterima.
- **`docker run` tanpa `--pull=never`** (dari Tahap 5) masih terbuka; direncanakan bersama status "runtime belum siap"
  di Tahap 11.
- Model 3D lampiran hanya dicek dari pola awal file (OBJ/STL ASCII dengan heuristik). File itu hanya dibaca di
  container sandbox, jadi risikonya kecil.

## Belum dikerjakan / dipindah
- Semua tugas Tahap 6 selesai.
- **Usulan, belum dibuat:** helper impor model referensi di `assetkit` (sekarang Claude memakai operator impor Blender
  sesuai `CONVENTIONS.md`). Dinilai setelah ada uji nyata dengan lampiran.
- **Menunggu izin pemilik** (di luar delegasi):
  - uji nyata `AGENT_DRIVER=sdk` dengan lampiran gambar (kuota): apakah Claude benar membuka gambar lewat Read;
  - commit.

## Pertanyaan untuk pemilik
Tidak ada yang memblokir. Dijawab agent sesuai delegasi, dan bisa diubah kapan saja:
- **glTF berfile luar** (`.gltf` + `.bin` + tekstur) ditolak dengan pesan "ekspor sebagai .glb". Mendukungnya butuh
  unggah folder/banyak file sebagai satu model; nilainya kecil untuk pemakaian satu orang.
- **Model 3D lampiran** hanya untuk Claude dan container (tidak ada pratinjau di app). Pratinjau bisa ditambahkan di
  Tahap 9 bila diperlukan.

## Usulan tahap berikutnya
Tahap 7 — Shell web & komponen:
- rel navigasi, tema, dan komponen desain di atas shadcn, sesuai FigCraft (sama persis, sesuai permintaan pemilik);
- semua teks UI di `web/i18n/id.ts`, format angka/tanggal `id-ID`;
- tes komponen + axe di 2 tema; screenshot dibandingkan dengan PNG desain.

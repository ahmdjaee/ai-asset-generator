# Tahap 3 — Spike loop Claude: bentuk dasar

| | |
|---|---|
| Tanggal | 2026-11-13 |
| Status | menunggu review (gerbang **lanjut/tidak**) |
| Kondisi repo | belum di-commit |

## Ringkasan
- Claude sungguhan, lewat sesi login tanpa API key, membuat bentuk dasar dari prompt. Alurnya: menulis skrip
  `assetkit`, build di Docker, melihat contact sheet, memperbaiki, lalu submit.
- **5 dari 5 prompt lolos syarat otomatis:**
  - sampai `submit_for_review`;
  - 0 error validator, segitiga ≤ maks;
  - 1–3 build (batas 6);
  - 1,1–2,3 menit (batas 10).
- Ringkasan berpikir muncul di semua kasus. Claude merujuk sudut contact sheet saat memperbaiki.
- Stop di tengah build mematikan container. Resume sesi setelah proses ditutup memakai session id yang sama, dan
  konteksnya ikut.
- **Belum:** skor Anda (DoD: ≥ 4 dari 5 layak) dan keputusan lanjut/tidak.

## Yang dikerjakan
- **Sambungan ke Claude:**
  - `server/agent/port.ts`: `AgentPort`/`AgentSession`;
  - `sdk-adapter.ts`: satu-satunya pemanggil `query`;
  - `options.ts`: satu factory opsi;
  - `runner.ts`: port minimal `TaskRunner` ai-team. Isinya uuid per pesan, kepemilikan result lewat
    `user_message_uuids`, Stop = interrupt + batalkan build lalu tutup kartu, pesan ter-buffer diabaikan, resume, dan
    jembatan AskUserQuestion;
  - `events.ts`: SDKMessage → event app, termasuk ringkasan berpikir dan batas pemakaian (`USAGE_LIMIT`);
  - `asset-session.ts`: merakit semuanya per aset.
- **Tool `forge`** (`server/agent/forge/`): `record_brief`, `build_base_mesh`, `inspect_version`, `list_versions`,
  `submit_for_review`.
  - Gerbang di server: brief wajib, maksimal 8 build per pesan (build gagal ikut dihitung), build dikunci saat
    review, dan submit hanya untuk versi dengan 0 error validator dan budget lolos.
  - Hasil tool: JSON ringkas, perbandingan ukuran dengan brief, dan tepat 1 contact sheet.
- **Pagar 3 lapis** (`guard.ts`):
  1. allowlist tool;
  2. aturan izin + `canUseTool` yang menolak secara bawaan;
  3. hook PreToolUse dengan `realpath`.

  Claude hanya bisa membaca `work/`, `refs/`, dan `knowledge/`, dan hanya bisa menulis di `work/`.
- **Bahan untuk Claude:**
  - `runtime/knowledge/API.md`, `CONVENTIONS.md`, dan 5 resep cookbook. Isi resep = skrip contoh yang diuji, dijaga
    tes. Contoh baru: `pohon.py` dan `makhluk.py`;
  - system prompt `server/agent/prompts/system.md` (Indonesia).
- **Evaluasi:**
  - `bun run eval:base` (tanpa `--confirm` hanya mencetak rencana);
  - `scripts/sdk-fixture.ts` dan fixture kontrak `tests/fixtures/sdk/base-peti.jsonl`.
- **Tes baru:**

  | Tes | Isi |
  |---|---|
  | `guard.test.ts` | semua penolakan wajib |
  | `runner.test.ts` | 16 skenario FakeQuery |
  | `forge/server.test.ts` | MCP `InMemoryTransport` |
  | `options.test.ts` | snapshot opsi |
  | `asset-session.test.ts` | ujung-ke-ujung dengan Claude palsu |
  | `events.test.ts`, `sanitize.test.ts` | konversi event dan sanitasi |
  | `knowledge.test.ts` | knowledge sama dengan kode |
  | `boundaries.test.ts` | hanya adapter yang meng-import `query` |
  | `contract.test.ts` | stream SDK nyata |
  | `tests/integration/runtime/agent-stop.test.ts` | Stop dengan Docker sungguhan |

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos: lint + typecheck + 415 tes (373 server + 42 web) |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | lolos 17/17 (termasuk 5 contoh dan Stop di tengah build) |
| `bun run test:assetkit` | lolos |
| `bun run test:pipeline` | lolos 13/13 |
| `bun run check:auth` | sesi login, `apiKeySource` none |
| `bun run eval:base -- --confirm --only peti` | lolos (dengan izin pemilik) |
| `bun run eval:base -- --confirm --only pistol-scifi,kursi,pohon,rubah --stop-resume` | 4/4 lolos, Stop dan resume terbukti |
| `docker ps -a --filter label=aag.job` | kosong |

## Hasil eval (model `claude-opus-5-5`, tier Sedang)
| Kasus | Build | Versi dikirim | Segitiga | Validator | Waktu | Blok berpikir | Rujuk contact sheet | Biaya setara API* |
|---|---|---|---|---|---|---|---|---|
| peti | 2 | v2 | 1.774 | 0 error | 1,5 mnt | 6 | ya | $0,44 |
| pistol-scifi | 3 | v3 | 1.680 | 0 error | 2,3 mnt | 8 | ya | $0,53 |
| kursi | 1 | v1 | 740 | 0 error | 1,1 mnt | 5 | ya | $0,28 |
| pohon | 2 | v2 | 1.956 | 0 error | 1,3 mnt | 6 | ya | $0,33 |
| rubah | 3 | v3 | 4.044 | 0 error | 1,8 mnt | 8 | ya | $0,47 |
| Stop + resume | 1 dibatalkan + 1 | v1 | — | 0 error | 0,6 + 0,6 mnt | — | — | $0,19 + $0,33 |

\* `total_cost_usd` dari SDK: harga setara API, bukan tagihan. Di sesi login, pemakaian dipotong dari kuota akun.
Total semua run ±$2,57 setara API dan ±9 menit. **Perkiraan per aset bentuk dasar: $0,3–0,55 setara API, 1–2,5 menit.**

**Stop dan resume** (`eval/runs/2026-11-13T16-05-38-915Z/stop-resume.md`):
- Stop dipicu saat build pertama berjalan. Build `CANCELLED`, 0 container tersisa, result ditandai `interrupted`.
- Proses Claude lalu ditutup. Pesan berikutnya memulai proses baru dengan `resume`: session id sama, dan Claude
  langsung melanjutkan kursinya dari konteks sebelumnya.

**Claude merujuk contact sheet.** Contoh dari pistol, sebelum build ke-3: *"the beavertail protrudes awkwardly below
and behind the frame"*, lalu dipindah. Contoh dari kursi: *"dari sudut Kiri/Kanan lengkung tutupnya terlihat jelas…
dari sudut Atas bentuknya simetris"*.

## Screenshot & file
Contact sheet versi yang dikirim untuk review:
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-03/peti-v2.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-03/pistol-scifi-v3.png`
  (pembanding v1: `docs/progress/tahap-03/pistol-scifi-v1.png`)
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-03/kursi-v1.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-03/pohon-v2.png`
- `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-03/rubah-v3.png`

Hasil eval lengkap (transcript, skrip tiap versi, statistik, ringkasan; di-gitignore):
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T16-03-50-273Z/peti/summary.md`
- `xdg-open /var/www/ai-asset-generate/eval/runs/2026-11-13T16-05-38-915Z/summary.md` (ada kolom skor untuk Anda)

## Keputusan
Semua dicatat di Log keputusan `PLAN.md`. Yang terpenting:
- **State aset spike di memori** (`briefing → base_working → base_review`). Tahap 5 menggantinya dengan SQLite dan
  `transition()`.
- **Kode error forge tambahan:** `IN_REVIEW`, `SCRIPT_MISSING`, `VERSION_NOT_FOUND`, `CANCELLED`.
- **Pagar lebih ketat dari Lampiran B.** Read hanya `work/`, `refs/`, `knowledge/`, bukan seluruh folder aset.
- **Resep cookbook = skrip contoh yang diuji.** Fixture `laras.glb` lama dipertahankan supaya golden tidak berubah.
- **`eval:base` butuh `--confirm`.** Container eval berlabel `aag.owner=eval`.

## Temuan & risiko
- **Ringkasan berpikir sebagian besar berbahasa Inggris**, padahal balasan ke pemilik berbahasa Indonesia. UI
  Tahap 9 menampilkan ringkasan ini. Pilihannya: menambah instruksi "berpikir dalam bahasa Indonesia" di system
  prompt (perlu eval ulang singkat), atau menerimanya apa adanya.
- **Claude tidak pernah bertanya** (0 AskUserQuestion), karena semua prompt eval sudah cukup jelas. Jembatan
  pertanyaan baru diuji dengan Claude palsu. Perlu diuji nyata di Tahap 9 dengan prompt yang ambigu.
- **TodoWrite tidak tersedia** di Claude Code versi ini (daftar tool sesi nyata). Tidak berdampak; allowlist tetap
  mencantumkannya.
- **Skrip Claude memakai cutter boolean dan rotasi**; semuanya lolos tanpa build gagal. Gerbang "naikkan abstraksi
  `assetkit`" belum terlihat perlu.
- **Rubah memakai 4.044 segitiga** (target Sedang 8.000). Aset organik lebih boros, tapi masih jauh di bawah batas.
- **Biaya per aset kecil** ($0,3–0,55 setara API). Tahap tekstur (Tahap 4) diperkirakan lebih mahal karena lebih
  banyak gambar dan build lebih lama.

## Belum dikerjakan / dipindah
- **Skor pemilik** (DoD: ≥ 4 dari 5 layak, skor ≥ 3/5). Ini satu-satunya DoD yang belum tercentang.

## Pertanyaan untuk pemilik
1. **Skor 1–5** untuk peti, pistol sci-fi, kursi, pohon, dan rubah (lihat contact sheet di atas). Cukup tulis di
   chat, atau isi kolom skor di `eval/runs/2026-11-13T16-05-38-915Z/summary.md`.
2. **Gerbang lanjut/tidak:** lanjut ke Tahap 4 (spike tekstur) dengan `assetkit` apa adanya? Rekomendasi saya:
   **lanjut**, tanpa mengubah `assetkit`.
3. **Bahasa ringkasan berpikir:** tambahkan instruksi berpikir dalam bahasa Indonesia, atau biarkan?
4. **Masih terbuka dari sebelumnya:** commit Tahap 0–3, menambah ruff, toleransi cek bentuk (±5% ukuran, ±25%
   segitiga), dan menghapus `pngjs`.

## Usulan tahap berikutnya
**Tahap 4 — Spike tahap tekstur.** Isinya: UV xatlas, pustaka material CC0 + `list_materials`, bake normal/AO,
optimasi per tier, gerbang `build_textured_asset` (cek bentuk dari Tahap 2), dan `eval:texture` dengan 3 prompt.
`textures:sync` butuh jaringan, dan `eval:texture` butuh izin kuota.

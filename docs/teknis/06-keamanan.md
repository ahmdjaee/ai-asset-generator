# Keamanan

Model ancaman app ini dan lapisan pengaman di server, container, sesi Claude, dan web, beserta tes yang menjaganya.

## Model ancaman
App ini dipakai satu orang di mesinnya sendiri. Tidak ada akun, login app, atau multi-pengguna. Risiko terbesar datang
dari dua arah:

| Ancaman | Kenapa berbahaya | Pengaman utama |
|---|---|---|
| Situs lain di browser yang sama (CSRF, DNS rebinding) | User mesin ini anggota grup `docker`, yang setara root. API yang bisa dijangkau dari situs lain sama dengan akses root. | Bind loopback + pagar Host/Origin |
| Skrip Blender yang ditulis Claude | Kode tak dipercaya yang dijalankan di mesin | Sandbox Docker + output tidak dipercaya |
| Claude sendiri (tool, file) | Bisa membaca atau menulis di luar folder aset | Akses tiga lapis |
| File dari luar (lampiran, teks Claude) | Tipe palsu, metadata, path traversal, tautan berbahaya | Cek isi, re-encode, realpath, markdown hardened |

Ringkasan resminya ada di [PLAN Lampiran G](../PLAN.md#lampiran-g--batas-sumber-daya--keamanan).

## Server: loopback dan pagar Host/Origin
- **Bind `127.0.0.1` saja.** `Config.host` di [`server/config.ts`](../../server/config.ts) bertipe literal
  `"127.0.0.1"` dan tidak bisa diubah lewat env. `server/main.ts` memakainya sebagai `hostname`.
- **Pagar Host/Origin** di [`server/http/guard.ts`](../../server/http/guard.ts), dipasang untuk semua rute
  (`app.use("*", hostOriginGuard(...))` di `server/app.ts`):
  - Host selain `127.0.0.1`, `localhost`, `::1` → 403 (DNS rebinding);
  - Origin harus `http:`, loopback, dan memakai port API atau Vite dev → selain itu 403 (CSRF);
  - permintaan selain GET/HEAD dengan `Sec-Fetch-Site: cross-site` → 403;
  - tanpa Host/Origin (curl, skrip lokal) tetap lolos, karena browser selalu mengirimnya.
- **WebSocket:** pagar yang sama berjalan sebelum upgrade `/api/ws` (`server/realtime/route.ts`), jadi handshake dari
  situs lain ditolak sebelum menjadi WebSocket. Ukuran pesan dibatasi `WS_MAX_PAYLOAD_BYTES` di
  `shared/limits.ts` (sekarang 64 KB).
- **Batas body:** JSON lewat `JSON_BODY_MAX_BYTES`, unggahan lewat `UPLOAD_MAX_REQUEST_BYTES`
  (`server/http/validate.ts`). Semua input divalidasi zod.
- **Error ke klien** berbentuk `{ code, message }` tanpa stack trace (`server/http/errors.ts`).
- **File yang disajikan** (`server/http/files.ts`) memakai `X-Content-Type-Options: nosniff` dan CSP
  `default-src 'none'; sandbox`, jadi isinya tidak pernah dijalankan browser sebagai halaman.

## Unggahan
Semua di [`server/services/attachments.ts`](../../server/services/attachments.ts). Lampiran diproses di memori sebelum
aset atau pesan dibuat.

| Langkah | Detail |
|---|---|
| Batas | Jumlah, ukuran gambar/model, piksel, dan panjang nama dari `shared/limits.ts` (`ATTACHMENT_MAX_FILES`, `ATTACHMENT_IMAGE_MAX_BYTES`, `ATTACHMENT_MODEL_MAX_BYTES`, `ATTACHMENT_IMAGE_MAX_PIXELS`, `ATTACHMENT_NAME_MAX_CHARS`). Contoh sekarang: 8 file, gambar 20 MB, model 50 MB. |
| Tipe | Dideteksi dari isi (magic byte), bukan dari ekstensi atau `Content-Type` klien. File kosong ditolak lebih dulu. |
| Gambar | Di-re-encode sharp menjadi PNG; orientasi diterapkan (`rotate()`), metadata (EXIF/GPS) dibuang. Dua ukuran: untuk Claude (`ATTACHMENT_CLAUDE_MAX_PX`) dan decal (`ATTACHMENT_DECAL_MAX_PX`). |
| Model 3D | glb/gltf/obj/fbx/stl disimpan apa adanya. Claude tidak membacanya; skrip bisa mengimpornya dari `/refs` (read-only). |
| Nama | Nama di disk dibuat server dari id. Nama asli hanya untuk tampilan, lewat `sanitizeFileName`. |
| Tulis | Atomik: file sementara di folder yang sama → `rename`. Gagal di tengah → file yang sudah ditulis dibersihkan. |

## Sandbox Docker
Argumen `docker run` dibangun fungsi murni `buildRunArgs` di [`server/runtime/docker.ts`](../../server/runtime/docker.ts),
satu-satunya tempat CLI `docker` dipanggil.

| Flag | Fungsi |
|---|---|
| `--network none` | Tanpa jaringan |
| `--read-only` + `--tmpfs /tmp:rw,nosuid,nodev,size=…` | FS read-only kecuali `/job` dan `/tmp` |
| `--cap-drop ALL`, `--security-opt no-new-privileges` | Tanpa capability, tanpa eskalasi |
| `--pids-limit`, `--memory`, `--memory-swap` (= memori), `--cpus` | Batas dari `JobLimits` di `shared/limits.ts` (`BASE_JOB_LIMITS`, `TEXTURED_JOB_LIMITS`, …) |
| `--user <uid:gid>` | Bukan root; file di `/job` milik pemilik |
| `--pull never` | Hanya image lokal dari `runtime:build` |
| `--label aag.job=…` + label pemilik | Container bisa dilacak dan dibersihkan |
| Mount | `/job` tulis; `/refs`, `/opt/assetkit`, `/materials` read-only. Path dengan koma atau baris baru ditolak. |

Mengubah flag berarti memperbarui snapshot `server/runtime/__snapshots__/docker.test.ts.snap` dan mencatat alasannya di
Log keputusan ([AGENTS §7](../../AGENTS.md#7-runtime-3d-docker--blender)).

## Output container tidak dipercaya
`collectOutputs` di [`server/runtime/outputs.ts`](../../server/runtime/outputs.ts) membaca folder hasil job dengan
`lstat`:
- symlink ditolak (tidak diikuti);
- hanya file biasa, tanpa hardlink (`nlink > 1` ditolak);
- nama harus ada di allowlist, yang sekaligus memberi batas ukuran per file (`BASE_OUTPUT_MAX_BYTES`,
  `TEXTURED_OUTPUT_MAX_BYTES` di `shared/limits.ts`).

Yang ditolak dicatat beserta alasannya (`symlink`, `not_file`, `not_allowed`, `too_large`, `hardlink`).

## Path dari luar dan realpath
- File yang disajikan lewat HTTP dicek `checkedFile` di `server/services/asset-queries.ts`: harus file biasa (`lstat`)
  dan realpath-nya di dalam root yang diizinkan. Selain itu jawabannya `FILE_NOT_FOUND`.
- Folder job dibuat di bawah root yang sudah di-realpath (`server/runtime/job-dir.ts`).
- Server web produksi tidak menyajikan file di luar `distDir` (tes path traversal di `server/app.test.ts`).

## Akses Claude: tiga lapis
Opsi sesi hanya dari [`server/agent/options.ts`](../../server/agent/options.ts) (`buildSessionOptions`); aturannya di
[`server/agent/guard.ts`](../../server/agent/guard.ts).

| Lapis | Isi |
|---|---|
| 1. Allowlist `tools` | `BUILTIN_TOOLS`: Read, Write, Edit, Glob, Grep, TodoWrite, AskUserQuestion, ditambah tool MCP `forge` |
| 2. Aturan izin + `canUseTool` | `permissionRules`: allow eksplisit per path absolut, deny `ALWAYS_DENIED`; `permissionMode: "default"` (bukan `auto`), `disableBypassPermissionsMode` |
| 3. Hook PreToolUse | `guardHooks` → `checkToolUse`, berlaku untuk semua tool, path dicek dengan realpath (`realTarget`) |

Batas path:
- Read/Glob/Grep hanya di `work/`, `refs/`, dan `runtime/knowledge/`;
- Write/Edit hanya di `work/`;
- symlink yang menunjuk keluar dan symlink menggantung ditolak;
- pola glob harus relatif, tanpa `..` dan `~`.

Selalu ditolak (`ALWAYS_DENIED`): `Bash`, `WebFetch`, `WebSearch`, `Task`, `Agent`, `NotebookEdit`, `mcp__claude_ai_*`.
Sesi juga tidak memuat setting milik mesin (`settingSources: []`, `strictMcpConfig: true`). Mengubah salah satu lapis
wajib disertai tes penolakan ([AGENTS §6](../../AGENTS.md#6-claude-agent-sdk)). Detail sesi ada di
[Claude Agent](02-claude-agent.md).

## Tanpa API key
`agentEnv()` di `server/config.ts` menyalin `process.env`, lalu mengosongkan `ANTHROPIC_API_KEY` dan
`ANTHROPIC_AUTH_TOKEN`. Opsi `env` SDK mengganti seluruh env, jadi sesi memakai login Claude Code di mesin ini.
`bun run check:auth` gagal bila ada sumber API key apa pun.

## `.blend` tanpa kode
File `.blend` bisa menjalankan Python saat dibuka di Blender desktop. `save_blend` di
[`runtime/assetkit/assetkit/io.py`](../../runtime/assetkit/assetkit/io.py) memanggil `_strip_python` sebelum menyimpan:
- semua datablock teks dibuang (teks `use_module` didaftarkan sebagai modul saat file dibuka);
- driver `SCRIPTED` dibuang dari semua datablock, termasuk node tree material, world, dan lampu;
- driver lain (AVERAGE dan sejenisnya) tidak menjalankan Python, jadi tetap disimpan.

Diuji di `runtime/tests/test_io.py` (`bun run test:assetkit`).

## Web: teks Claude
Teks dari Claude dirender lewat [`web/components/Markdown.tsx`](../../web/components/Markdown.tsx), bukan `<Streamdown>`
langsung dan tidak pernah `dangerouslySetInnerHTML`:
- urutan rehype: HTML mentah → sanitasi → `harden`;
- tautan http/https dan relatif boleh; `javascript:`, `data:`, `file:`, `vbscript:` menjadi teks biasa;
- gambar tidak pernah dimuat (hanya teks alt), jadi teks Claude tidak memicu permintaan jaringan.

## Privasi log
Logger pino di [`server/log.ts`](../../server/log.ts) menyensor `*.env`, `*.token`, `*.apiKey`, `*.password`, serta
header `authorization` dan `cookie`. Aturan yang tidak bisa ditegakkan otomatis
([AGENTS §5](../../AGENTS.md#5-server-bun--hono)): jangan mencatat base64 atau gambar, isi env, token, kredensial, dan
isi skrip lengkap. Fixture SDK yang direkam disanitasi dulu (`server/agent/sanitize.ts`).

## Tes yang menjaga
| Pengaman | Tes |
|---|---|
| Host/Origin/Sec-Fetch-Site | `server/http/guard.test.ts`, `server/app.test.ts` |
| Handshake WebSocket dan `maxPayloadLength` | `server/realtime/realtime.test.ts` |
| Unggahan (tipe palsu, metadata, batas) | `server/services/attachments.test.ts` |
| Flag sandbox | `server/runtime/docker.test.ts` + snapshot `docker.test.ts.snap` |
| Lolos sandbox (Docker nyata) | `tests/integration/runtime/sandbox.test.ts` (`RUNTIME_IT=1`) |
| Output container | `server/runtime/outputs.test.ts` |
| Tiga lapis Claude | `server/agent/guard.test.ts`, `server/agent/options.test.ts` + snapshot |
| Satu pintu SDK, tanpa API key | `server/agent/boundaries.test.ts`, `server/config.test.ts` |
| Docker hanya dari `docker.ts`, batas lapisan | `tests/architecture/boundaries.test.ts` |
| Unit systemd tanpa API key dan tanpa host lain | `tests/architecture/deploy.test.ts` |
| Markdown hardened | `web/components/Markdown.test.tsx` |
| `.blend` tanpa Python | `runtime/tests/test_io.py` |

## Lihat juga
- [Arsitektur](01-arsitektur.md)
- [Claude Agent](02-claude-agent.md)
- [Runtime 3D](03-runtime-3d.md)
- [API](04-api.md)
- [Tes](08-tes.md)
- [`AGENTS.md`](../../AGENTS.md)

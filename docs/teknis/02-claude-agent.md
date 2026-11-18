# Claude Agent

Cara app menjalankan Claude lewat Agent SDK: satu sesi per aset, pagar tiga lapis, tool `forge`, deteksi batas
pemakaian, dan driver palsu untuk tes.

## Prinsip
- **Tanpa API key.** Claude memakai sesi login Claude Code di mesin pemilik. Env proses Claude selalu dari
  `agentEnv()` (`server/config.ts`).
- **Satu pintu.** Hanya `server/agent/sdk-adapter.ts` yang meng-import `query`. Semua opsi sesi berasal dari
  `server/agent/options.ts`. Batas ini dijaga `server/agent/boundaries.test.ts`.
- **Gerbang di server.** Tahap, budget, batas build, dan kunci review ditegakkan di tool `forge` dan
  `transition()`, bukan di prompt.

Aturan lengkapnya ada di [AGENTS.md](../../AGENTS.md) §6. Ringkasan rencana sesi ada di PLAN Lampiran B
([PLAN](../PLAN.md)).

## Komponen

| File | Tanggung jawab |
|---|---|
| `server/agent/port.ts` | Kontrak `AgentPort.start(options) → AgentSession` (`messages`, `send`, `interrupt`, `close`, `accountInfo`, `supportedModels`) |
| `server/agent/sdk-adapter.ts` | Implementasi dengan `query()`; pesan masuk lewat `InputQueue`; `interrupt({ cancelQueued: true })` lewat cast terbatas |
| `server/agent/options.ts` | `buildSessionOptions()` untuk sesi aset, `buildProbeOptions()` untuk cek akun |
| `server/agent/asset-session.ts` | `createAssetSession()`: folder kerja, pagar, `Forge`, opsi, dan `AssetRunner` untuk satu aset |
| `server/agent/runner.ts` | `AssetRunner`: antrean pesan, giliran, pertanyaan, Stop, idle, batas pemakaian |
| `server/agent/events.ts` | `toAgentEvents()`: `SDKMessage` → event app (`shared/agent-events.ts`) |
| `server/agent/pool.ts` | `AgentPool`: batas proses Claude hidup |
| `server/agent/guard.ts` | Daftar tool, aturan izin, hook PreToolUse, cek path |
| `server/agent/forge/` | Tool MCP `forge` dan builder (Docker atau fixture) |
| `server/agent/prompts.ts`, `prompts/system.md` | System prompt dan teks pesan yang disusun app |
| `server/agent/account.ts` | `AccountProbe`: status login + daftar model untuk `/api/health/auth` |
| `server/agent/scenario-port.ts`, `scenarios.ts` | Driver palsu `AGENT_DRIVER=fake` |
| `server/agent/recording-port.ts`, `sanitize.ts` | Perekaman stream SDK dan sanitasinya |

## Sesi per aset
Satu aset memakai satu sesi Claude. `AssetService` membuatnya lewat `createAssetSession()` saat aset pertama kali
butuh Claude.

- **Folder:** `cwd` = `data/assets/<id>/work/`. `refs/` dan `runtime/knowledge/` ditambahkan sebagai
  `additionalDirectories` (hanya baca).
- **Resume:** session id dari event `init` disimpan di kolom `assets.session_id`. Proses baru (setelah idle, restart
  server, atau revisi) memakai opsi `resume` dengan id itu. Tahap tekstur melanjutkan sesi yang sama.
- **Pembuka sesi:** bila aset sudah berjalan tetapi belum punya session id (mis. hasil duplikat), pesan pertama
  diawali `sessionPreamble()` yang meringkas status, versi, dan brief.
- **Pesan yang disusun app:** efek `deliver` dari `transition()` (`owner`, `approved`, `change_shape`, `resume`,
  `retry`) diubah menjadi teks oleh `outboundText()`. Thread menampilkan kata-kata pemilik; Claude menerima teks
  lengkap termasuk catatan lampiran.
- **Server MCP per proses:** `Forge.mcpServer()` dibuat ulang setiap kali proses Claude dimulai, karena instance MCP
  hanya bisa tersambung ke satu transport.

## Opsi sesi
`buildSessionOptions()` di `server/agent/options.ts`. Snapshot opsinya dijaga
`server/agent/__snapshots__/options.test.ts.snap`.

| Opsi | Nilai | Alasan |
|---|---|---|
| `model` | dari Pengaturan; bawaan `DEFAULT_MODEL` (`shared/settings.ts`, sekarang `claude-opus-5-5`) | Bisa diganti pemilik |
| `effort` | dari Pengaturan; bawaan `DEFAULT_EFFORT` (sekarang `high`) | Eksplisit, karena bawaan model `medium` |
| `thinking` | `{ type: "adaptive", display: "summarized" }` | Tanpa `summarized`, ringkasan berpikir kosong |
| `settingSources` | `[]` | Tanpa CLAUDE.md, settings, atau MCP milik pemilik |
| `strictMcpConfig` | `true` | Hanya server MCP dari opsi |
| `systemPrompt` | preset `claude_code` + `append` dari `systemPromptAppend()` | Persona, aturan, konteks tier |
| `tools` / `disallowedTools` | `BUILTIN_TOOLS` / `ALWAYS_DENIED` | Lapis 1 pagar |
| `permissionMode` | `default` | Diatur eksplisit; tidak bergantung pada `auto` |
| `settings.permissions` | `permissionRules()` + `disableBypassPermissionsMode: "disable"` | Lapis 2 pagar |
| `canUseTool` | dari runner | Lapis 2 pagar, menolak secara bawaan |
| `hooks` | `guardHooks()` | Lapis 3 pagar |
| `mcpServers` | `{ forge: … }` | Tool `forge` |
| `includePartialMessages` | `true` | Delta teks untuk stream di Studio |
| `env` | `agentEnv()` | Tanpa API key |

Model dan effort dibaca dari `SettingsService` setiap kali proses Claude dimulai, jadi perubahan Pengaturan berlaku
untuk proses berikutnya.

### `agentEnv()`
Opsi `env` SDK **mengganti** seluruh env proses Claude. `agentEnv()` menyalin `process.env`, mengosongkan
`ANTHROPIC_API_KEY` dan `ANTHROPIC_AUTH_TOKEN`, dan menambah `CLAUDE_AGENT_SDK_CLIENT_APP`. Proses pemeriksa akun
(`buildProbeOptions()`) juga memakai `agentEnv()`, tanpa tool (`disallowedTools: ["*"]`) dan tanpa menyimpan sesi.

## Pool proses
`AgentPool` (`server/agent/pool.ts`) membatasi proses Claude yang hidup bersamaan ke `AGENT_POOL_SIZE`
(`shared/limits.ts`, sekarang 2), termasuk proses cek akun (`withSlot`).

- Bila penuh, proses idle yang paling lama tidak dipakai (LRU) ditutup; sesinya tetap bisa di-resume.
- Proses yang sedang bekerja, punya antrean pesan, atau menunggu jawaban tidak pernah ditutup. Permintaan slot
  menunggu (FIFO), dan thread menampilkan `QUEUED_NOTICE`.
- Runner menutup prosesnya sendiri setelah idle `AGENT_IDLE_SHUTDOWN_MS` (sekarang 5 menit).

## Runner dan event
`AssetRunner` (`server/agent/runner.ts`) membaca stream dengan satu loop `for await` yang hidup selama sesi.

- Setiap pesan dikirim dengan uuid sendiri. `result` dicocokkan ke pesan lewat `user_message_uuids`
  (`resultMeta()` di `events.ts`), bukan lewat urutan.
- Saat pesan benar-benar dikirim, `onOwnerMessage` menerapkan `turn_started` (jatah build direset).
- **AskUserQuestion** dijembatani menjadi event `question`; jawaban datang lewat `answer()` (validasi di
  `server/domain/answers.ts`).
- **Stop:** `interrupt()` dulu (dengan `cancelQueued`), lalu build dibatalkan (`forge.cancelActive()`), baru kartu
  pertanyaan ditutup. Bila `result` tidak datang dalam `STOP_GRACE_MS`, sesi ditutup paksa.
- Pesan yang masih ter-buffer setelah sesi ditutup atau diganti diabaikan.

`toAgentEvents()` memetakan pesan SDK:

| Pesan SDK | Event app |
|---|---|
| `system` `init` | `init` (session id, model) |
| `system` `permission_denied` | `error` `TOOL_DENIED` |
| `rate_limit_event` dengan status `rejected` | `error` `USAGE_LIMIT` (+ `resetsAt` ms epoch) |
| `stream_event` `text_delta` / `thinking_delta` | `delta` (live, tidak disimpan) |
| `assistant` | `assistant`, `thinking`, `tool`; error `authentication_failed` → `error` `AUTH_REQUIRED` |
| `user` berisi `tool_result` | `tool_result` (pratinjau dipotong, jumlah gambar) |
| `result` | `result` |

### Batas pemakaian
Tanda batas pemakaian dikumpulkan selama giliran dari dua sumber: `rate_limit_event` yang ditolak, dan teks
assistant yang diawali salah satu `USAGE_LIMIT_ERROR_PREFIXES` (diekspor Agent SDK). Keputusannya diambil saat giliran
berakhir: giliran yang gagal karenanya menjadi `error` `USAGE_LIMIT` dengan waktu reset. `AssetService` menerapkan
aksi `failed` untuk event `error` ber-kode `USAGE_LIMIT`, `AUTH_REQUIRED`, atau `SESSION_FAILED`, sehingga aset
menjadi `runState: failed` dengan `lastError` (`code`, `message`, `at`, `resetsAt?`). `result` yang `isError` tanpa
event itu menjadi `lastError.code: "TURN_FAILED"`. `AUTH_REQUIRED` juga membatalkan cache status akun dan menyiarkan
event `auth` di topik `global`.

## Pagar tiga lapis
Didefinisikan di `server/agent/guard.ts` dan dijaga `server/agent/guard.test.ts`. Mengubah salah satu lapis wajib
disertai tes penolakan.

| Lapis | Mekanisme | Isi |
|---|---|---|
| 1 | allowlist `tools` | `BUILTIN_TOOLS`: Read, Write, Edit, Glob, Grep, TodoWrite, AskUserQuestion (+ tool `mcp__forge__*`) |
| 2 | aturan izin + `canUseTool` | `permissionRules()`: `allow` Read di `work/`, `refs/`, knowledge; Edit di `work/`; TodoWrite; `mcp__forge__*`. `deny` = `ALWAYS_DENIED`. `canUseTool` memanggil `checkToolUse()` dan menolak tool yang tidak dikenal |
| 3 | hook PreToolUse | `guardHooks()` memanggil `checkToolUse()` dengan root yang sudah di-`realpath` |

`ALWAYS_DENIED`: Bash, WebFetch, WebSearch, Task, Agent, NotebookEdit, `mcp__claude_ai_*`.

`checkToolUse()` memakai `realTarget()`: leluhur terdalam yang ada di-`realpath`, sehingga symlink ke luar
tertangkap, termasuk untuk file yang belum ada. Pola Glob/Grep harus relatif dan tanpa `..`. Read/Glob/Grep hanya di
`work/`, `refs/`, dan knowledge; Write/Edit hanya di `work/`.

## Tool `forge`
Server MCP in-process dari `Forge.mcpServer()` (`server/agent/forge/server.ts`), dengan `alwaysLoad: true` dan
`timeout: FORGE_TOOL_TIMEOUT_MS` (sekarang 15 menit). Claude melihatnya sebagai `mcp__forge__<nama>`.

| Tool | Input | Fungsi | Gerbang |
|---|---|---|---|
| `record_brief` | `Brief` (`shared/brief.ts`): `summary`, `category`, `style`, `dimensionsM`, `notes?` | Mencatat brief; BRIEFING → BASE_WORKING | `BASE_LOCKED` di tahap tekstur, `IN_REVIEW` saat review |
| `build_base_mesh` | `note?` | Jalankan `work/base.py` → ekspor tanpa material → pipeline → contact sheet clay | `BRIEF_REQUIRED`, `IN_REVIEW`, `BASE_LOCKED`, `BUILD_CAP_REACHED` (`BUILD_CAPS.base`, sekarang 8 per pesan) |
| `build_textured_asset` | `note?` | Jalankan `work/material.py` (+ skrip bentuk dasar yang disetujui) → bake atlas → pipeline → cek bentuk → contact sheet bertekstur | `BASE_NOT_APPROVED`, `IN_REVIEW`, `ASSET_DONE`, `BUILD_CAP_REACHED` (`BUILD_CAPS.textured`, sekarang 4), `LIBRARY_MISSING`, `SHAPE_DRIFT` |
| `list_materials` | `query?`, `category?`, `limit?` | Cari katalog CC0 lokal; lembar contoh sebagai gambar | `LIBRARY_MISSING` |
| `inspect_version` | `version`, `mode` (`clay`/`wireframe`/`texture`), `views?` | Render ulang versi tanpa build | `VERSION_NOT_FOUND` |
| `list_versions` | — | Daftar versi + statistik + status budget | — |
| `submit_for_review` | `version`, `summary` | Kirim versi tahap ini untuk review; build dikunci | `WRONG_STAGE`, `IN_REVIEW`, `VALIDATION_FAILED` (error validator > 0), `BUDGET_EXCEEDED` (lewat maks tier) |

Kode error tool (`ForgeErrorCode`) = `RejectCode` dari `transition()` + `SCRIPT_MISSING`, `BUDGET_EXCEEDED`,
`VALIDATION_FAILED`, `SCRIPT_ERROR`, `TIMEOUT`, `OOM`, `VERSION_NOT_FOUND`, `CANCELLED`, `SHAPE_DRIFT`,
`LIBRARY_MISSING`. Skrip di atas `SCRIPT_MAX_BYTES` (256 KB) ditolak `SCRIPT_ERROR`.

**Gerbang build** dicek dua kali: `#buildGate()` tanpa efek, lalu `build_start` diterapkan lewat store setelah
skripnya terbukti ada. Jadi jatah build hanya terpakai untuk build yang benar-benar berjalan.

**Hasil ringkas.** Setiap hasil berupa satu blok teks JSON (`{ ok, … }` atau `{ ok: false, code, message, … }`) dan
paling banyak satu gambar PNG (contact sheet ≤ `CONTACT_SHEET_MAX_PX`, atau lembar contoh material). Hasil build
memuat statistik, selisih ukuran terhadap brief, budget, ringkasan validator (maks. 3 pesan), sisa jatah build, dan
`detailHint` bila segitiga jauh di bawah target tier (`DETAIL_USAGE`). GLB, base64 besar, dan log panjang tidak
pernah dikirim ke Claude.

**Builder.** `AssetBuilder` (`server/agent/forge/builder.ts`) adalah pintu `forge` ke runtime. `DockerAssetBuilder`
memanggil `buildBaseVersion()`/`buildTexturedVersion()` dan meneruskan progres `HeavyLane` sebagai event
`build_progress`. `FixtureAssetBuilder` (`fixture-builder.ts`) dipakai `RUNTIME_DRIVER=fixture`. Detailnya di
[Runtime 3D](03-runtime-3d.md).

## Prompt dan knowledge
- `server/agent/prompts/system.md`: persona technical 3D artist, alur dua tahap, cara membaca contact sheet, dan
  aturan. Bahasa Indonesia.
- `systemPromptAppend()` (`server/agent/prompts.ts`) menambah bagian "Aset ini": tier, target segitiga, tekstur,
  batas build, dan path folder knowledge serta `refs/`.
- `runtime/knowledge/`: `API.md` (API `assetkit`), `CONVENTIONS.md`, dan resep `cookbook/*.md`. Claude membacanya
  dengan Read. Perubahan API `assetkit` ikut memperbarui `API.md` dan cookbook (dijaga `server/agent/knowledge.test.ts`).

## Driver palsu
`AGENT_DRIVER=fake` memakai `ScenarioAgentPort` (`server/agent/scenario-port.ts`) dengan `defaultScenario()`
(`server/agent/scenarios.ts`). Tanpa proses Claude dan tanpa kuota.

- Skenario bekerja menurut status aset (dibaca lewat `list_versions`) dan memakai skrip contoh peti dari
  `runtime/samples/`, sehingga juga valid dengan `RUNTIME_DRIVER=docker`.
- Tool dipanggil lewat jalur yang sama dengan CLI asli: hook PreToolUse, `canUseTool`, dan server MCP `forge`
  (InMemoryTransport). Keluarannya pesan SDK sungguhan (`server/agent/fake-messages.ts`).
- Penanda di pesan pemilik (`SCENARIO_MARKERS`):

| Penanda | Perilaku |
|---|---|
| `[tanya]` | Kartu pertanyaan pilih satu sebelum brief |
| `[tanya-banyak]` | Kartu pertanyaan pilih banyak |
| `[macet]` | Berpikir, mulai stream jawaban, lalu diam sampai Stop |
| `[batas]` | Batas pemakaian tercapai (reset 1 jam lagi menurut jam yang disuntikkan) |
| `[mati]` | Proses Claude mati di tengah giliran |
| `[keluar]` | Claude Code belum login (`authentication_failed`) |

Untuk tes unit runner tersedia `FakeAgentPort` (`server/agent/fake-port.ts`), yang lebih sederhana.

## Merekam fixture SDK
Fixture kontrak ada di `tests/fixtures/sdk/` (sekarang `base-peti.jsonl`) dan dibaca `server/agent/contract.test.ts`.

1. Jalankan `bun run eval:base` (atau `eval:texture`). **Memakai kuota; minta izin pemilik dulu.** Skrip membungkus
   port dengan `recordingPort()` dan menulis `eval/runs/<waktu>/<kasus>/raw.jsonl`, sudah disanitasi.
2. Jalankan `bun scripts/sdk-fixture.ts <raw.jsonl> <nama>`. Delta stream dipangkas dan `sanitize()` dijalankan
   sekali lagi. Hasilnya `tests/fixtures/sdk/<nama>.jsonl`.
3. Periksa fixture: tidak boleh ada email, id akun, path home, atau data pribadi. `sanitize()`
   (`server/agent/sanitize.ts`) mengganti email, kunci sensitif, path home, dan base64 gambar.

Upgrade Agent SDK: rekam ulang fixture, jalankan tes kontrak, dan catat di [TECH_STACK](../TECH_STACK.md).

## Lihat juga
- [Arsitektur](01-arsitektur.md)
- [Runtime 3D](03-runtime-3d.md)
- [Data](05-data.md#mesin-status)
- [Keamanan](06-keamanan.md)
- [Tes](08-tes.md)
- [Status dan masalah](../fitur/08-status-dan-masalah.md)
- [AGENTS.md](../../AGENTS.md), [PLAN](../PLAN.md)

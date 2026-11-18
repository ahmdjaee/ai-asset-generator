# API

Semua rute HTTP di bawah `/api`, format error, pagar Host/Origin, dan protokol WebSocket `/api/ws`.

## Dasar
- Rute dirakit di `server/app.ts` (`createApi`): `/api/health`, `/api/assets`, `/api/settings`, dan `/api/ws`.
  Tipe rantai rute (`AppType`) dipakai client `hc` di web, jadi request dan respons bertipe sampai ke React.
- Handler tipis: validasi zod lewat `validate()` (`server/http/validate.ts`), lalu `AssetService` (aksi),
  `AssetQueries` (baca), `ExportService`, `SettingsService`, `AccountProbe`, atau `RuntimeStatusService`.
- Gerbang status (tahap, review, pertanyaan terbuka) ditegakkan di service dan `transition()`, bukan di rute.
- Body JSON dibatasi `JSON_BODY_MAX_BYTES` (`jsonLimit`). Multipart dibatasi `UPLOAD_MAX_REQUEST_BYTES`
  (`uploadLimit`); `maxRequestBodySize` Bun sedikit di atasnya, supaya Hono yang menjawab 413 dalam JSON.
- `idleTimeout` Bun = `HTTP_IDLE_TIMEOUT_S`; file dan ZIP di-stream.
- Path `/api/*` yang tidak dikenal dijawab 404 `NOT_FOUND`.

## Format error
Setiap error berbentuk `{ code, message }`. Pesan berbahasa Indonesia dan aman ditampilkan; detail teknis hanya di log.

```json
{ "code": "IN_REVIEW", "message": "Versi sudah dikirim untuk review; build dan brief dikunci sampai pemilik membalas." }
```

`createErrorHandler()` (`server/http/errors.ts`) memetakan error:

| Sumber | Status | `code` |
|---|---|---|
| `AppError` | sesuai error | `VALIDATION_FAILED` (400, dari `validate()`), dll. |
| `ServiceError` (`server/services/errors.ts`) | dari tabel `SERVICE_STATUS` | kode service |
| `HTTPException` Hono | status aslinya | `NOT_FOUND` bila 404, selain itu `BAD_REQUEST` |
| `bodyLimit` | 413 | `PAYLOAD_TOO_LARGE` |
| Pagar Host/Origin | 403 | `FORBIDDEN` |
| Error lain (bug) | 500 | `INTERNAL`; detail dicatat ke log |

### Kode stabil
Kode HTTP: `BAD_REQUEST`, `VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `INTERNAL`.

Kode service dan statusnya (`SERVICE_STATUS`; tabel ditulis lengkap, jadi kode baru wajib diberi status):

| Status | Kode |
|---|---|
| 400 | `EMPTY_MESSAGE`, `MESSAGE_TOO_LONG`, `INVALID_ANSWER`, `INVALID_NAME`, `TOO_MANY_FILES`, `INVALID_FILE`, `INVALID_SETTINGS` |
| 404 | `ASSET_NOT_FOUND`, `QUESTION_NOT_FOUND`, `VERSION_NOT_FOUND`, `FILE_NOT_FOUND` |
| 409 | Gerbang `transition()`: `IN_REVIEW`, `BASE_LOCKED`, `BRIEF_REQUIRED`, `BASE_NOT_APPROVED`, `BUILD_CAP_REACHED`, `WRONG_STAGE`, `ASSET_DONE`, `NOT_IN_REVIEW`, `NO_VERSION`, `QUESTION_OPEN`, `NOT_FAILED`, `NOT_INTERRUPTED`, `SHAPE_CHANGE_NOT_ALLOWED`. Runtime: `RUNTIME_BUSY`, `RUNTIME_UNAVAILABLE`, `RUNTIME_NOT_READY` |
| 413 | `FILE_TOO_LARGE` |
| 415 | `UNSUPPORTED_FILE` |
| 500 | `EXPORT_FAILED` |

409 berarti aksinya sah, tetapi tidak berlaku pada status aset saat ini. Arti tiap gerbang ada di
[Data](05-data.md#mesin-status).

## Pagar Host/Origin
`hostOriginGuard()` (`server/http/guard.ts`) dipasang untuk semua rute (`app.use("*")`), sehingga juga berjalan
sebelum upgrade WebSocket.

| Cek | Lolos bila |
|---|---|
| `Host` | Tidak ada, atau hostname `127.0.0.1`, `localhost`, `::1` (melawan DNS rebinding) |
| `Origin` | Tidak ada (curl, skrip lokal), atau `http:` + hostname loopback + port API atau port Vite dev (`WEB_DEV_PORT`) |
| `Sec-Fetch-Site` | Untuk metode selain GET/HEAD: bukan `cross-site` |

Origin `null` dan nilai rusak ditolak. Alasan dan model ancamannya ada di [Keamanan](06-keamanan.md).

## Rute kesehatan
`server/http/routes/health.ts`. `?fresh=1` melewati cache (tombol "Periksa ulang").

| Metode | Path | Query/body | Respons | Error |
|---|---|---|---|---|
| GET | `/api/health` | — | `{ ok: true, version }` | — |
| GET | `/api/health/auth` | `fresh?=1` | `{ auth: AuthStatus }` | `VALIDATION_FAILED` |
| GET | `/api/health/runtime` | `fresh?=1` | `{ runtime: RuntimeStatus }` | `VALIDATION_FAILED` |
| POST | `/api/health/runtime/image` | — | 202 `{ runtime: RuntimeStatus }`; selesai lewat event `runtime` | `RUNTIME_BUSY`, `RUNTIME_UNAVAILABLE` |

`AuthStatus` (`shared/health.ts`) punya `state`: `ok` (dengan `email`, `subscription`, `organization`, `models`),
`logged_out`, `api_key`, atau `error`. Hasilnya di-cache `AccountProbe` (`server/agent/account.ts`).
`RuntimeStatus` memuat `driver`, `ready`, `docker`, `image`, `blender`, `renderer`, `materials`, dan `build`.

## Rute aset
`server/http/routes/assets.ts`. Id aset, pertanyaan, dan lampiran harus cocok `^[A-Za-z0-9_-]{1,64}$`.
Aksi di Studio menjawab `{ asset: AssetView }` terbaru (lihat `assetView()` di `server/services/asset-queries.ts`).

### Daftar, buat, detail
| Metode | Path | Query/body | Respons | Error khas |
|---|---|---|---|---|
| GET | `/api/assets` | `AssetListQuery` (`shared/asset-list.ts`): `q?`, `tier?`, `stage?` (`base`/`textured`/`done`), `since?` (ms epoch), `sort?` (`updated`/`oldest`/`name`) | `{ assets: AssetListItem[], total }` | `VALIDATION_FAILED` |
| POST | `/api/assets` | multipart: `prompt`, `tierId` (`ringan`/`sedang`/`maksimal`), `name?`, `files[]?` | 201 `{ asset }` | `EMPTY_MESSAGE`, `MESSAGE_TOO_LONG`, `INVALID_NAME`, `TOO_MANY_FILES`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE`, `INVALID_FILE`, `RUNTIME_NOT_READY` |
| GET | `/api/assets/:id` | — | `{ asset, versions: VersionView[], attachments: AttachmentView[] }` | `ASSET_NOT_FOUND` |
| PATCH | `/api/assets/:id` | JSON `{ name }` | `{ asset }` | `INVALID_NAME`, `ASSET_NOT_FOUND` |
| DELETE | `/api/assets/:id` | — | 204 | `ASSET_NOT_FOUND` |
| POST | `/api/assets/:id/duplicate` | — | 201 `{ asset }` (aset baru) | `ASSET_NOT_FOUND` |

`AssetListItem` = `AssetView` + `current` (versi terkini: `n`, `stage`, `triangles`, `webBytes`, `thumbnail`),
`versionCount`, dan `progress` (build yang sedang berjalan, atau `null`).

### Thread dan pesan
| Metode | Path | Query/body | Respons | Error khas |
|---|---|---|---|---|
| GET | `/api/assets/:id/events` | `before?` (seq), `limit?` (≤ `EVENTS_PAGE_MAX`, bawaan `EVENTS_PAGE_DEFAULT`) | `{ events: StoredEvent[], hasMore }`, urut naik | `ASSET_NOT_FOUND` |
| POST | `/api/assets/:id/messages` | multipart: `text`, `files[]?` | `{ asset }` | `QUESTION_OPEN`, kode pesan dan lampiran, `RUNTIME_NOT_READY` |
| POST | `/api/assets/:id/revise` | multipart: `text`, `files[]?` | `{ asset }` | `NOT_IN_REVIEW`, `QUESTION_OPEN`, kode pesan dan lampiran, `RUNTIME_NOT_READY` |
| POST | `/api/assets/:id/answers/:questionId` | JSON `{ answers: { [pertanyaan]: { selected: string[], other?: string } } }` | `{ asset }` | `QUESTION_NOT_FOUND`, `INVALID_ANSWER` |

Tanpa `before`, `/events` mengembalikan halaman terbaru. `hasMore` benar bila seq pertama di halaman > 1.

### Aksi Studio
Semua `POST`, jawaban `{ asset }`. Gerbangnya dari `transition()` (`server/domain/status.ts`).

| Path | Body | Gerbang utama |
|---|---|---|
| `/api/assets/:id/approve` | JSON `{ note? }` | `NOT_IN_REVIEW` (harus `BASE_REVIEW`), `NO_VERSION`, `QUESTION_OPEN` |
| `/api/assets/:id/finish` | — | `NOT_IN_REVIEW` (harus `TEXTURE_REVIEW`) |
| `/api/assets/:id/change-shape` | JSON `{ text }` | `SHAPE_CHANGE_NOT_ALLOWED` (harus `TEXTURE_REVIEW` atau `DONE`) |
| `/api/assets/:id/stop` | — | Tidak pernah ditolak gerbang; tanpa giliran berjalan tidak ada efek |
| `/api/assets/:id/retry` | — | `NOT_FAILED` |
| `/api/assets/:id/resume` | — | `NOT_INTERRUPTED` |

Aksi yang mengirim pesan ke Claude juga bisa gagal `RUNTIME_NOT_READY` (Docker mati atau image belum ada).

### File dan ekspor
| Metode | Path | Query/body | Respons | Error khas |
|---|---|---|---|---|
| GET | `/api/assets/:id/versions/:version/:file` | `file` cocok `^[a-z0-9][a-z0-9._-]{0,63}$` | File: nama di manifest versi, atau `contact-sheet.png`/`thumb.webp`/`turntable.webp` dari `derived/` | `VERSION_NOT_FOUND`, `FILE_NOT_FOUND` |
| GET | `/api/assets/:id/attachments/:attachmentId` | — | Gambar (inline) atau model (unduhan dengan nama asli) | `FILE_NOT_FOUND` |
| GET | `/api/assets/:id/export` | `version`, `preset` (`web`/`unity`/`source`) | File unduhan (`<nama>-v<N>-web.glb`, `-unity.glb`, `-sumber.zip`) | `ASSET_NOT_FOUND`, `VERSION_NOT_FOUND`, `EXPORT_FAILED` |
| GET | `/api/assets/:id/export/estimate` | `version` | `{ version, presets: [{ preset, fileName, bytes, exact }] }` | `ASSET_NOT_FOUND`, `VERSION_NOT_FOUND` |
| POST | `/api/assets/export-zip/prepare` | JSON `{ ids: string[], preset: "web" \| "unity" }` | `{ assets, bytes }` | `NO_VERSION`, `ASSET_NOT_FOUND`, `EXPORT_FAILED` |
| GET | `/api/assets/export-zip` | `ids` (dipisah koma), `preset` (`web`/`unity`) | ZIP streaming (versi terkini tiap aset) | sama dengan `prepare` |

- `ids` maks. `EXPORT_ZIP_MAX_ASSETS`; duplikat dibuang (`shared/export.ts`). Web memanggil `prepare` dulu, supaya
  kesalahan tampil sebagai JSON, bukan unduhan terputus.
- Respons file (`fileResponse()` di `server/http/files.ts`) di-stream dari disk dengan `X-Content-Type-Options:
  nosniff` dan `Content-Security-Policy: default-src 'none'; sandbox`. File versi dan lampiran memakai
  `Cache-Control: private, max-age=31536000, immutable`; file turunan `no-cache`.

## Rute pengaturan
`server/http/routes/settings.ts`.

| Metode | Path | Body | Respons | Error |
|---|---|---|---|---|
| GET | `/api/settings` | — | `{ settings: AppSettings }` | — |
| PUT | `/api/settings` | `AppSettings` lengkap: `model`, `effort`, `defaultTier`, `tiers` | `{ settings }` | `VALIDATION_FAILED`, `INVALID_SETTINGS` (model tidak tersedia untuk akun, atau effort tidak didukung model) |

Skemanya `SettingsBody` di `shared/settings.ts`; batas budget dari `TIER_BUDGET_LIMITS`. Penyimpanan memicu event
`settings` di topik `global`.

## WebSocket `/api/ws`
Protokol di `shared/realtime.ts`, hub di `server/realtime/hub.ts`, rute upgrade di `server/realtime/route.ts`.
Satu sambungan per tab browser; beberapa langganan per sambungan (maks. `WS_MAX_SUBSCRIPTIONS`).

### Pesan
| Arah | Bentuk | Arti |
|---|---|---|
| Klien → server | `{ op: "sub", sid, topic, after? }` | Berlangganan. `sid` dipilih klien (1…1e9). `after` = seq terakhir yang sudah dimiliki |
| Klien → server | `{ op: "unsub", sid }` | Berhenti berlangganan |
| Server → klien | `{ sid, op: "ready" }` | Langganan terpasang dan replay selesai |
| Server → klien | `{ sid, event }` | Satu `TopicEvent` |
| Server → klien | `{ sid, error }` | Langganan ditolak (mis. aset tidak ada) |
| Server → klien | `{ op: "hb" }` | Detak tiap `WS_HEARTBEAT_MS` (browser tidak bisa melihat ping protokol) |

Pesan biner, JSON rusak, atau di luar skema diabaikan. Ukuran pesan klien dibatasi `WS_MAX_PAYLOAD_BYTES`.

### Topik dan event
`topic` harus cocok `^(global|asset:<id>)$`.

| Topik | `event.type` | Isi |
|---|---|---|
| `global` | `asset` | `{ assetId, change: "created" \| "updated" \| "deleted" }` |
| `global` | `asset_progress` | `{ assetId, stage, pct }` — live, boleh dibuang |
| `global` | `settings`, `runtime`, `auth` | Tanpa isi; klien mengambil ulang data terkait |
| `asset:<id>` | `thread` | `{ stored: StoredEvent }`; `stored.seq` null = event live |
| `asset:<id>` | `resync` | Klien tertinggal lebih dari `WS_REPLAY_MAX_EVENTS`; muat ulang thread lewat HTTP |
| `asset:<id>` | `asset_deleted` | Aset dihapus |

`StoredEvent` = `{ assetId, seq, ts, event }`. `event` adalah `AssetEvent` (`shared/asset-events.ts`): event sesi
Claude dari `shared/agent-events.ts` (`init`, `user`, `delta`, `assistant`, `thinking`, `tool`, `tool_result`,
`question`, `question_resolved`, `brief`, `build_started`, `build_progress`, `build_finished`, `submitted`,
`notice`, `error`, `result`) ditambah `state` (status, `runState`, `lastError`, versi, `buildsLeft`) dan `action`
(aksi pemilik: `approve`, `finish`, `change_shape`, `stop`, `retry`, `resume`).

`delta` dan `build_progress` adalah event live (`LIVE_ONLY_EVENTS`): tanpa `seq`, tidak disimpan, tidak di-replay.
Teks lengkapnya tetap datang lewat `assistant` dan hasil build.

### Replay dan resync
Saat `sub` dengan `after`, hub membaca event ber-seq > `after` dari database (`AssetQueries.replay()`), mengirimnya,
lalu langsung berlangganan ke bus. Keduanya sinkron berurutan, jadi tanpa celah dan tanpa duplikat. `ready` dikirim
sesudahnya: snapshot HTTP yang diambil setelah `ready` tidak kehilangan event (event ganda disaring klien lewat
`seq`). Bila yang tertinggal lebih dari `WS_REPLAY_MAX_EVENTS`, hub mengirim `resync` alih-alih replay.

### Backpressure
`ServerWebSocket.send()` Bun mengembalikan -1 (masuk antrean), 0 (dibuang), atau jumlah byte.

| Keadaan | Event live (`seq` null, progres) | Event penting |
|---|---|---|
| Padat (`send` terakhir -1, sampai `drain`) atau antrean > `WS_SOFT_BUFFER_BYTES` | dilewati | dikirim |
| Antrean > `WS_HARD_BUFFER_BYTES` | — | sambungan ditutup (1013) |
| `send` mengembalikan 0 | diabaikan | sambungan ditutup (1013) |

Klien yang diputus menyambung ulang dengan `after`, dan replay menutup celahnya. Saat server berhenti, semua
sambungan ditutup dengan kode 1001.

### Contoh
```json
{ "op": "sub", "sid": 7, "topic": "asset:a1b2c3", "after": 41 }
```
```json
{ "sid": 7, "event": { "type": "thread", "stored": { "assetId": "a1b2c3", "seq": 42, "ts": 1794960000000,
  "event": { "type": "build_finished", "jobId": "j-1", "ok": true, "version": 3 } } } }
```
```json
{ "sid": 7, "op": "ready" }
```

## Lihat juga
- [Arsitektur](01-arsitektur.md#alur-satu-giliran)
- [Data](05-data.md)
- [Keamanan](06-keamanan.md)
- [Frontend](07-frontend.md)
- [Menambah fitur](09-menambah-fitur.md)
- [Studio](../fitur/02-studio.md), [Ekspor](../fitur/05-ekspor.md)
- [PLAN](../PLAN.md) Lampiran F, [AGENTS.md](../../AGENTS.md) §5

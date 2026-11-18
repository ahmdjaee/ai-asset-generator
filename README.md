# AI Asset Generate

App web lokal untuk membuat aset 3D `.glb` dari prompt dan gambar referensi.

- **Claude** menulis skrip Blender lewat sesi login Claude Code, tanpa API key.
- **Skrip berjalan headless** di sandbox Docker.
- **Claude melihat render-nya** lalu memperbaiki sendiri.
- **Dua tahap:** bentuk dasar abu-abu → Anda setujui → aset final bertekstur.
- **Hasil** bisa diekspor untuk web (meshopt + WebP), Unity, atau sebagai sumber (`.blend` + skrip).

App ini untuk **satu pengguna di satu mesin**. Server hanya mendengar `127.0.0.1`: user yang menjalankannya anggota grup
`docker` (setara root), jadi app ini **jangan pernah** dibuka ke jaringan atau dipasang di belakang proxy publik.

Dokumen lain:
- **[Dokumentasi lengkap](docs/README.md):** panduan semua fitur untuk pemakai dan dokumentasi teknis untuk developer.
- [`AGENTS.md`](AGENTS.md): aturan pengembangan.
- [`docs/PLAN.md`](docs/PLAN.md): rencana dan log keputusan.
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md): library dan versinya.

## Kebutuhan
| Komponen | Versi | Catatan |
|---|---|---|
| Linux x86_64 | — | Diuji di Ubuntu dengan iGPU AMD; Blender berjalan di CPU |
| Bun | ≥ 1.4.4 | `curl -fsSL https://bun.sh/install \| bash` |
| Docker Engine | 29 | User harus anggota grup `docker` |
| Claude Code | terbaru | CLI `claude` di `~/.local/bin`, sudah login dengan langganan Claude |
| Ruang disk | ≥ 10 GB | Image Blender ±2 GB, ditambah aset, versi, dan backup |
| RAM | ≥ 8 GB | Bake tekstur Maksimal memakai hingga 2,5 GB di container |

Jangan mengisi `ANTHROPIC_API_KEY` atau `ANTHROPIC_AUTH_TOKEN`. App selalu memakai sesi login Claude Code: kedua
variabel itu dibuang dari env proses Claude. Bila Claude Code tetap memakai API key dari sumber lain, app menampilkan
banner, dan `bun run doctor` gagal.

## Instalasi
```bash
cd /var/www/ai-asset-generate

# 1. Dependensi (persis sesuai bun.lock) dan browser untuk renderer.
bun install --frozen-lockfile
bunx playwright install chromium

# 2. Login Claude Code (sekali): jalankan `claude`, ketik /login, lalu keluar.
#    Setelah itu pastikan app memakai sesi login, bukan API key.
claude
bun run check:auth

# 3. Image Blender untuk Docker (±11 menit pertama kali, ±2 GB).
bun run runtime:build

# 4. Pustaka material CC0 dari ambientCG (butuh internet, sekali).
bun run textures:sync

# 5. Build web, lalu cek kesiapan mesin.
bun run build
bun run doctor
```

`bun run doctor` memeriksa:
- versi Bun;
- CLI `claude` dan login-nya;
- Docker dan image runtime;
- Chromium;
- ruang disk;
- port 4340/4341;
- izin folder `data/`.

Setiap pemeriksaan yang gagal disertai langkah perbaikan.

Konfigurasi bawaan sudah cukup. Untuk mengubahnya (port, folder data, level log), salin `.env.example` ke `.env`.

## Menjalankan
**Sekali jalan** (berhenti dengan Ctrl+C):

```bash
NODE_ENV=production bun server/main.ts
```

Lalu buka <http://127.0.0.1:4340>. Perintah `bun run start` melakukan hal yang sama, tetapi membangun ulang web
setiap kali.

**Mode pengembangan:** server dan Vite dengan hot reload di <http://127.0.0.1:4341>.

```bash
bun run dev
```

**Tanpa Claude dan tanpa Docker** (skenario palsu, tidak memakai kuota):

```bash
AGENT_DRIVER=fake RUNTIME_DRIVER=fixture bun run dev
```

### Menjalankan otomatis (systemd)
Unit user ada di [`deploy/ai-asset-generate.service`](deploy/ai-asset-generate.service). Dua barisnya wajib:
- **`WorkingDirectory`:** root repo. Bun membaca `.env` dari sini, dan `data/` relatif terhadapnya. Ubah bila repo
  dipindah.
- **`PATH`:** memuat `~/.bun/bin` dan `~/.local/bin`. Tanpa `~/.local/bin`, Agent SDK tidak menemukan `claude`: server
  tampak sehat, tetapi setiap giliran Claude gagal.

Memasang:

```bash
bun run build
mkdir -p ~/.config/systemd/user
cp deploy/ai-asset-generate.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ai-asset-generate
```

Bila app harus jalan sejak boot tanpa login desktop, aktifkan sekali: `sudo loginctl enable-linger "$USER"`.

| Perintah | Fungsi |
|---|---|
| `systemctl --user status ai-asset-generate` | Status |
| `journalctl --user -u ai-asset-generate -f` | Log berjalan (JSON pino) |
| `systemctl --user restart ai-asset-generate` | Mulai ulang (setelah update) |
| `systemctl --user disable --now ai-asset-generate` | Hentikan dan matikan auto-start |

Unit memberi server 30 detik untuk berhenti dengan rapi: menutup sesi Claude, menghentikan job Docker, dan menutup
Chromium. Giliran Claude yang terputus karena restart tampil sebagai kartu **Lanjutkan** di Studio.

## Update
```bash
cd /var/www/ai-asset-generate
git pull
bun install --frozen-lockfile
bunx playwright install chromium   # hanya berpengaruh bila versi Playwright berubah
bun run build
systemctl --user restart ai-asset-generate
bun run doctor
```

- **Migrasi database** berjalan otomatis saat server start. Backup harian sudah dibuat sebelumnya, tetapi untuk
  update besar sebaiknya buat backup manual dulu (lihat di bawah).
- **Bila `runtime/` berubah,** tag image ikut berubah, dan app menampilkan banner runtime belum siap. Bangun ulang lewat
  tombol **Bangun image**, atau `bun run runtime:build`.

## Data, backup, dan restore
Semua data ada di `data/` (tidak masuk git):

| Path | Isi |
|---|---|
| `data/app.db` | Database SQLite: aset, versi, percakapan, pengaturan |
| `data/assets/<id>/` | Lampiran (`refs/`), kerja Claude (`work/`), versi (`versions/vN`, read-only), turunan (`derived/`) |
| `data/library/materials/` | Pustaka material CC0 (bisa diunduh ulang dengan `bun run textures:sync`) |
| `data/backups/` | Backup database harian |
| `data/jobs/` | Folder job Blender sementara |

**Pemeliharaan otomatis** berjalan saat server start lalu setiap jam:
- **Backup database harian:** `VACUUM INTO data/backups/app-YYYYMMDD.db`. Tujuh backup terbaru disimpan.
- **Folder job usang:** folder job yang tertinggal lebih dari sehari dihapus.
- **Cache ekspor usang:** cache Unity/Sumber yang tidak diubah 30 hari dihapus, begitu juga ZIP Sumber bernama lama
  dan sisa file sementara. Cache dibuat ulang saat diunduh.

Thumbnail, versi, dan aset tidak pernah dihapus oleh pemeliharaan.

> Backup harian **hanya berisi database**. File aset (`data/assets/`) perlu disalin sendiri.

**Backup lengkap manual** (database + semua file):

```bash
systemctl --user stop ai-asset-generate
cp -a data ~/cadangan/ai-asset-generate-$(date +%Y%m%d)
systemctl --user start ai-asset-generate
```

`cp -a` mempertahankan izin read-only folder versi. Untuk menghapus salinan lama, jalankan `chmod -R u+w` dulu.

**Restore database** dari backup harian:

```bash
systemctl --user stop ai-asset-generate
ls data/backups/                         # pilih tanggalnya
cp data/app.db data/app.db.sebelum-restore
rm -f data/app.db-wal data/app.db-shm
cp data/backups/app-20261118.db data/app.db
systemctl --user start ai-asset-generate
```

Aset yang dibuat setelah tanggal backup tidak tampil lagi. Foldernya tetap ada di `data/assets/`, tetapi tidak
terhubung ke database.

**Restore lengkap:** hentikan service, ganti seluruh `data/` dengan salinan manual, lalu start lagi.

## Pemecahan masalah
Mulai selalu dengan `bun run doctor`, lalu lihat log:
- dengan systemd: `journalctl --user -u ai-asset-generate -n 200`;
- tanpa systemd: output terminal.

| Gejala | Penyebab dan solusi |
|---|---|
| Banner **"Claude Code belum login"** | Jalankan `claude` di terminal, ketik `/login`, lalu tekan **Periksa ulang** |
| Banner **"Claude Code memakai API key"** | Hapus `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` dari profil shell dan pengaturan Claude Code, lalu **Periksa ulang** |
| Banner **"Claude Code tidak bisa dijalankan"**, atau giliran Claude selalu gagal | `claude` tidak ada di `PATH` proses server. Periksa baris `PATH` di unit systemd (§ Menjalankan otomatis) |
| **"Batas pemakaian Claude tercapai"** di thread | Kuota langganan habis. Waktu reset tertera di thread; tekan **Coba lagi** setelah lewat |
| Banner **"Docker tidak terjangkau"** | `sudo systemctl start docker`. Pastikan user ada di grup `docker` (`groups`), lalu login ulang |
| Banner **"Runtime 3D belum siap: image belum dibangun"** | Tekan **Bangun image** di banner atau Pengaturan, atau `bun run runtime:build` |
| **"Gagal membangun image runtime"** | Akhir log build tampil di Pengaturan. Biasanya karena jaringan saat `pip install`; coba lagi |
| Render atau thumbnail gagal | Chromium belum terpasang: `bunx playwright install chromium` |
| Server tidak mau start: **port 4340 sudah dipakai** | Cari prosesnya: `ss -ltnp 'sport = :4340'`. Mungkin service dan `bun run dev` berjalan bersamaan |
| Kartu **"Proses Claude terputus"** setelah restart | Wajar: server berhenti di tengah giliran. Tekan **Lanjutkan** |
| Disk penuh | Hapus aset yang tidak dipakai di Gudang. Backup lama dan cache ekspor dibersihkan otomatis |
| Container job tertinggal | Dibersihkan otomatis saat server start. Cek manual: `docker ps -a --filter label=aag.job` |
| Halaman kosong di mode production | `dist/` belum ada: jalankan `bun run build`, lalu restart |

## Pengembangan
| Perintah | Fungsi |
|---|---|
| `bun run check` | Lint, typecheck, semua tes unit/komponen, cakupan. Wajib hijau |
| `bun run e2e` | Playwright + axe terhadap build mode test (port 4342) |
| `bun run e2e:api` | Alur penuh lewat HTTP + WebSocket dalam mode palsu |
| `RUNTIME_IT=1 bun test tests/integration/runtime` | Tes runtime dengan Docker sungguhan |
| `bun run test:pipeline` | Renderer dan golden image |

Daftar lengkap ada di [`AGENTS.md`](AGENTS.md) §12. Perintah yang memakai kuota Claude (`eval:*`,
`AGENT_DRIVER=sdk`) hanya dijalankan dengan sengaja.

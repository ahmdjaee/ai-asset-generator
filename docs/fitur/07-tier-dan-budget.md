# Tier dan budget

Tier menentukan batas segitiga, material, tekstur, dan ukuran file yang harus dipenuhi Claude untuk satu aset.

## Tier bawaan

Nilai dari `DEFAULT_TIERS` di `shared/limits.ts`. Ukuran file memakai KB/MB desimal (1 KB = 1000 byte).

| | **Ringan** | **Sedang** | **Maksimal** |
|---|---|---|---|
| Cocok untuk | Mobile, web ringan, prototipe | Game PC, web, AR | Tampilan dekat, PC kelas atas |
| Segitiga target / maks | 2.000 / 3.000 | 8.000 / 12.000 | 30.000 / 50.000 |
| Material (maks, = draw call) | 1 | 2 | 3 |
| Tekstur warna (`baseColor`) | 512 px | 1024 px | 2048 px |
| Normal map | Tidak ada | 1024 px | 2048 px |
| ORM (AO, kekasaran, logam) | Tidak ada | 512 px | 1024 px |
| Emisi | Tidak ada | Tidak ada | 1024 px |
| web.glb target / maks | 150 KB / 300 KB | 800 KB / 1,5 MB | 3 MB / 5 MB |

Ukuran tekstur adalah sisi terpanjang per slot. Slot yang tidak ada di tier tidak diizinkan. Semua material di-bake ke
satu atlas seukuran slot tersebut.

## Cara budget dipakai

| Angka | Akibat |
|---|---|
| Sampai target | Meter **Anggaran tier** berwarna biasa |
| Di atas target, di bawah maks | Kuning; masih diterima |
| Di atas maks | Merah; build ditolak dan Claude harus memperbaikinya |

Segitiga bentuk dasar yang sedikit di atas maks (paling banyak `SIMPLIFY_MAX_OVERSHOOT` × maks, sekarang 1,25×)
disederhanakan otomatis. Ini hanya untuk bentuk dasar.

Pemeriksaan budget dilakukan harness (`checkBudget` di `shared/limits.ts`) setelah optimasi, bukan oleh skrip Claude.

## Mengubah budget

Budget tiap tier bisa diubah di [Pengaturan](06-pengaturan.md) › **Aset baru** › **Budget per tier**. Batasnya ada di
`TIER_BUDGET_LIMITS`:

| Isian | Minimal | Maksimal (= Maksimal bawaan) |
|---|---|---|
| Segitiga | 100 | 50.000 |
| Material | 1 | 3 |
| Ukuran web.glb | 50 KB | 5 MB |
| Sisi tekstur | Pilihan `TEXTURE_SIZE_OPTIONS`: 256, 512, 1024, 2048 px | |

Batas atas mengikuti tier **Maksimal** bawaan, yang waktu bake dan RAM-nya sudah diuji di mesin ini.

## Snapshot tier per aset

Saat aset dibuat, tier dan budget yang berlaku saat itu disalin ke aset (`tierSnapshot`). Akibatnya:

- mengubah budget di Pengaturan hanya berlaku untuk aset baru;
- aset lama tetap diperiksa dengan budget saat dibuat, termasuk saat direvisi;
- duplikat membawa snapshot aset asalnya;
- ekspor **Sumber** aset final menyertakan snapshot ini sebagai `budget.json`.

Tier aset tampil di topbar sesi, kartu Gudang, dan panel **Detail**. Tier tidak bisa diubah setelah aset dibuat.

## Batas build per pesan

Setiap giliran baru, yaitu pesan Anda, **Setujui & lanjut tekstur**, atau **Ubah bentuk dasar**, memberi Claude jatah
build baru. Menjawab kartu pertanyaan tidak membuka giliran baru.

| Tahap | Batas | Konstanta |
|---|---|---|
| Bentuk dasar | 8 build | `BUILD_CAPS.base` |
| Aset final | 4 build | `BUILD_CAPS.textured` |

Setelah jatah habis, server menolak build berikutnya. Claude harus menyerahkan versi terbaiknya atau menjelaskan
kendalanya, lalu menunggu pesan Anda.

## Batas waktu dan memori build

Setiap build berjalan di container dengan batas di `shared/limits.ts`:

| Job | RAM | Batas waktu |
|---|---|---|
| Bentuk dasar (`BASE_JOB_LIMITS`) | 1,5 GB | 120 dtk |
| Aset final (`TEXTURED_JOB_LIMITS`) | 2,5 GB | 300 dtk |
| Aset final berat (`TEXTURED_MAX_JOB_LIMITS`) | 2,5 GB | 600 dtk |

"Berat" ditentukan dari budget, bukan nama tier: atlas warna ≥ 2048 px atau maks segitiga di atas maks **Sedang**
bawaan (12.000). Build yang melewati batas gagal dengan "melewati batas waktu" atau "kehabisan memori".

## Lihat juga
- [Pengaturan](06-pengaturan.md)
- [Studio](02-studio.md)
- [Ekspor](05-ekspor.md)
- [Runtime 3D](../teknis/03-runtime-3d.md)
- [Data](../teknis/05-data.md)

# Laporan tahap

Setiap tahap di [`../PLAN.md`](../PLAN.md) ditutup dengan laporan di folder ini.

- **Nama file:** `tahap-NN.md`, dengan NN dua digit (`tahap-00.md`, `tahap-01.md`, …).
- **Bukti visual** (screenshot, contact sheet, render) disimpan di `tahap-NN/`, lalu dirujuk dari laporan.
- **Setelah laporan ditulis:**
  1. status tahap di `PLAN.md` diubah menjadi `menunggu review`;
  2. agent berhenti dan menunggu persetujuan pemilik.
- **Isi laporan harus jujur.** Tulis apa adanya:
  - tes yang gagal;
  - langkah yang dilewati;
  - hal yang tidak bisa diverifikasi.
- **Laporan berupa file lokal**, bukan Artifact. Sertakan perintah `xdg-open` dengan path lengkap untuk setiap file
  yang perlu dilihat pemilik.

## Template
Salin blok di bawah ke `tahap-NN.md`, lalu isi. Hapus bagian yang memang tidak relevan, tetapi jangan hapus
**Bukti**, **Belum dikerjakan**, dan **Pertanyaan**.

````markdown
# Tahap N — <judul tahap>

| | |
|---|---|
| Tanggal | YYYY-MM-DD |
| Status | menunggu review |
| Kondisi repo | hash commit, atau "belum di-commit" |

## Ringkasan
2–4 kalimat:
- apa yang sekarang bisa dilakukan;
- apakah semua Definition of Done terpenuhi.

## Yang dikerjakan
- <tugas dari checklist> — file utama: `path/ke/file.ts`

## Bukti
| Perintah | Hasil |
|---|---|
| `bun run check` | lolos — N tes, 0 gagal |
| `<perintah DoD lain>` | <hasil singkat> |

## Angka
Ukuran yang diminta DoD, misalnya waktu, memori puncak, ukuran file, cakupan tes, atau skor evaluasi.

## Screenshot & file
- `docs/progress/tahap-NN/<nama>.png` — <keterangan>
  `xdg-open /var/www/ai-asset-generate/docs/progress/tahap-NN/<nama>.png`

## Keputusan
Keputusan teknis yang diambil di tahap ini. Semuanya juga dicatat di Log keputusan `PLAN.md`.

## Temuan & risiko
Masalah, keterbatasan, utang teknis, dan dampaknya ke tahap berikutnya.

## Belum dikerjakan / dipindah
Tugas yang tidak selesai atau dipindah ke tahap lain, beserta alasannya. Tulis "tidak ada" bila semuanya selesai.

## Pertanyaan untuk pemilik
Keputusan yang butuh jawaban sebelum tahap berikutnya dimulai. Tulis "tidak ada" bila tidak ada.

## Usulan tahap berikutnya
Apa yang akan dikerjakan di tahap berikutnya, dan penyesuaian rencana yang disarankan.
````

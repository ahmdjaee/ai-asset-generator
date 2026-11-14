# Konvensi aset

- **Satuan:** meter. Ukuran mengikuti dunia nyata kecuali brief meminta lain (kursi makan ±0,9 m, peti ±0,5 m,
  pohon kecil 2–4 m, pistol ±0,3 m).
- **Arah:** +Y glTF ke atas (Blender: Z ke atas). Depan aset menghadap −Y Blender, yaitu sudut "Depan" di contact sheet.
  Makhluk dan kendaraan menghadap depan; senjata genggam: laras ke arah −Y.
- **Origin:** dasar-tengah (bawah bounding box, tengah X/Y). Diatur otomatis oleh harness; aset harus berdiri di lantai.
- **Nama objek:** bahasa Indonesia, huruf kecil, garis bawah: `badan`, `kaki_depan`, `daun_0`. Nama bagian dipakai
  saat revisi ("tebalkan `kaki`").
- **Bentuk dasar = siluet, proporsi, dan detail bentuk.** Yang menunggu tahap tekstur hanya detail datar (warna, teks,
  pola, garis cat). Bevel kecil boleh supaya tepi tidak terlalu tajam di render.
- **Kepadatan dan detail sesuai tier.** Tier lebih tinggi harus terlihat lebih kaya: pakai ±40–90% target segitiga
  untuk detail yang terlihat (Sedang: mata, hidung, telapak, paku, engsel, panel; Maksimal: juga bevel halus, ukiran,
  jahitan). Jangan menghabiskan segitiga pada bagian yang tidak terlihat (bawah alas, bagian dalam).
- **Makhluk wajib punya wajah:** mata (bola + pupil) dan hidung, kecuali brief meminta lain.
- **Bagian yang nanti berwarna lain** (dada, ujung ekor, gagang, panel) dibuat sebagai objek terpisah sejak bentuk
  dasar, supaya tahap tekstur bisa memberi material berbeda tanpa mengubah bentuk.
- **Satu aset, satu objek logis.** Beberapa bagian boleh objek terpisah; harness menggabungkan yang bermaterial sama.
- **Material (tahap tekstur):** nama bahasa Indonesia seperti objek (`kayu`, `logam_sabuk`). Pilih dari pustaka
  untuk material nyata (kayu, logam, batu, kain); warna polos (`material.pbr`) untuk gaya kartun dan bagian kecil.
  Logam: `metallic=1`; bukan logam: `metallic=0`. Hindari hitam/putih murni (pakai ±#1a1a1a dan ±#f0f0f0).
- **Skala tekstur** mengikuti dunia nyata (`scale_m`): satu papan kayu 0,5–1 m, ubin 0,3–0,6 m, kain 0,2–0,4 m.
- **Lampiran pemilik** ada di `refs/` folder aset (pesan pemilik menyebut path-nya). Gambar `refs/<id>.png` dilihat
  dengan Read sebelum merencanakan; varian `<id>-decal.png` dipakai `decal.from_image`. Model 3D (glb/gltf/obj/fbx/stl)
  tidak bisa dibaca dengan Read; di container ada di `/refs/<file>` (read-only) dan bisa diimpor skrip sebagai acuan
  ukuran atau bentuk: `bpy.ops.import_scene.gltf(filepath=…)`, `bpy.ops.wm.obj_import(filepath=…)`,
  `bpy.ops.wm.stl_import(filepath=…)`, `bpy.ops.import_scene.fbx(filepath=…)`. Model impor tetap harus memenuhi
  budget tier dan konvensi di atas; hapus bagian yang tidak dipakai sebelum skrip selesai.

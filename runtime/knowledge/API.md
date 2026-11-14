# Referensi `assetkit` (v0.2)

`assetkit` adalah lapisan stabil di atas `bpy` (Blender 5.2). Ada dua jenis skrip, keduanya dijalankan di sandbox
**tanpa jaringan, tanpa GUI, Python 3.13**:
- `work/base.py` → tool `build_base_mesh`: bentuk dasar abu-abu (bagian **Alur skrip** sampai **Budget**);
- `work/material.py` → tool `build_textured_asset`: material untuk bentuk dasar yang sudah disetujui (bagian
  **Tahap tekstur** di bawah).

## Alur skrip
```python
from assetkit import mod, prim, protocol, scene

scene.reset()                                   # wajib, selalu baris pertama setelah import
badan = prim.box((0.6, 0.4, 0.35), name="badan", location=(0, 0, 0.175))
mod.bevel(badan, width=0.02, segments=2)
protocol.progress("badan", 50)                  # opsional: progres untuk UI
```
- **Jangan** memanggil `finalize()`, `export_glb()`, `save_blend()`, atau operator ekspor/simpan. Harness yang
  melakukannya setelah skrip selesai: semua modifier diterapkan, transform di-bake, vertex ganda digabung, origin
  dipindah ke dasar-tengah, lalu GLB dan `.blend` disimpan. Teks (`bpy.data.texts`) dan driver berekspresi Python
  dibuang sebelum `.blend` disimpan; jangan memakainya untuk membentuk aset.
- Tahap bentuk dasar **tanpa material dan tekstur**. Material yang dibuat skrip tidak ikut diekspor.
- Semua objek mesh yang terlihat ikut diekspor. Objek bantu yang tidak boleh ikut: hapus, atau pakai sebagai cutter
  `mod.boolean` (otomatis disembunyikan).
- Exception di skrip = build gagal. Traceback (ekor ±2000 karakter) dikembalikan di hasil tool sebagai `detail`.

## Koordinat
- Satuan **meter**. Saat membangun, Blender memakai **Z ke atas**; ekspor glTF otomatis memakai +Y ke atas.
- **Depan aset menghadap −Y** (sudut "Depan" di contact sheet). Kanan aset = +X.
- `location` primitif = pusat objek. Rotasi lewat `obj.rotation_euler = (rx, ry, rz)` (radian), skala lewat
  `obj.scale = (sx, sy, sz)`; keduanya di-bake oleh harness.

## `scene`
| Fungsi | Keterangan |
|---|---|
| `scene.reset() -> Scene` | Mengosongkan file (tanpa kamera, lampu, kubus bawaan), satuan meter |
| `scene.mesh_objects() -> list[Object]` | Semua objek mesh di scene, urut nama |
| `scene.threads() -> int` | Jumlah thread CPU dari runner (jarang dibutuhkan di tahap bentuk dasar) |
| `scene.run_base(path="/job/base.py") -> list[Object]` | **Hanya tahap tekstur.** Menjalankan skrip bentuk dasar yang disetujui; hasilnya objek mesh di scene |
| `scene.get(name) -> Object` | Objek mesh bernama `name`. Bila tidak ada, `KeyError` menyebut nama yang tersedia |

## `prim`: primitif mesh
Semua primitif menerima `name: str` dan `location: (x, y, z)`; hasilnya objek Blender baru. Ukuran harus > 0
(`ValueError` bila tidak).

| Fungsi | Keterangan |
|---|---|
| `prim.box(size=(1, 1, 1))` | Balok berukuran `size` (x, y, z) |
| `prim.cylinder(radius=0.5, depth=1.0, *, vertices=32)` | Silinder tegak (sumbu Z) dengan tutup |
| `prim.cone(radius_bottom=0.5, radius_top=0.0, depth=1.0, *, vertices=32)` | Kerucut; `radius_top > 0` → kerucut terpancung |
| `prim.sphere(radius=0.5, *, segments=32, rings=16)` | Bola UV |
| `prim.torus(major_radius=0.5, minor_radius=0.1, *, major_segments=32, minor_segments=12)` | Torus di bidang XY; `minor_radius < major_radius` |

Jumlah segmen menentukan jumlah segitiga: gunakan yang **cukup** untuk siluet (8–16 untuk detail kecil, 24–32 untuk
bentuk bulat yang dominan).

## `mod`: modifier non-destruktif
Diterapkan oleh harness saat finalisasi, jadi urutan pemanggilan = urutan modifier.

| Fungsi | Keterangan |
|---|---|
| `mod.bevel(obj, *, width=0.01, segments=2, angle_deg=30.0)` | Membulatkan tepi yang lebih tajam dari `angle_deg` |
| `mod.boolean(obj, cutter, *, operation="DIFFERENCE", hide_cutter=True)` | Boolean EXACT: `DIFFERENCE`, `UNION`, `INTERSECT`. Cutter tidak diekspor |
| `mod.mirror(obj, *, axis="X", merge=True)` | Cermin terhadap **origin objek** pada sumbu `X`, `Y`, atau `Z`. `merge=False` untuk bagian terpisah (kaki, telinga) |
| `mod.array(obj, *, count, offset=(x, y, z))` | `count` salinan dengan jarak tetap `offset` meter |

Untuk `mirror`, geser **geometrinya** (bukan objeknya) supaya origin tetap di sumbu cermin:
```python
from mathutils import Matrix
kaki = prim.box((0.04, 0.04, 0.43), name="kaki")
kaki.data.transform(Matrix.Translation((0.19, 0.19, 0.215)))
mod.mirror(kaki, axis="X", merge=False)
mod.mirror(kaki, axis="Y", merge=False)   # empat kaki
```

**Mirror membalik arah.** `mirror(axis="Y")` mencerminkan depan ↔ belakang, termasuk arah bentuknya. Aman untuk
bagian simetris (silinder kaki, paku bulat, roda). **Jangan** untuk bagian yang punya arah depan-belakang (telapak dan
cakar yang memanjang ke depan, wajah, moncong, laras): pasangan depan dan belakang dibuat terpisah, lalu masing-masing
`mirror(axis="X")` saja. Contoh lengkap: resep `simple-creature.md` (telapak). Periksa arah bagian seperti ini di
sudut Kiri/Kanan contact sheet.

## `protocol`
| Fungsi | Keterangan |
|---|---|
| `protocol.progress(step: str, pct: float)` | Progres untuk UI pemilik (0–100). Panggil di setiap bagian besar |
| `protocol.emit(event_type, **data)` | Tingkat rendah, dipakai harness. **Jangan** dipanggil dari skrip aset |

## `stats()`
`stats() -> dict` mengembalikan `objects`, `vertices`, `triangles`, `materials`, dan `bbox` (`min`, `max`, `size`, Z-up)
dari mesh hasil evaluasi. Berguna untuk `print()` saat debugging; angka resmi tetap dari hasil tool.

## Memakai `bpy` dan `bmesh` langsung
Boleh, untuk bentuk yang tidak tercakup primitif (profil, ekstrusi, lathe). Aturannya:
- `import bpy` **sebelum** `import bmesh` atau `mathutils` (di skrip aset, `from assetkit import …` sudah memuat `bpy`);
- hanya data API (`bpy.data`, `bmesh`, modifier lewat `obj.modifiers.new`); **jangan** operator yang butuh UI atau
  konteks viewport (`bpy.ops.mesh.*`, `bpy.ops.object.mode_set`, dan sejenisnya);
- objek baru harus di-link ke scene: `bpy.context.scene.collection.objects.link(obj)`;
- tanpa akses jaringan, file di luar `/job`, atau proses lain.

## Budget
Hasil tool membandingkan jumlah segitiga dengan budget tier aset (target / maks). Bentuk dasar sedikit di atas maks
(≤ 1,25 ×) disederhanakan otomatis; di atas itu, kurangi segmen primitif atau bevel.

# Tahap tekstur

Dimulai setelah pemilik menyetujui bentuk dasar. Skrip `work/material.py` **memakai ulang geometri yang disetujui**
lewat `scene.run_base()`, lalu memasang material. Harness kemudian:
1. menerapkan modifier dan menggeser aset ke dasar-tengah (sama seperti bentuk dasar);
2. memasang decal dan mem-bake detail high-poly yang dicatat skrip;
3. menggabungkan semua mesh, membuat UV atlas (xatlas), dan mem-bake **semua material ke satu material atlas**
   (warna dasar + normal + ORM) dengan ukuran tekstur sesuai tier;
4. ekspor, optimasi, validasi, dan **cek bentuk**: ukuran bbox dan jumlah segitiga harus tetap dekat dengan bentuk
   dasar yang disetujui (`SHAPE_DRIFT` bila menyimpang).

Jadi skrip boleh memakai material sebanyak apa pun; jumlah material di GLB tetap 1. Jangan mengubah bentuk di
`material.py`. Bentuk baru hanya lewat permintaan pemilik.

```python
from assetkit import material, scene

scene.run_base()                                         # wajib, baris pertama setelah import
kayu = material.from_library("Planks037A", scale_m=0.6)  # id dari tool list_materials
logam = material.pbr("logam", color="#8a8f96", roughness=0.4, metallic=1.0)
material.assign(scene.get("badan"), kayu)
material.assign(scene.get("sabuk"), logam)
```

Tier menentukan tekstur yang dihasilkan:

| Tier | Warna dasar | Normal | ORM (AO, kekasaran, logam) | Pustaka |
|---|---|---|---|---|
| Ringan | 512 | tidak ada (AO dan logam dikalikan ke warna) | tidak ada | 1K |
| Sedang | 1024 | 1024 | 512 | 1K |
| Maksimal | 2048 | 2048 | 1024 | 2K |

Normal map hanya ada bila permukaannya punya relief: tekstur pustaka (yang punya peta normal) atau detail
`bake.pbr`. Normal yang seluruhnya datar (misalnya hanya `material.pbr`) dibuang otomatis saat optimasi, karena sama
dengan tanpa normal map; itu normal dan menghemat ukuran file.

## `material`
Warna memakai sRGB: hex `"#rrggbb"` atau `(r, g, b)` 0..1.

| Fungsi | Keterangan |
|---|---|
| `material.pbr(name, *, color=(0.8, 0.8, 0.8), roughness=0.5, metallic=0.0, emission=None, emission_strength=1.0, variation=0.0, variation_scale_m=0.1)` | Material warna. `roughness`/`metallic` 0..1. `variation` 0..1: variasi terang-gelap halus dari noise (0,05–0,2 wajar), bercak berukuran `variation_scale_m` meter |
| `material.wear(mat, *, edge=0.0, edge_color="#d8d0c2", edge_width_m=0.004, dirt=0.0, dirt_color="#2b2118", dirt_distance_m=0.05)` | Keausan untuk `pbr` maupun `from_library`: `edge` 0..1 mencerahkan tepi tajam (cat terkelupas, logam aus), `dirt` 0..1 menggelapkan celah dan sudut dalam. Dihitung saat bake. Hasil: material yang sama |
| `material.from_library(material_id, *, scale_m=1.0, mapping="box", tint=None, roughness_scale=1.0, name=None)` | Material CC0 dari pustaka lokal. Satu ulangan tekstur = `scale_m` meter. `tint`: warna pengali (mis. kayu lebih gelap). `roughness_scale`: pengali kekasaran |
| `material.assign(obj, mat)` | Mengganti semua material objek dengan `mat` |
| `material.rgba(value)` | Warna sRGB → RGBA linear untuk socket Blender (bila memakai node sendiri) |
| `material.principled(mat)` | Node Principled BSDF milik material, atau `None` |

- `mapping="box"` (bawaan): tekstur diproyeksikan dari koordinat dunia per sisi, tanpa UV dari skrip. Cocok untuk
  kayu, logam, batu, dan kain di permukaan yang kurang lebih datar.
- `mapping="uv"`: memakai layer UV `UVMap` milik mesh (mis. dari `bmesh.ops.create_*(calc_uvs=True)`).
- `scale_m` sesuai dunia nyata: papan kayu 0,5–1 m, ubin batu 0,3–0,6 m, kain 0,2–0,4 m, logam 0,3–0,5 m.
- Id yang tidak ada di pustaka → error yang menyebut `list_materials`. Jangan menebak id.
- **Jangan biarkan warna rata** di tier Sedang/Maksimal. Pilihannya: tekstur pustaka, `variation` di `pbr`, dan
  `wear` (kotoran di celah hampir selalu membantu; keausan tepi untuk logam, cat, dan kayu yang sering dipegang).
  Gaya kartun tetap boleh polos, tetapi beri `variation` kecil (±0,1) dan `dirt` tipis.
- Ukuran file `web.glb` naik bila tekstur lebih ramai (noise, pustaka); periksa `webBytes` di hasil build.

## `decal`
| Fungsi | Keterangan |
|---|---|
| `decal.from_image(ref, obj, *, center, normal, width, up=(0, 0, 1))` | Memproyeksikan gambar lampiran `refs/<ref>` (logo, label) ke permukaan `obj`. `center`: titik tengah di permukaan (meter, koordinat skrip sebelum digeser harness). `normal`: arah keluar permukaan, mis. `(0, -1, 0)` untuk sisi depan. `width`: lebar decal (meter); tinggi mengikuti rasio gambar |
| `decal.paint(obj, *, shape="circle", center, normal, size, color, up=(0, 0, 1), aspect=1.0)` | Cat bentuk sederhana tanpa gambar: `shape` `"circle"` (diameter `size`) atau `"square"` (sisi `size`, `aspect` = tinggi/lebar, mis. 0,2 untuk garis). Untuk mata, bintik, garis, angka panel, kilau pupil. Cat yang dicatat belakangan menimpa yang lebih dulu |
| `decal.apply_pending(obj)` | Tugas harness. **Jangan** dipanggil dari skrip aset |

Bagian transparan gambar memperlihatkan material di bawahnya. Decal dan cat hanya mengenai sisi yang menghadap
`normal`, dan hanya permukaan yang dekat bidang decal (±¼ ukurannya). Jadi `center` harus tepat di permukaan; untuk
permukaan bulat (bola mata) pakai titik terdepannya.

## `bake`
| Fungsi | Keterangan |
|---|---|
| `bake.pbr(high, low, *, maps=("normal",), size=None, cage_extrusion=0.02)` | Detail normal dari objek `high` (mis. baut, ukiran, panel) ke objek `low`. `high` tidak diekspor dan tidak menambah segitiga. `cage_extrusion`: jarak sinar (meter); naikkan bila detail menonjol jauh |
| `bake.atlas(*, base_color, normal=None, orm=None, padding=8)` | Tugas harness. **Jangan** dipanggil dari skrip aset |

Detail high-poly hanya berguna di tier dengan tekstur normal (Sedang, Maksimal). Objek high harus berada di posisi
akhir yang sama dengan permukaan low.

## `uv`
Jarang dibutuhkan: harness membuat UV atlas sendiri.

| Fungsi | Keterangan |
|---|---|
| `uv.unwrap(obj, *, method="xatlas", padding=4, resolution=1024, name="atlas")` | UV tanpa tumpang tindih (`xatlas`) atau proyeksi kotak (`box`). Hasil: `{method, charts, utilization}` |
| `uv.box_project(obj, *, name="tiling")` | UV berulang dari koordinat dunia (meter), dipakai `from_library(mapping="box")` |

# Resep: Peti kayu

Balok + bevel, sabuk lewat `mod.array`, lubang kunci lewat `mod.boolean`, paku keling lewat dua `mod.array` + mirror Y, dan engsel di belakang.

Sumber: `runtime/samples/peti.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh: peti kayu (badan, tutup, dua sabuk logam berpaku keling, engsel, lubang kunci).

Detail kecil (paku keling, engsel) murah dalam segitiga tetapi membuat siluet dan tekstur jauh lebih hidup.
"""
from mathutils import Matrix

from assetkit import mod, prim, protocol, scene

scene.reset()
protocol.progress("badan peti", 10)
badan = prim.box((0.8, 0.5, 0.4), name="badan", location=(0, 0, 0.2))
mod.bevel(badan, width=0.015, segments=2)

protocol.progress("tutup", 30)
tutup = prim.box((0.82, 0.52, 0.12), name="tutup", location=(0, 0, 0.46))
mod.bevel(tutup, width=0.02, segments=2)

protocol.progress("sabuk logam", 50)
sabuk = prim.box((0.04, 0.54, 0.54), name="sabuk", location=(-0.25, 0, 0.27))
mod.array(sabuk, count=2, offset=(0.5, 0, 0))

protocol.progress("lubang kunci", 70)
kunci = prim.box((0.12, 0.02, 0.1), name="kunci", location=(0, -0.26, 0.38))
pelubang = prim.cylinder(0.015, 0.1, vertices=16, name="pelubang", location=(0, -0.26, 0.39))
pelubang.rotation_euler = (1.5707963, 0, 0)
mod.boolean(kunci, pelubang)

protocol.progress("paku keling", 85)
# Satu paku di depan sabuk kiri; array ke atas (4) dan ke sabuk kanan (2); mirror Y ke sisi belakang
# (paku bulat simetris, jadi aman dicerminkan di Y). Geometri digeser, origin tetap di (0, 0).
paku = prim.sphere(0.009, segments=8, rings=6, name="paku")
paku.data.transform(Matrix.Translation((-0.25, -0.272, 0.08)))
mod.array(paku, count=4, offset=(0, 0, 0.12))
mod.array(paku, count=2, offset=(0.5, 0, 0))
mod.mirror(paku, axis="Y", merge=False)

protocol.progress("engsel", 95)
# Dua engsel silinder mendatar di belakang, di garis pertemuan badan dan tutup.
engsel = prim.cylinder(0.014, 0.08, vertices=12, name="engsel")
engsel.data.transform(Matrix.Rotation(1.5707963, 4, "Y"))
engsel.data.transform(Matrix.Translation((0.15, 0.258, 0.4)))
mod.mirror(engsel, axis="X", merge=False)
```

**Catatan**
- Bevel badan dan tutup secukupnya (1,5–2 cm); tanpa bevel, render clay terlihat seperti kotak CAD.
- Sabuk sedikit lebih besar dari badan (0,54 vs 0,5) supaya tidak z-fighting.
- Cutter boolean otomatis disembunyikan dan tidak diekspor.
- Detail kecil (paku keling, engsel) hanya ±600 segitiga tetapi membuat peti jauh lebih meyakinkan. Paku bulat
  simetris, jadi aman dicerminkan di Y.

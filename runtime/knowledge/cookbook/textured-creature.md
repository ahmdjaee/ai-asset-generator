# Resep: Makhluk kartun bertekstur

Gaya kartun: warna PBR per bagian dengan `variation` halus, `dirt` tipis, dan kilau pupil lewat `decal.paint`. Bentuk dari resep `simple-creature.md`.

Sumber: `runtime/samples/textured/makhluk.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh tahap tekstur: rubah kartun (bentuk dasar `samples/makhluk.py`) dengan warna PBR per bagian.

Gaya kartun tetap diberi variasi halus (`variation`) dan kotoran tipis di celah (`material.wear`) supaya tidak rata.
"""
from assetkit import decal, material, scene

scene.run_base()
bulu = material.pbr("bulu_oranye", color="#d9772b", roughness=0.85, variation=0.15, variation_scale_m=0.08)
material.wear(bulu, dirt=0.25)
krem = material.pbr("bulu_krem", color="#f1e3c8", roughness=0.85, variation=0.08)
gelap = material.pbr("bulu_gelap", color="#3b2a22", roughness=0.8, variation=0.1)
putih_mata = material.pbr("putih_mata", color="#f4f1ea", roughness=0.3)
hitam = material.pbr("hitam_mengilap", color="#141210", roughness=0.25)

for nama in ("badan", "kepala", "ekor"):
    material.assign(scene.get(nama), bulu)
for nama in ("moncong", "dada", "ujung_ekor", "telinga_dalam"):
    material.assign(scene.get(nama), krem)
for nama in ("telinga", "kaki", "telapak_depan", "telapak_belakang"):
    material.assign(scene.get(nama), gelap)
material.assign(scene.get("mata"), putih_mata)
for nama in ("pupil", "hidung"):
    material.assign(scene.get(nama), hitam)
# Kilau kecil di pupil: lingkaran putih dicat (tanpa gambar referensi), ikut ter-bake ke atlas.
for x in (0.063, -0.063):
    decal.paint(scene.get("pupil"), shape="circle", center=(x + 0.006, -0.457, 0.51), normal=(0, -1, 0),
                size=0.008, color="#ffffff")
```

**Catatan**
- Gaya kartun tidak berarti warna rata: `variation` 0,1–0,15 dan `dirt` 0,2–0,3 sudah cukup.
- `decal.paint` di pupil: `center` di titik terdepan pupil, `normal` ke depan (0, −1, 0).

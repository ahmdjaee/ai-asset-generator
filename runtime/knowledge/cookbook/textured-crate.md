# Resep: Peti kayu bertekstur

Material pustaka (kayu dan logam) dengan `tint` dan `material.wear`, ditambah PBR untuk kunci kuningan. Bentuk dari resep `crate.md`.

Sumber: `runtime/samples/textured/peti.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh tahap tekstur: peti kayu (bentuk dasar `samples/peti.py`) dengan material pustaka, PBR, dan keausan.

Geometri diambil dari bentuk dasar yang disetujui lewat `scene.run_base()`; skrip ini hanya memasang material.
"""
from assetkit import material, scene

scene.run_base()
# Kotoran di celah kayu dan keausan di tepi logam membuat peti terlihat dipakai, bukan baru dari pabrik.
kayu = material.wear(material.from_library("Planks037A", scale_m=0.6, tint="#c8a27a"), dirt=0.4)
logam = material.wear(material.from_library("Metal049A", scale_m=0.4), edge=0.6, edge_color="#c9c4ba")
kuningan = material.pbr("kuningan", color="#b8892f", roughness=0.35, metallic=1.0, variation=0.1)

for nama in ("badan", "tutup"):
    material.assign(scene.get(nama), kayu)
for nama in ("sabuk", "paku", "engsel"):
    material.assign(scene.get(nama), logam)
material.assign(scene.get("kunci"), kuningan)
```

**Catatan**
- `dirt` di kayu menggelapkan celah antara badan, tutup, dan sabuk; `edge` di logam mencerahkan tepi sabuk dan paku.
- Satu material bisa dipakai banyak objek (sabuk, paku, engsel).

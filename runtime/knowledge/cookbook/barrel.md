# Resep: Tong (laras)

Badan menggembung dari dua `prim.cone` terpancung yang bertemu di tengah; cincin dari `prim.torus`.

Sumber: `runtime/samples/laras.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh: tong kayu (laras) dengan tiga cincin logam."""
from assetkit import prim, protocol, scene

scene.reset()
protocol.progress("badan tong", 10)
prim.cone(0.28, 0.28, 0.08, vertices=32, name="dasar", location=(0, 0, 0.04))
prim.cone(0.28, 0.32, 0.37, vertices=32, name="badan_bawah", location=(0, 0, 0.265))
prim.cone(0.32, 0.28, 0.37, vertices=32, name="badan_atas", location=(0, 0, 0.635))
prim.cone(0.28, 0.28, 0.08, vertices=32, name="tutup", location=(0, 0, 0.86))

protocol.progress("cincin", 60)
for index, (z, radius) in enumerate([(0.12, 0.29), (0.45, 0.322), (0.78, 0.29)]):
    prim.torus(radius, 0.012, major_segments=32, minor_segments=6, name=f"cincin_{index}", location=(0, 0, z))
```

**Catatan**
- Gembung tong = radius tengah lebih besar dari radius ujung.
- Cincin: `minor_segments` kecil (6) sudah cukup untuk siluet.

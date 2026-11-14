# Resep: Kursi

Empat kaki dari satu objek dengan dua `mod.mirror`; bilah sandaran lewat `mod.array`.

Sumber: `runtime/samples/kursi.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh: kursi kayu (dudukan, empat kaki lewat mirror X+Y, sandaran dengan bilah)."""
from mathutils import Matrix

from assetkit import mod, prim, protocol, scene

scene.reset()
protocol.progress("dudukan", 10)
dudukan = prim.box((0.45, 0.45, 0.04), name="dudukan", location=(0, 0, 0.45))
mod.bevel(dudukan, width=0.01, segments=2)

protocol.progress("kaki", 35)
kaki = prim.box((0.04, 0.04, 0.43), name="kaki")
# Geometri digeser ke pojok, origin tetap di (0, 0) supaya mirror X dan Y menghasilkan empat kaki.
kaki.data.transform(Matrix.Translation((0.19, 0.19, 0.215)))
mod.mirror(kaki, axis="X", merge=False)
mod.mirror(kaki, axis="Y", merge=False)

protocol.progress("sandaran", 60)
tiang = prim.box((0.04, 0.04, 0.45), name="tiang", location=(0, 0.19, 0.69))
tiang.data.transform(Matrix.Translation((0.19, 0, 0)))
mod.mirror(tiang, axis="X", merge=False)
bilah = prim.box((0.34, 0.02, 0.05), name="bilah", location=(0, 0.19, 0.55))
mod.array(bilah, count=3, offset=(0, 0, 0.12))
mod.bevel(bilah, width=0.005, segments=1)
```

**Catatan**
- Geometri kaki digeser ke pojok dengan `data.transform`, origin tetap di (0, 0): itu syarat mirror.
- Tinggi dudukan ±0,45 m, sandaran sampai ±0,9 m.
- `merge=False` karena kaki adalah bagian terpisah.

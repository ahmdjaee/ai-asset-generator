# Resep: Pohon stylized

Batang `prim.cone` meruncing, cabang miring, gumpal daun dari bola low-poly yang dipipihkan lewat `obj.scale`.

Sumber: `runtime/samples/pohon.py` (diuji di sandbox; isi blok kode di bawah harus sama persis).

```python
"""Contoh: pohon stylized (batang meruncing, tiga gumpal daun bulat, dua akar)."""
from assetkit import prim, protocol, scene

scene.reset()
protocol.progress("batang", 10)
prim.cone(0.12, 0.07, 1.2, vertices=12, name="batang", location=(0, 0, 0.6))

protocol.progress("cabang", 30)
cabang = prim.cylinder(0.035, 0.45, vertices=8, name="cabang", location=(0.16, 0, 1.05))
cabang.rotation_euler = (0, 0.9, 0)

protocol.progress("daun", 50)
# Gumpal daun: bola low-poly yang dipipihkan sedikit; jumlah segmen kecil memberi kesan stylized.
for index, (x, y, z, r) in enumerate([(0.0, 0.0, 1.55, 0.5), (0.32, 0.1, 1.3, 0.34), (-0.28, -0.12, 1.32, 0.3)]):
    daun = prim.sphere(r, segments=12, rings=8, name=f"daun_{index}", location=(x, y, z))
    daun.scale = (1.0, 1.0, 0.85)

protocol.progress("akar", 80)
for index, angle in enumerate((0.0, 2.4)):
    akar = prim.cone(0.06, 0.02, 0.3, vertices=6, name=f"akar_{index}", location=(0, 0, 0.06))
    akar.rotation_euler = (1.25, 0, angle)
```

**Catatan**
- Segmen rendah (bola 12 × 8) memberi kesan stylized sekaligus hemat segitiga.
- Gumpal daun tumpang tindih; jangan dirapikan dengan boolean (mahal, tidak perlu di bentuk dasar).
- Rotasi dalam radian lewat `rotation_euler`.

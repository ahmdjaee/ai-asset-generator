"""Contoh: makhluk berkaki empat bergaya kartun (rubah) dengan detail wajah dan telapak.

Bagian: badan, dada, kepala, moncong, hidung, mata + pupil, telinga + telinga dalam, kaki, telapak, ekor + ujung ekor.
Depan makhluk menghadap −Y (sudut "Depan" di contact sheet).

Pola penting:
- Bagian kiri-kanan dibuat sekali di sisi +X lalu `mod.mirror(axis="X")`.
- Bagian yang punya ARAH depan-belakang (telapak, cakar, wajah) TIDAK dicerminkan di sumbu Y: mirror Y membalik
  arahnya. Pasangan depan dan belakang dibuat terpisah.
"""
from mathutils import Matrix

from assetkit import mod, prim, protocol, scene

scene.reset()

protocol.progress("badan", 10)
badan = prim.sphere(0.2, segments=24, rings=14, name="badan", location=(0, 0, 0.3))
badan.scale = (0.8, 1.35, 0.8)
dada = prim.sphere(0.12, segments=16, rings=10, name="dada", location=(0, -0.2, 0.3))
dada.scale = (0.9, 0.6, 1.1)

protocol.progress("kepala", 25)
prim.sphere(0.14, segments=24, rings=14, name="kepala", location=(0, -0.3, 0.46))
moncong = prim.cone(0.07, 0.015, 0.16, vertices=16, name="moncong", location=(0, -0.44, 0.43))
moncong.rotation_euler = (1.5707963, 0, 0)  # ujung lancip ke depan (−Y)
prim.sphere(0.022, segments=12, rings=8, name="hidung", location=(0, -0.52, 0.43))

protocol.progress("mata", 40)
# Mata di sisi +X, menempel di permukaan depan kepala; pupil sedikit lebih ke depan dari bola mata.
mata = prim.sphere(0.03, segments=16, rings=10, name="mata")
mata.data.transform(Matrix.Translation((0.06, -0.415, 0.5)))
mod.mirror(mata, axis="X", merge=False)
pupil = prim.sphere(0.016, segments=12, rings=8, name="pupil")
pupil.data.transform(Matrix.Translation((0.063, -0.441, 0.502)))
mod.mirror(pupil, axis="X", merge=False)

protocol.progress("telinga", 55)
telinga = prim.cone(0.05, 0.0, 0.12, vertices=4, name="telinga", location=(0, -0.3, 0.6))
telinga.data.transform(Matrix.Translation((0.07, 0, 0)))
mod.mirror(telinga, axis="X", merge=False)
# Telinga dalam: kerucut lebih kecil, sedikit di depan telinga luar.
telinga_dalam = prim.cone(0.03, 0.0, 0.08, vertices=4, name="telinga_dalam", location=(0, -0.322, 0.59))
telinga_dalam.data.transform(Matrix.Translation((0.07, 0, 0)))
mod.mirror(telinga_dalam, axis="X", merge=False)

protocol.progress("kaki", 70)
kaki = prim.cylinder(0.035, 0.2, vertices=12, name="kaki", location=(0, 0, 0.1))
kaki.data.transform(Matrix.Translation((0.09, 0.15, 0)))
mod.mirror(kaki, axis="X", merge=False)
mod.mirror(kaki, axis="Y", merge=False)  # silinder simetris: aman dicerminkan di Y


def telapak(nama: str, y: float):
    """Telapak pipih yang memanjang ke DEPAN (−Y) dari kaki di posisi y; kiri-kanan lewat mirror X."""
    obj = prim.sphere(0.04, segments=12, rings=8, name=nama)
    obj.data.transform(Matrix.Diagonal((1.0, 1.4, 0.45, 1.0)))
    obj.data.transform(Matrix.Translation((0.09, y - 0.02, 0.018)))
    mod.mirror(obj, axis="X", merge=False)
    return obj


telapak("telapak_depan", -0.15)
telapak("telapak_belakang", 0.15)

protocol.progress("ekor", 85)
ekor = prim.cone(0.08, 0.03, 0.26, vertices=16, name="ekor", location=(0, 0.35, 0.33))
ekor.rotation_euler = (-1.0, 0, 0)
ujung_ekor = prim.cone(0.03, 0.005, 0.12, vertices=16, name="ujung_ekor", location=(0, 0.505, 0.43))
ujung_ekor.rotation_euler = (-1.0, 0, 0)

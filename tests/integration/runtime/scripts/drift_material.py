"""Skrip tahap tekstur yang (salah) menambah objek: bentuk menyimpang dari bentuk dasar → SHAPE_DRIFT."""
from assetkit import material, prim, scene

scene.run_base()
prim.box((0.3, 0.3, 1.5), name="tiang", location=(0, 0, 1.2))
for obj in scene.mesh_objects():
    material.assign(obj, material.pbr("abu", color="#888888"))

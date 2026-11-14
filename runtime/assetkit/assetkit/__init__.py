"""assetkit — lapisan stabil di atas bpy untuk skrip aset yang ditulis Claude.

Konvensi:
- satuan meter; Blender Z-up saat membangun, ekspor glTF memakai +Y up;
- origin aset di dasar-tengah (bawah bounding box, tengah X/Y) setelah `finalize()`;
- hanya data API (`bpy.data`, bmesh, modifier lewat depsgraph); tanpa operator yang butuh UI.

Pemakaian di skrip:

    from assetkit import scene, prim, mod
    scene.reset()
    badan = prim.box((0.6, 0.4, 0.35), name="badan")
    mod.bevel(badan, width=0.02, segments=2)
"""
from assetkit import bake, decal, material, mod, prim, protocol, scene, uv
from assetkit.finalize import finalize
from assetkit.io import export_glb, save_blend
from assetkit.stats import stats

__all__ = [
    "bake",
    "decal",
    "export_glb",
    "finalize",
    "material",
    "mod",
    "prim",
    "protocol",
    "save_blend",
    "scene",
    "stats",
    "uv",
]
__version__ = "0.3.0"

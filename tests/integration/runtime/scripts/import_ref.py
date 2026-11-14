"""Lampiran pemilik: model di /refs bisa diimpor skrip Blender, tetapi /refs tidak bisa ditulisi."""
import bpy
from assetkit import scene

scene.reset()
with open("/refs/ref.glb", "rb") as handle:
    assert handle.read(4) == b"glTF", "lampiran bukan GLB"
try:
    with open("/refs/tulis.txt", "w") as handle:
        handle.write("x")
except OSError:
    pass
else:
    raise AssertionError("/refs seharusnya read-only")
bpy.ops.import_scene.gltf(filepath="/refs/ref.glb")
assert scene.mesh_objects(), "model lampiran tidak terimpor"

"""Probe: ekspor GLB dengan operator glTF bawaan dalam mode modul (tanpa UI)."""
import json
import os
import sys
import time

import bpy  # noqa: I001 — bpy wajib di-import lebih dulu; modul bmesh baru tersedia setelahnya
import bmesh

out = sys.argv[1] if len(sys.argv) > 1 else "/job/probe.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("kubus")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("kubus", mesh)
bpy.context.scene.collection.objects.link(obj)

start = time.perf_counter()
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_materials="NONE")
elapsed = time.perf_counter() - start
with open(out, "rb") as handle:
    magic = handle.read(4)
print(json.dumps({"probe": "export", "ok": magic == b"glTF", "bytes": os.path.getsize(out), "seconds": round(elapsed, 3)}))

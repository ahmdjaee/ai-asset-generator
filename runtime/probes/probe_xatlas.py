"""Probe: xatlas membuat atlas UV dari mesh bpy, lalu UV ditulis kembali ke mesh."""
import json
import time

import bpy  # noqa: I001 — bpy wajib di-import lebih dulu; modul bmesh baru tersedia setelahnya
import bmesh
import numpy as np
import xatlas

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("torus")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.5, radius2=0.2, depth=1.0)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(mesh)
bm.free()

vertices = np.array([v.co[:] for v in mesh.vertices], dtype=np.float32)
faces = np.array([p.vertices[:] for p in mesh.polygons], dtype=np.uint32)
start = time.perf_counter()
vmapping, indices, uvs = xatlas.parametrize(vertices, faces)
elapsed = time.perf_counter() - start
uv_layer = mesh.uv_layers.new(name="atlas")
for poly, tri in zip(mesh.polygons, indices):
    for loop_index, atlas_vertex in zip(poly.loop_indices, tri):
        uv_layer.data[loop_index].uv = uvs[atlas_vertex]
inside = bool(((uvs >= 0.0) & (uvs <= 1.0)).all())
print(json.dumps({"probe": "xatlas", "ok": inside, "faces": int(len(faces)), "atlas_vertices": int(len(vmapping)), "seconds": round(elapsed, 3)}))

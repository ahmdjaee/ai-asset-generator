"""Probe: bake Cycles CPU (normal + AO) dalam mode modul. Ukuran lewat argumen (bawaan 256 px)."""
import json
import os
import sys
import time

import bpy  # noqa: I001 — bpy wajib di-import lebih dulu; modul bmesh baru tersedia setelahnya
import bmesh

size = int(sys.argv[1]) if len(sys.argv) > 1 else 256
out_dir = sys.argv[2] if len(sys.argv) > 2 else "/job"
threads = int(os.environ.get("AAG_THREADS", "1"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.render.threads_mode = "FIXED"
scene.render.threads = threads

# Objek: bola dengan bevel kotak di bawahnya supaya AO punya oklusi.
mesh = bpy.data.meshes.new("bola")
bm = bmesh.new()
bm.loops.layers.uv.new("UVMap")  # calc_uvs butuh layer UV yang sudah ada
bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=0.5, calc_uvs=True)
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("bola", mesh)
scene.collection.objects.link(obj)
base_mesh = bpy.data.meshes.new("alas")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=2.0, calc_uvs=True)
bmesh.ops.translate(bm, verts=bm.verts, vec=(0.0, 0.0, -1.5))
bm.to_mesh(base_mesh)
bm.free()
scene.collection.objects.link(bpy.data.objects.new("alas", base_mesh))

material = bpy.data.materials.new("bake")
obj.data.materials.append(material)
nodes = material.node_tree.nodes
results = {}
for kind in ("NORMAL", "AO"):
    image = bpy.data.images.new(f"{kind.lower()}_{size}", width=size, height=size)
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    nodes.active = node
    start = time.perf_counter()
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.bake(type=kind, margin=4)
    elapsed = time.perf_counter() - start
    path = os.path.join(out_dir, f"bake_{kind.lower()}_{size}.png")
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    results[kind.lower()] = {"seconds": round(elapsed, 2), "bytes": os.path.getsize(path)}
print(json.dumps({"probe": "bake", "size": size, "threads": threads, **results}))

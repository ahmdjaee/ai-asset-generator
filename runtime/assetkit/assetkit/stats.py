"""Statistik scene dari mesh hasil evaluasi (modifier ikut dihitung), dalam koordinat dunia Blender (Z-up)."""
import bpy

from assetkit.scene import mesh_objects


def stats() -> dict:
    """Jumlah objek, vertex, segitiga, material, dan bounding box (meter) semua mesh yang akan diekspor."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices = 0
    triangles = 0
    materials: set[str] = set()
    low = [float("inf")] * 3
    high = [float("-inf")] * 3
    objects = [
        o for o in mesh_objects() if not o.get("assetkit_cutter", False) and not o.get("assetkit_bake_source", False)
    ]
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            vertices += len(mesh.vertices)
            triangles += len(mesh.loop_triangles)
            for vertex in mesh.vertices:
                world = evaluated.matrix_world @ vertex.co
                for axis in range(3):
                    low[axis] = min(low[axis], world[axis])
                    high[axis] = max(high[axis], world[axis])
        finally:
            evaluated.to_mesh_clear()
        materials.update(slot.material.name for slot in obj.material_slots if slot.material is not None)
    empty = vertices == 0
    size = [0.0, 0.0, 0.0] if empty else [round(high[i] - low[i], 6) for i in range(3)]
    return {
        "objects": len(objects),
        "vertices": vertices,
        "triangles": triangles,
        "materials": len(materials),
        "bbox": {
            "min": [0.0, 0.0, 0.0] if empty else [round(v, 6) for v in low],
            "max": [0.0, 0.0, 0.0] if empty else [round(v, 6) for v in high],
            "size": size,
        },
    }

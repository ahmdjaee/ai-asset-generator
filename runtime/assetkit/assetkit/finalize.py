"""Finalisasi mesh sebelum ekspor: modifier diterapkan, transform di-bake, vertex ganda digabung, origin di dasar-tengah."""
import bpy  # noqa: I001 — bmesh baru tersedia setelah bpy di-import
import bmesh
from mathutils import Matrix, Vector

from assetkit.scene import mesh_objects
from assetkit.stats import stats

CUTTER_KEY = "assetkit_cutter"
#: Objek high-poly sumber detail (`bake.pbr`): ikut digeser, tetapi tidak dihitung di bbox/statistik.
SOURCE_KEY = "assetkit_bake_source"
#: Total pergeseran finalize (dipakai decal yang dicatat dalam koordinat dunia sebelum finalize).
OFFSET_KEY = "assetkit_offset"


def _is_cutter(obj: bpy.types.Object) -> bool:
    return bool(obj.get(CUTTER_KEY, False))


def _is_source(obj: bpy.types.Object) -> bool:
    return bool(obj.get(SOURCE_KEY, False))


def _apply_modifiers(obj: bpy.types.Object, depsgraph: bpy.types.Depsgraph) -> None:
    """Mengganti mesh objek dengan hasil evaluasi depsgraph (setara 'apply all modifiers', tanpa operator)."""
    if len(obj.modifiers) == 0:
        return
    evaluated = obj.evaluated_get(depsgraph)
    new_mesh = bpy.data.meshes.new_from_object(evaluated)
    old_mesh = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    new_mesh.name = old_mesh.name
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)


def _apply_transform(obj: bpy.types.Object) -> None:
    """Membakar posisi/rotasi/skala dunia ke vertex, lalu matrix objek menjadi identitas."""
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)


def _clean(mesh: bpy.types.Mesh, merge_distance: float) -> None:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_distance)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def _bbox(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [v.co for obj in objects for v in obj.data.vertices]
    if not points:
        raise ValueError("Tidak ada vertex untuk difinalisasi")
    low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return low, high


def finalize(*, merge_distance: float = 1e-4) -> dict:
    """Menyiapkan semua mesh di scene untuk ekspor. Aman dipanggil lebih dari sekali. Hasil: `stats()`."""
    # Single-user dulu supaya mesh yang dipakai bersama tidak ditransformasi dua kali.
    for obj in mesh_objects():
        if obj.data.users > 1:
            obj.data = obj.data.copy()

    depsgraph = bpy.context.evaluated_depsgraph_get()
    kept = [obj for obj in mesh_objects() if not _is_cutter(obj)]
    for obj in kept:
        _apply_modifiers(obj, depsgraph)
    for obj in [o for o in mesh_objects() if _is_cutter(o)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in kept:
        _apply_transform(obj)
        _clean(obj.data, merge_distance)

    targets = [obj for obj in kept if not _is_source(obj)]
    low, high = _bbox(targets)
    offset = Vector((-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z))
    for obj in kept:
        obj.data.transform(Matrix.Translation(offset))
        obj.data.update()
    scene = bpy.context.scene
    previous = Vector(scene.get(OFFSET_KEY, (0.0, 0.0, 0.0)))
    scene[OFFSET_KEY] = tuple(previous + offset)
    return stats()

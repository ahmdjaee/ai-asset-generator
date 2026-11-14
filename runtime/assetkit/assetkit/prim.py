"""Primitif mesh dibangun dengan bmesh (data API). Ukuran dalam meter; posisi = pusat objek."""
from collections.abc import Sequence

import bpy  # noqa: I001 — bmesh baru tersedia setelah bpy di-import
import bmesh
from mathutils import Matrix

Vec3 = Sequence[float]


def _object_from_bmesh(bm: bmesh.types.BMesh, name: str, location: Vec3) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(location)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _check_positive(**values: float) -> None:
    for key, value in values.items():
        if not value > 0:
            raise ValueError(f"{key} harus > 0, bukan {value}")


def box(size: Vec3 = (1.0, 1.0, 1.0), *, name: str = "box", location: Vec3 = (0.0, 0.0, 0.0)) -> bpy.types.Object:
    """Balok berukuran `size` (x, y, z)."""
    sx, sy, sz = size
    _check_positive(sx=sx, sy=sy, sz=sz)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    return _object_from_bmesh(bm, name, location)


def cylinder(
    radius: float = 0.5,
    depth: float = 1.0,
    *,
    vertices: int = 32,
    name: str = "cylinder",
    location: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """Silinder tegak (sumbu Z) dengan tutup."""
    return cone(radius, radius, depth, vertices=vertices, name=name, location=location)


def cone(
    radius_bottom: float = 0.5,
    radius_top: float = 0.0,
    depth: float = 1.0,
    *,
    vertices: int = 32,
    name: str = "cone",
    location: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """Kerucut atau kerucut terpancung tegak. `radius_top = 0` → kerucut runcing."""
    _check_positive(radius_bottom=radius_bottom, depth=depth)
    if radius_top < 0:
        raise ValueError("radius_top tidak boleh negatif")
    if vertices < 3:
        raise ValueError("vertices minimal 3")
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=vertices, radius1=radius_bottom, radius2=radius_top, depth=depth
    )
    return _object_from_bmesh(bm, name, location)


def sphere(
    radius: float = 0.5,
    *,
    segments: int = 32,
    rings: int = 16,
    name: str = "sphere",
    location: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """Bola UV."""
    _check_positive(radius=radius)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    return _object_from_bmesh(bm, name, location)


def torus(
    major_radius: float = 0.5,
    minor_radius: float = 0.1,
    *,
    major_segments: int = 32,
    minor_segments: int = 12,
    name: str = "torus",
    location: Vec3 = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """Torus di bidang XY. Dibangun manual karena bmesh tidak punya operator torus."""
    _check_positive(major_radius=major_radius, minor_radius=minor_radius)
    if minor_radius >= major_radius:
        raise ValueError("minor_radius harus lebih kecil dari major_radius")
    bm = bmesh.new()
    ring = bmesh.ops.create_circle(bm, segments=minor_segments, radius=minor_radius)["verts"]
    # Lingkaran kecil di bidang XZ, digeser sejauh radius besar, lalu diputar mengelilingi Z.
    bmesh.ops.rotate(bm, verts=ring, cent=(0, 0, 0), matrix=Matrix.Rotation(1.5707963267948966, 3, "X"))
    bmesh.ops.translate(bm, verts=ring, vec=(major_radius, 0.0, 0.0))
    edges = list({e for v in ring for e in v.link_edges})
    bmesh.ops.spin(
        bm, geom=ring + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=6.283185307179586,
        steps=major_segments, use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    return _object_from_bmesh(bm, name, location)

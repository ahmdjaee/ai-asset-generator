"""Layer UV.

- `unwrap(obj, method="xatlas")`: atlas UV tanpa tumpang tindih (target bake). Mesh ditriangulasi dulu; jumlah
  segitiga tidak berubah.
- `unwrap(obj, method="box")` / `box_project`: UV berulang dari koordinat dunia (meter), untuk tekstur pustaka.
"""
import bpy  # noqa: I001 — bmesh baru tersedia setelah bpy di-import
import bmesh
import numpy as np
import xatlas

ATLAS_UV = "atlas"
METHODS = ("xatlas", "box")


def _layer(mesh: bpy.types.Mesh, name: str) -> bpy.types.MeshUVLoopLayer:
    layer = mesh.uv_layers.get(name) or mesh.uv_layers.new(name=name)
    if layer is None:
        raise RuntimeError(f"gagal membuat layer UV {name} (maksimal 8 layer)")
    return layer


def box_project(obj: bpy.types.Object, *, name: str = "tiling") -> bpy.types.MeshUVLoopLayer:
    """UV = koordinat dunia (meter) pada bidang sumbu dominan normal tiap face; tekstur tidak tercermin."""
    mesh = obj.data
    layer = _layer(mesh, name)
    world = obj.matrix_world
    rotation = world.to_3x3()
    uvs = np.zeros((len(mesh.loops), 2), dtype=np.float32)
    for polygon in mesh.polygons:
        normal = (rotation @ polygon.normal).normalized()
        axis = max(range(3), key=lambda i: abs(normal[i]))
        sign = 1.0 if normal[axis] >= 0 else -1.0
        for loop_index in polygon.loop_indices:
            p = world @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if axis == 2:  # atas/bawah
                uvs[loop_index] = (p.x * sign, p.y)
            elif axis == 1:  # depan (−Y) / belakang (+Y)
                uvs[loop_index] = (-p.x * sign, p.z)
            else:  # kiri/kanan
                uvs[loop_index] = (p.y * sign, p.z)
    layer.data.foreach_set("uv", uvs.ravel())
    return layer


def _triangulate(mesh: bpy.types.Mesh) -> None:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=[face for face in bm.faces if len(face.verts) > 3])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def unwrap(
    obj: bpy.types.Object,
    *,
    method: str = "xatlas",
    padding: int = 4,
    resolution: int = 1024,
    name: str = ATLAS_UV,
) -> dict:
    """Membuat layer UV `name` dan menjadikannya aktif. Hasil: ringkasan atlas (jumlah chart, utilisasi)."""
    if obj.type != "MESH":
        raise ValueError("unwrap hanya untuk objek mesh")
    if method not in METHODS:
        raise ValueError(f"method harus salah satu dari {METHODS}")
    mesh = obj.data
    if method == "box":
        layer = box_project(obj, name=name)
        mesh.uv_layers.active = layer
        return {"method": "box", "charts": None, "utilization": None}

    _triangulate(mesh)
    count = len(mesh.vertices)
    positions = np.empty(count * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", positions)
    faces = np.empty(len(mesh.polygons) * 3, dtype=np.uint32)
    mesh.polygons.foreach_get("vertices", faces)
    if len(faces) == 0:
        raise ValueError("mesh tanpa face tidak bisa di-unwrap")

    atlas = xatlas.Atlas()
    atlas.add_mesh(positions.reshape(-1, 3), faces.reshape(-1, 3))
    chart_options = xatlas.ChartOptions()
    pack_options = xatlas.PackOptions()
    pack_options.padding = max(1, int(padding))
    pack_options.resolution = max(64, int(resolution))
    pack_options.bilinear = True
    pack_options.rotate_charts = True
    atlas.generate(chart_options, pack_options)
    if atlas.atlas_count != 1:
        # Chart tidak muat di satu atlas pada resolusi ini: ulangi dengan ukuran otomatis.
        pack_options.resolution = 0
        atlas = xatlas.Atlas()
        atlas.add_mesh(positions.reshape(-1, 3), faces.reshape(-1, 3))
        atlas.generate(chart_options, pack_options)
    _vmapping, indices, uvs = atlas[0]
    layer = _layer(mesh, name)
    # Loop polygon berurutan dan setiap polygon segitiga, jadi loop ke-k = vertex atlas indices.ravel()[k].
    layer.data.foreach_set("uv", uvs[indices.ravel()].astype(np.float32).ravel())
    mesh.uv_layers.active = layer
    return {"method": "xatlas", "charts": int(atlas.chart_count), "utilization": round(float(atlas.utilization), 3)}

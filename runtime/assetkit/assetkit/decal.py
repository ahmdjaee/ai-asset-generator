"""Decal: gambar referensi pemilik (logo, label) atau bentuk cat sederhana yang diproyeksikan ke permukaan objek.

- `from_image(ref, ...)`: gambar dari `refs/`.
- `paint(obj, shape=..., ...)`: lingkaran atau persegi berwarna polos (mata, bintik, garis, nomor panel) tanpa gambar.

Keduanya hanya mencatat decal; harness memasangnya ke shader saat `bake.atlas()` (setelah `finalize()`
menggeser aset ke dasar-tengah), lalu decal ikut ter-bake ke atlas warna. Bagian transparan gambar memperlihatkan
material di bawahnya.
"""
import json
import os
import re

import bpy
from mathutils import Vector

REFS_DIR = "/refs"
DECAL_KEY = "assetkit_decals"
OFFSET_KEY = "assetkit_offset"
REF_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")
#: Face yang sudut normalnya lebih dari ini terhadap arah decal tidak terkena decal.
FACING_MIN = 0.35
SHAPES = ("circle", "square")


def _ref_path(ref: str) -> str:
    """Nama file lampiran di `refs/` → path di container. Tanpa folder dan tanpa `..`."""
    if not REF_NAME.fullmatch(ref or "") or ".." in ref:
        raise ValueError(f"nama lampiran tidak valid: {ref!r} (pakai nama file di refs/, mis. 'logo.png')")
    path = os.path.join(REFS_DIR, ref)
    if not os.path.isfile(path):
        raise ValueError(f"lampiran {ref} tidak ada di refs/")
    return path


def _frame(normal, up, width: float) -> tuple[Vector, Vector]:
    n = Vector(normal)
    if n.length < 1e-6:
        raise ValueError("normal tidak boleh nol")
    n.normalize()
    v = Vector(up) - n * Vector(up).dot(n)
    if v.length < 1e-6:
        raise ValueError("up tidak boleh sejajar normal")
    if width <= 0:
        raise ValueError("ukuran decal harus > 0")
    return n, v.normalized()


def _record(obj: bpy.types.Object, entry: dict) -> None:
    if obj.type != "MESH":
        raise ValueError("decal hanya untuk objek mesh")
    entries = json.loads(obj.get(DECAL_KEY, "[]"))
    entries.append(entry)
    obj[DECAL_KEY] = json.dumps(entries)


def from_image(
    ref: str,
    obj: bpy.types.Object,
    *,
    center,
    normal,
    width: float,
    up=(0.0, 0.0, 1.0),
    path: str | None = None,
) -> None:
    """Mencatat decal gambar di `obj`.

    `ref`: nama file di `refs/`. `center`: titik tengah decal di permukaan (meter, koordinat dunia).
    `normal`: arah keluar permukaan (mis. (0, -1, 0) untuk sisi depan). `width`: lebar decal (meter);
    tinggi mengikuti rasio gambar. `up`: arah atas gambar. `path` hanya untuk tes.
    """
    if obj.type != "MESH":
        raise ValueError("decal hanya untuk objek mesh")
    source = path if path is not None else _ref_path(ref)
    n, v = _frame(normal, up, width)
    _record(obj, {"path": source, "center": list(center), "normal": list(n), "up": list(v), "width": float(width)})


def paint(
    obj: bpy.types.Object,
    *,
    shape: str = "circle",
    center,
    normal,
    size: float,
    color,
    up=(0.0, 0.0, 1.0),
    aspect: float = 1.0,
) -> None:
    """Mencatat cat bentuk sederhana di `obj`: `shape` "circle" (diameter `size`) atau "square" (sisi `size`).

    `aspect`: tinggi/lebar (mis. 0,2 untuk garis); arah tinggi = `up`. `color`: hex atau (r, g, b) sRGB.
    Cat yang dicatat belakangan menimpa yang lebih dulu (mis. pupil di atas bola mata).
    """
    from assetkit.material import rgba

    if shape not in SHAPES:
        raise ValueError(f"shape harus salah satu dari {SHAPES}")
    if aspect <= 0:
        raise ValueError("aspect harus > 0")
    n, v = _frame(normal, up, size)
    _record(
        obj,
        {
            "shape": shape,
            "color": list(rgba(color)),
            "aspect": float(aspect),
            "center": list(center),
            "normal": list(n),
            "up": list(v),
            "width": float(size),
        },
    )


def _math(nodes, operation: str, *inputs):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate(inputs):
        node.inputs[index].default_value = value
    return node


def _vector_math(nodes, operation: str, vector=None):
    node = nodes.new("ShaderNodeVectorMath")
    node.operation = operation
    if vector is not None:
        node.inputs[1].default_value = vector
    return node


def _socket(sockets, identifier: str):
    for socket in sockets:
        if socket.identifier == identifier:
            return socket
    raise KeyError(identifier)


def _plane_coord(nodes, links, relative, direction: Vector, length: float, offset: float):
    """Koordinat bidang decal: dot(posisi − pusat, arah) / panjang + offset."""
    dot = _vector_math(nodes, "DOT_PRODUCT", direction)
    links.new(relative.outputs["Vector"], dot.inputs[0])
    scaled = _math(nodes, "MULTIPLY_ADD", 0.0, 1.0 / length, offset)
    links.new(dot.outputs["Value"], scaled.inputs[0])
    return scaled


def _shape_alpha(nodes, links, spec: dict, u_coord, v_coord):
    """Alpha bentuk cat dari koordinat bidang yang berpusat di 0 (−0,5..0,5 = di dalam)."""
    if spec["shape"] == "circle":
        vector = nodes.new("ShaderNodeCombineXYZ")
        links.new(u_coord.outputs["Value"], vector.inputs["X"])
        links.new(v_coord.outputs["Value"], vector.inputs["Y"])
        length = _vector_math(nodes, "LENGTH")
        links.new(vector.outputs["Vector"], length.inputs[0])
        inside = _math(nodes, "LESS_THAN", 0.0, 0.5)
        links.new(length.outputs["Value"], inside.inputs[0])
        return inside.outputs["Value"]
    biggest = _math(nodes, "MAXIMUM", 0.0, 0.0)
    for index, coord in enumerate((u_coord, v_coord)):
        absolute = _math(nodes, "ABSOLUTE", 0.0)
        links.new(coord.outputs["Value"], absolute.inputs[0])
        links.new(absolute.outputs["Value"], biggest.inputs[index])
    inside = _math(nodes, "LESS_THAN", 0.0, 0.5)
    links.new(biggest.outputs["Value"], inside.inputs[0])
    return inside.outputs["Value"]


def _install(mat: bpy.types.Material, spec: dict, offset: Vector) -> None:
    from assetkit.material import principled

    bsdf = principled(mat)
    if bsdf is None:
        return
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    width = spec["width"]
    n = Vector(spec["normal"])
    v = Vector(spec["up"])
    u = v.cross(n)
    center = Vector(spec["center"]) + offset

    geometry = nodes.new("ShaderNodeNewGeometry")
    relative = _vector_math(nodes, "SUBTRACT", center)
    links.new(geometry.outputs["Position"], relative.inputs[0])

    if "path" in spec:
        image = bpy.data.images.load(spec["path"], check_existing=True)
        aspect = image.size[1] / image.size[0] if image.size[0] > 0 else 1.0
        coords = nodes.new("ShaderNodeCombineXYZ")
        links.new(_plane_coord(nodes, links, relative, u, width, 0.5).outputs["Value"], coords.inputs["X"])
        links.new(_plane_coord(nodes, links, relative, v, width * aspect, 0.5).outputs["Value"], coords.inputs["Y"])
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.extension = "CLIP"
        links.new(coords.outputs["Vector"], texture.inputs["Vector"])
        color_socket = texture.outputs["Color"]
        alpha_socket = texture.outputs["Alpha"]
    else:
        aspect = spec["aspect"]
        u_coord = _plane_coord(nodes, links, relative, u, width, 0.0)
        v_coord = _plane_coord(nodes, links, relative, v, width * aspect, 0.0)
        alpha_socket = _shape_alpha(nodes, links, spec, u_coord, v_coord)
        color_node = nodes.new("ShaderNodeRGB")
        color_node.outputs["Color"].default_value = tuple(spec["color"])
        color_socket = color_node.outputs["Color"]

    # Hanya face yang menghadap arah decal dan dekat bidangnya (tidak tembus ke sisi belakang).
    facing = _vector_math(nodes, "DOT_PRODUCT", n)
    links.new(geometry.outputs["Normal"], facing.inputs[0])
    facing_mask = _math(nodes, "GREATER_THAN", 0.0, FACING_MIN)
    links.new(facing.outputs["Value"], facing_mask.inputs[0])
    depth = _vector_math(nodes, "DOT_PRODUCT", n)
    links.new(relative.outputs["Vector"], depth.inputs[0])
    depth_abs = _math(nodes, "ABSOLUTE", 0.0)
    links.new(depth.outputs["Value"], depth_abs.inputs[0])
    depth_mask = _math(nodes, "LESS_THAN", 0.0, max(0.01, width * 0.25))
    links.new(depth_abs.outputs["Value"], depth_mask.inputs[0])
    mask = _math(nodes, "MULTIPLY", 0.0, 0.0)
    links.new(facing_mask.outputs["Value"], mask.inputs[0])
    links.new(depth_mask.outputs["Value"], mask.inputs[1])
    factor = _math(nodes, "MULTIPLY", 0.0, 0.0)
    links.new(mask.outputs["Value"], factor.inputs[0])
    links.new(alpha_socket, factor.inputs[1])

    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    base = bsdf.inputs["Base Color"]
    if base.is_linked:
        links.new(base.links[0].from_socket, _socket(mix.inputs, "A_Color"))
    else:
        _socket(mix.inputs, "A_Color").default_value = tuple(base.default_value)
    links.new(color_socket, _socket(mix.inputs, "B_Color"))
    links.new(factor.outputs["Value"], _socket(mix.inputs, "Factor_Float"))
    links.new(_socket(mix.outputs, "Result_Color"), base)


def apply_pending(obj: bpy.types.Object) -> int:
    """Memasang decal yang dicatat ke shader material `obj` (material disalin bila dipakai bersama)."""
    entries = json.loads(obj.get(DECAL_KEY, "[]"))
    if not entries:
        return 0
    offset = Vector(bpy.context.scene.get(OFFSET_KEY, (0.0, 0.0, 0.0)))
    for slot in obj.material_slots:
        if slot.material is not None and slot.material.users > 1:
            slot.material = slot.material.copy()
    for slot in obj.material_slots:
        if slot.material is None:
            continue
        for spec in entries:
            _install(slot.material, spec, offset)
    del obj[DECAL_KEY]
    return len(entries)

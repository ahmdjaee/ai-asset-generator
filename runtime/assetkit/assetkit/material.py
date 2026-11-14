"""Material PBR untuk tahap tekstur.

Skrip boleh memakai material sebanyak apa pun. Harness (`bake.atlas`) mem-bake semuanya ke SATU material atlas
sesuai budget tier, jadi jumlah material di skrip tidak memengaruhi draw call.

- `pbr(...)`: warna + kekasaran + logam (+ emisi), opsional variasi warna halus (`variation`).
- `from_library(id, ...)`: material CC0 dari pustaka lokal (`list_materials` untuk mencari id).
- `wear(mat, ...)`: keausan di tepi dan kotoran di celah (dihitung Cycles saat bake).
- `assign(obj, mat)`: memasang material ke objek.
"""
import os
import re

import bpy

MATERIALS_ENV = "AAG_MATERIALS"
RESOLUTION_ENV = "AAG_TEXTURE_RES"
LIBRARY_ID = re.compile(r"^[A-Za-z][A-Za-z0-9]{1,40}$")
RESOLUTIONS = ("1k", "2k")
MAPPINGS = ("box", "uv")
#: Layer UV untuk tekstur berulang (diproyeksikan kotak dari koordinat dunia, dibuat harness saat bake).
TILING_UV = "tiling"
#: Layer UV bawaan bmesh `calc_uvs=True` (mapping="uv").
DEFAULT_UV = "UVMap"
#: Penanda material yang butuh sampel bake lebih banyak (AO/bevel di shader).
WEAR_KEY = "assetkit_wear"


def _srgb_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def rgba(value) -> tuple[float, float, float, float]:
    """Warna sRGB (`"#aabbcc"` atau `(r, g, b)` 0..1) → RGBA linear untuk socket Blender."""
    if isinstance(value, str):
        text = value.lstrip("#")
        if not re.fullmatch(r"[0-9a-fA-F]{6}", text):
            raise ValueError(f"warna hex harus #rrggbb, bukan {value!r}")
        rgb = tuple(int(text[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    else:
        rgb = tuple(float(c) for c in value)
        if len(rgb) != 3 or any(c < 0.0 or c > 1.0 for c in rgb):
            raise ValueError("warna harus (r, g, b) dengan nilai 0..1")
    return (*(_srgb_to_linear(c) for c in rgb), 1.0)


def _clamp01(name: str, value: float) -> float:
    value = float(value)
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} harus 0..1")
    return value


def _new_material(name: str) -> tuple[bpy.types.Material, bpy.types.Node]:
    """Material kosong berisi Principled BSDF → Material Output. Hasil: (material, bsdf)."""
    mat = bpy.data.materials.new(name)
    tree = mat.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.location = (400, 0)
    bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat, bsdf


def pbr(
    name: str,
    *,
    color=(0.8, 0.8, 0.8),
    roughness: float = 0.5,
    metallic: float = 0.0,
    emission=None,
    emission_strength: float = 1.0,
    variation: float = 0.0,
    variation_scale_m: float = 0.1,
) -> bpy.types.Material:
    """Material warna. `color`/`emission`: hex `"#rrggbb"` atau (r, g, b) sRGB 0..1.

    `variation` (0..1): variasi terang-gelap halus dari noise 3D supaya warna tidak rata (0,05–0,2 wajar);
    `variation_scale_m`: ukuran bercak noise dalam meter.
    """
    mat, bsdf = _new_material(name)
    bsdf.inputs["Base Color"].default_value = rgba(color)
    variation = _clamp01("variation", variation)
    if variation > 0.0:
        if variation_scale_m <= 0:
            raise ValueError("variation_scale_m harus > 0")
        _add_variation(mat, bsdf, rgba(color), variation, variation_scale_m)
    bsdf.inputs["Roughness"].default_value = _clamp01("roughness", roughness)
    bsdf.inputs["Metallic"].default_value = _clamp01("metallic", metallic)
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = rgba(emission)
        bsdf.inputs["Emission Strength"].default_value = max(0.0, float(emission_strength))
    return mat


def _add_variation(mat, bsdf, color, amount: float, scale_m: float) -> None:
    """Warna × (1 ± amount) mengikuti noise 3D di posisi dunia (stabil setelah objek digabung)."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    geometry = nodes.new("ShaderNodeNewGeometry")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.0 / scale_m
    noise.inputs["Detail"].default_value = 3.0
    links.new(geometry.outputs["Position"], noise.inputs["Vector"])
    # Fac noise kebanyakan 0,3–0,7: direntangkan ke 0..1 supaya `amount` benar-benar ±amount.
    spread = nodes.new("ShaderNodeMapRange")
    spread.clamp = True
    spread.inputs["From Min"].default_value = 0.3
    spread.inputs["From Max"].default_value = 0.7
    links.new(noise.outputs["Fac"], spread.inputs["Value"])
    value = nodes.new("ShaderNodeMath")
    value.operation = "MULTIPLY_ADD"
    value.inputs[1].default_value = 2.0 * amount
    value.inputs[2].default_value = 1.0 - amount
    links.new(spread.outputs["Result"], value.inputs[0])
    shade = nodes.new("ShaderNodeHueSaturation")
    shade.inputs["Color"].default_value = color
    links.new(value.outputs["Value"], shade.inputs["Value"])
    links.new(shade.outputs["Color"], bsdf.inputs["Base Color"])


def _mix_base(mat, bsdf, color, factor_socket) -> None:
    """Base Color = mix(warna sekarang, `color`, faktor)."""
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    base = bsdf.inputs["Base Color"]
    if base.is_linked:
        links.new(base.links[0].from_socket, _socket(mix.inputs, "A_Color"))
    else:
        _socket(mix.inputs, "A_Color").default_value = tuple(base.default_value)
    _socket(mix.inputs, "B_Color").default_value = color
    links.new(factor_socket, _socket(mix.inputs, "Factor_Float"))
    links.new(_socket(mix.outputs, "Result_Color"), base)


def _scaled(nodes, links, socket, gain: float):
    node = nodes.new("ShaderNodeMath")
    node.operation = "MULTIPLY"
    node.use_clamp = True
    node.inputs[1].default_value = gain
    links.new(socket, node.inputs[0])
    return node.outputs["Value"]


def wear(
    mat: bpy.types.Material,
    *,
    edge: float = 0.0,
    edge_color="#d8d0c2",
    edge_width_m: float = 0.004,
    dirt: float = 0.0,
    dirt_color="#2b2118",
    dirt_distance_m: float = 0.05,
) -> bpy.types.Material:
    """Keausan: `edge` (0..1) mencerahkan tepi tajam ke `edge_color` (cat terkelupas, logam aus);
    `dirt` (0..1) menggelapkan celah dan sudut dalam ke `dirt_color`. Dihitung Cycles saat bake, jadi ikut ke atlas.
    Bekerja untuk `pbr` maupun `from_library`.
    """
    edge = _clamp01("edge", edge)
    dirt = _clamp01("dirt", dirt)
    if edge_width_m <= 0 or dirt_distance_m <= 0:
        raise ValueError("edge_width_m dan dirt_distance_m harus > 0")
    bsdf = principled(mat)
    if bsdf is None:
        raise ValueError(f"material {mat.name} tidak punya Principled BSDF")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    if dirt > 0.0:
        ao = nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.only_local = True
        ao.inputs["Distance"].default_value = dirt_distance_m
        cavity = nodes.new("ShaderNodeMath")
        cavity.operation = "SUBTRACT"
        cavity.inputs[0].default_value = 1.0
        links.new(ao.outputs["AO"], cavity.inputs[1])
        _mix_base(mat, bsdf, rgba(dirt_color), _scaled(nodes, links, cavity.outputs["Value"], 2.0 * dirt))
    if edge > 0.0:
        bevel = nodes.new("ShaderNodeBevel")
        bevel.samples = 8
        bevel.inputs["Radius"].default_value = edge_width_m
        geometry = nodes.new("ShaderNodeNewGeometry")
        dot = nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        links.new(bevel.outputs["Normal"], dot.inputs[0])
        links.new(geometry.outputs["Normal"], dot.inputs[1])
        sharp = nodes.new("ShaderNodeMath")
        sharp.operation = "SUBTRACT"
        sharp.inputs[0].default_value = 1.0
        links.new(dot.outputs["Value"], sharp.inputs[1])
        # 1 − dot kecil (±0,0–0,1) di tepi; dikuatkan lalu dikalikan `edge`.
        _mix_base(mat, bsdf, rgba(edge_color), _scaled(nodes, links, sharp.outputs["Value"], 25.0 * edge))
    mat[WEAR_KEY] = True
    return mat


def _library_root() -> str:
    root = os.environ.get(MATERIALS_ENV, "")
    if not root or not os.path.isdir(root):
        raise RuntimeError("pustaka material tidak tersedia di job ini (hanya untuk build bertekstur)")
    return root


def _resolution() -> str:
    """Resolusi tekstur pustaka dari harness (`AAG_TEXTURE_RES`): 2k untuk tier Maksimal, selain itu 1k."""
    value = os.environ.get(RESOLUTION_ENV, "1k")
    return value if value in RESOLUTIONS else "1k"


def _image(path: str, *, data: bool) -> bpy.types.Image:
    image = bpy.data.images.load(path, check_existing=True)
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return image


def from_library(
    material_id: str,
    *,
    scale_m: float = 1.0,
    mapping: str = "box",
    tint=None,
    roughness_scale: float = 1.0,
    name: str | None = None,
) -> bpy.types.Material:
    """Material CC0 dari pustaka. Satu ulangan tekstur = `scale_m` meter.

    `mapping="box"` (bawaan): proyeksi kotak dari koordinat dunia, tanpa UV dari skrip.
    `mapping="uv"`: memakai layer UV `UVMap` milik mesh (mis. dari `calc_uvs=True`).
    `tint`: warna sRGB pengali (mis. untuk kayu yang lebih gelap).
    """
    if not LIBRARY_ID.fullmatch(material_id or ""):
        raise ValueError(f"id material tidak valid: {material_id!r}")
    if mapping not in MAPPINGS:
        raise ValueError(f"mapping harus salah satu dari {MAPPINGS}")
    if scale_m <= 0:
        raise ValueError("scale_m harus > 0")
    folder = os.path.join(_library_root(), material_id, _resolution())
    if not os.path.isfile(os.path.join(folder, "color.jpg")):
        raise ValueError(f"material {material_id} tidak ada di pustaka; cari id dengan tool list_materials")

    mat, bsdf = _new_material(name or material_id)
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = TILING_UV if mapping == "box" else DEFAULT_UV
    mapper = nodes.new("ShaderNodeMapping")
    mapper.inputs["Scale"].default_value = (1.0 / scale_m, 1.0 / scale_m, 1.0)
    links.new(uv.outputs["UV"], mapper.inputs["Vector"])

    def texture(map_name: str, *, data: bool) -> bpy.types.Node | None:
        path = os.path.join(folder, f"{map_name}.jpg")
        if not os.path.isfile(path):
            return None
        node = nodes.new("ShaderNodeTexImage")
        node.image = _image(path, data=data)
        links.new(mapper.outputs["Vector"], node.inputs["Vector"])
        return node

    base = texture("color", data=False)
    if tint is None:
        links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        multiply = nodes.new("ShaderNodeMix")
        multiply.data_type = "RGBA"
        multiply.blend_type = "MULTIPLY"
        _socket(multiply.inputs, "Factor_Float").default_value = 1.0
        links.new(base.outputs["Color"], _socket(multiply.inputs, "A_Color"))
        _socket(multiply.inputs, "B_Color").default_value = rgba(tint)
        links.new(_socket(multiply.outputs, "Result_Color"), bsdf.inputs["Base Color"])

    rough = texture("roughness", data=True)
    if rough is not None:
        if roughness_scale == 1.0:
            links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
        else:
            scale = nodes.new("ShaderNodeMath")
            scale.operation = "MULTIPLY"
            scale.use_clamp = True
            scale.inputs[1].default_value = float(roughness_scale)
            links.new(rough.outputs["Color"], scale.inputs[0])
            links.new(scale.outputs["Value"], bsdf.inputs["Roughness"])
    metal = texture("metalness", data=True)
    if metal is not None:
        links.new(metal.outputs["Color"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = 0.0
    normal = texture("normal", data=True)
    if normal is not None:
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.uv_map = uv.uv_map
        links.new(normal.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    mat["assetkit_library"] = material_id
    return mat


def _socket(sockets, identifier: str):
    for socket in sockets:
        if socket.identifier == identifier:
            return socket
    raise KeyError(identifier)


def assign(obj: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    """Mengganti semua material objek dengan `material`."""
    if obj.type != "MESH":
        raise ValueError("material hanya bisa dipasang ke objek mesh")
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.material_index = 0
    return obj


def principled(material: bpy.types.Material) -> bpy.types.Node | None:
    """Principled BSDF yang tersambung ke output aktif material, bila ada."""
    if material is None or material.node_tree is None:
        return None
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None

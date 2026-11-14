"""Bake tekstur dengan Cycles CPU.

- `pbr(high, low, ...)`: detail normal dari objek high-poly ke objek low-poly (ditandai; bake-nya dijalankan
  harness setelah `finalize()`, supaya posisi akhir sudah benar). Objek high tidak ikut diekspor.
- `atlas(sizes)`: tugas harness. Semua mesh digabung, di-unwrap xatlas, lalu warna, kekasaran, logam, normal,
  dan AO di-bake ke satu material atlas (baseColor + normal + ORM) sesuai ukuran tier.
"""
import contextlib
import json

import bpy
import numpy as np

from assetkit import decal, material as materials, uv
from assetkit.scene import mesh_objects, threads

SOURCE_KEY = "assetkit_bake_source"
DETAIL_KEY = "assetkit_detail"
DETAIL_UV = "detail"
ATLAS_MATERIAL = "atlas"
GLTF_GROUP = "glTF Material Output"
MAPS = ("normal",)
#: Sampel per jenis bake. Emisi tanpa noise (tekstur saja); AO butuh lebih banyak.
EMIT_SAMPLES = 4
#: Sampel bake warna/kekasaran bila ada material dengan `material.wear` (AO/bevel di shader butuh lebih banyak).
WEAR_SAMPLES = 24
AO_SAMPLES = 32
#: Kekasaran dan logam material atlas untuk tier tanpa tekstur ORM.
FLAT_ROUGHNESS = 0.6
#: Tanpa ORM: warna logam digelapkan sebanyak ini (0..1) supaya tetap terbaca sebagai logam.
METAL_DARKEN = 0.45


def _is_source(obj: bpy.types.Object) -> bool:
    return bool(obj.get(SOURCE_KEY, False))


def pbr(
    high: bpy.types.Object,
    low: bpy.types.Object,
    *,
    maps=("normal",),
    size: int | None = None,
    cage_extrusion: float = 0.02,
) -> None:
    """Menandai `high` sebagai sumber detail normal untuk `low`. `high` disembunyikan dan tidak diekspor.

    `size`: ukuran tekstur detail (bawaan: ukuran normal tier). `cage_extrusion`: jarak sinar (meter) dari
    permukaan low ke high; naikkan bila detail high menonjol jauh.
    """
    if high.type != "MESH" or low.type != "MESH" or high == low:
        raise ValueError("pbr butuh dua objek mesh yang berbeda (high, low)")
    unknown = [m for m in maps if m not in MAPS]
    if unknown:
        raise ValueError(f"map tidak didukung: {unknown}; yang didukung {MAPS}")
    if cage_extrusion <= 0:
        raise ValueError("cage_extrusion harus > 0")
    high[SOURCE_KEY] = True
    high.hide_render = True
    entries = json.loads(low.get(DETAIL_KEY, "[]"))
    entries.append({"high": high.name, "size": size, "cage": float(cage_extrusion)})
    low[DETAIL_KEY] = json.dumps(entries)


@contextlib.contextmanager
def _cycles(samples: int):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = threads()
    yield scene


def _new_image(name: str, size: int, *, data: bool, fill=(0.0, 0.0, 0.0, 1.0)) -> bpy.types.Image:
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"
    image.generated_color = fill
    return image


def _bake(obj, image, kind: str, *, samples: int, margin: int, selected=(), cage: float = 0.0) -> None:
    """Bake `kind` ke `image` di UV aktif `obj`. `selected`: objek sumber untuk selected-to-active."""
    added = []
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None:
            continue
        node = mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        mat.node_tree.nodes.active = node
        added.append((mat, node))
    try:
        with _cycles(samples) as scene:
            bake = scene.render.bake
            bake.margin = margin
            bake.margin_type = "EXTEND"
            bake.use_clear = True
            bake.use_selected_to_active = bool(selected)
            bake.cage_extrusion = cage
            bake.normal_space = "TANGENT"
            chosen = [obj, *selected]
            with bpy.context.temp_override(
                active_object=obj, object=obj, selected_objects=chosen, selected_editable_objects=chosen
            ):
                bpy.ops.object.bake(type=kind, margin=margin, use_clear=True, use_selected_to_active=bool(selected))
    finally:
        for mat, node in added:
            mat.node_tree.nodes.remove(node)


def _surface_link(tree):
    output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
    if output is None:
        output = next((n for n in tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if output is None:
        output = tree.nodes.new("ShaderNodeOutputMaterial")
    surface = output.inputs["Surface"]
    original = surface.links[0].from_socket if surface.is_linked else None
    return surface, original


@contextlib.contextmanager
def _emit_channel(mats, channel: str):
    """Sementara: input Principled `channel` → emisi, supaya bake EMIT menghasilkan nilai mentahnya."""
    restore = []
    defaults = {"Base Color": (0.8, 0.8, 0.8, 1.0), "Roughness": 0.5, "Metallic": 0.0}
    for mat in mats:
        tree = mat.node_tree
        surface, original = _surface_link(tree)
        emission = tree.nodes.new("ShaderNodeEmission")
        emission.inputs["Strength"].default_value = 1.0
        bsdf = materials.principled(mat)
        source = bsdf.inputs[channel] if bsdf is not None else None
        if source is not None and source.is_linked:
            tree.links.new(source.links[0].from_socket, emission.inputs["Color"])
        else:
            value = source.default_value if source is not None else defaults[channel]
            if isinstance(value, float):
                emission.inputs["Color"].default_value = (value, value, value, 1.0)
            else:
                emission.inputs["Color"].default_value = tuple(value)
        tree.links.new(emission.outputs["Emission"], surface)
        restore.append((tree, surface, original, emission))
    try:
        yield
    finally:
        for tree, surface, original, emission in restore:
            tree.nodes.remove(emission)
            if original is not None:
                tree.links.new(original, surface)


def _pixels(image: bpy.types.Image) -> np.ndarray:
    data = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(-1, 4)


def _store(image: bpy.types.Image, pixels: np.ndarray) -> None:
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    image.update()


def _pack(image: bpy.types.Image) -> None:
    image.file_format = "PNG"
    image.pack()


def _materials_of(obj) -> list:
    return [slot.material for slot in obj.material_slots if slot.material is not None]


def _ensure_material(obj) -> None:
    """Setiap slot harus bermaterial. Slot kosong (mis. dari cutter boolean) memakai material pertama objek."""
    if not _materials_of(obj):
        materials.assign(obj, materials.pbr("bawaan", color=(0.7, 0.7, 0.7)))
        return
    first = _materials_of(obj)[0]
    for slot in obj.material_slots:
        if slot.material is None:
            slot.material = first


def _unique_materials(obj) -> None:
    """Material yang dipakai bersama disalin, supaya detail/decal satu objek tidak bocor ke objek lain."""
    for slot in obj.material_slots:
        if slot.material is not None and slot.material.users > 1:
            slot.material = slot.material.copy()


def _bake_details(obj, normal_size: int, margin: int) -> None:
    """Detail high → low: semua objek high milik `obj` di-bake sekaligus (selected-to-active) ke normal tangent di
    layer UV `detail`, lalu dipasang ke input normal material `obj`."""
    entries = json.loads(obj.get(DETAIL_KEY, "[]"))
    if not entries:
        return
    highs = []
    for entry in entries:
        high = bpy.data.objects.get(entry["high"])
        if high is None:
            raise ValueError(f"objek high {entry['high']} sudah tidak ada")
        highs.append(high)
    size = max(int(entry["size"] or normal_size) for entry in entries)
    cage = max(float(entry["cage"]) for entry in entries)
    _unique_materials(obj)
    uv.unwrap(obj, name=DETAIL_UV, resolution=size)
    image = _new_image(f"detail_{obj.name}", size, data=True, fill=(0.5, 0.5, 1.0, 1.0))
    for high in highs:
        high.hide_render = False
    try:
        _bake(obj, image, "NORMAL", samples=1, margin=margin, selected=highs, cage=cage)
    finally:
        for high in highs:
            high.hide_render = True
    _pack(image)
    for mat in _materials_of(obj):
        tree = mat.node_tree
        bsdf = materials.principled(mat)
        if bsdf is None:
            continue
        texture = tree.nodes.new("ShaderNodeTexImage")
        texture.image = image
        uv_node = tree.nodes.new("ShaderNodeUVMap")
        uv_node.uv_map = DETAIL_UV
        tree.links.new(uv_node.outputs["UV"], texture.inputs["Vector"])
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        normal_map.uv_map = DETAIL_UV
        tree.links.new(texture.outputs["Color"], normal_map.inputs["Color"])
        tree.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])


def _join(objects: list) -> bpy.types.Object:
    target = objects[0]
    if len(objects) > 1:
        with bpy.context.temp_override(
            active_object=target, object=target, selected_objects=objects, selected_editable_objects=objects
        ):
            bpy.ops.object.join()
    target.name = "asset"
    target.data.name = "asset"
    return target


def _gltf_group() -> bpy.types.NodeTree:
    """Grup node yang dibaca eksporter glTF Blender untuk occlusionTexture."""
    group = bpy.data.node_groups.get(GLTF_GROUP)
    if group is None:
        group = bpy.data.node_groups.new(GLTF_GROUP, "ShaderNodeTree")
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def _atlas_material(color_image, normal_image, orm_image) -> bpy.types.Material:
    mat, bsdf = materials._new_material(ATLAS_MATERIAL)
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    uv_node = nodes.new("ShaderNodeUVMap")
    uv_node.uv_map = uv.ATLAS_UV

    def texture(image):
        node = nodes.new("ShaderNodeTexImage")
        node.image = image
        links.new(uv_node.outputs["UV"], node.inputs["Vector"])
        return node

    links.new(texture(color_image).outputs["Color"], bsdf.inputs["Base Color"])
    if normal_image is not None:
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.uv_map = uv.ATLAS_UV
        links.new(texture(normal_image).outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    if orm_image is not None:
        split = nodes.new("ShaderNodeSeparateColor")
        links.new(texture(orm_image).outputs["Color"], split.inputs["Color"])
        links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
        links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
        group = nodes.new("ShaderNodeGroup")
        group.node_tree = _gltf_group()
        links.new(split.outputs["Red"], group.inputs["Occlusion"])
    else:
        bsdf.inputs["Roughness"].default_value = FLAT_ROUGHNESS
        bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def atlas(*, base_color: int, normal: int | None = None, orm: int | None = None, padding: int = 8) -> dict:
    """Tugas harness setelah `finalize()`: semua mesh → satu objek dengan satu material atlas.

    `normal`/`orm` = None: tier tanpa tekstur itu (AO dikalikan ke warna dasar).
    Hasil: ringkasan (ukuran, jumlah chart, waktu per langkah diukur pemanggil).
    """
    from assetkit import protocol

    objects = [o for o in mesh_objects() if not _is_source(o)]
    if not objects:
        raise ValueError("tidak ada mesh untuk di-bake")
    sources = [o for o in mesh_objects() if _is_source(o)]
    normal_size = normal or base_color
    for obj in objects:
        _ensure_material(obj)
        decal.apply_pending(obj)
        uv.box_project(obj, name=materials.TILING_UV)
    for index, obj in enumerate(objects):
        protocol.progress("bake detail high-poly", 5 + 10 * index / len(objects))
        _bake_details(obj, normal_size, padding)
    for source in sources:
        bpy.data.objects.remove(source, do_unlink=True)

    asset = _join(objects)
    protocol.progress("unwrap UV atlas", 20)
    summary = uv.unwrap(asset, method="xatlas", padding=padding, resolution=base_color)
    mats = _materials_of(asset)
    orm_size = orm or base_color
    emit_samples = WEAR_SAMPLES if any(mat.get(materials.WEAR_KEY) for mat in mats) else EMIT_SAMPLES

    protocol.progress("bake warna", 30)
    color_image = _new_image("baseColor", base_color, data=False)
    with _emit_channel(mats, "Base Color"):
        _bake(asset, color_image, "EMIT", samples=emit_samples, margin=padding)

    protocol.progress("bake ambient occlusion", 45)
    ao_image = _new_image("ao", orm_size, data=True, fill=(1.0, 1.0, 1.0, 1.0))
    _bake(asset, ao_image, "AO", samples=AO_SAMPLES, margin=padding)

    normal_image = None
    orm_image = None
    if orm is not None:
        protocol.progress("bake kekasaran dan logam", 65)
        rough_image = _new_image("roughness", orm_size, data=True)
        with _emit_channel(mats, "Roughness"):
            _bake(asset, rough_image, "EMIT", samples=emit_samples, margin=padding)
        metal_image = _new_image("metallic", orm_size, data=True)
        with _emit_channel(mats, "Metallic"):
            _bake(asset, metal_image, "EMIT", samples=EMIT_SAMPLES, margin=padding)
        orm_image = _new_image("orm", orm_size, data=True)
        packed = _pixels(ao_image).copy()
        packed[:, 1] = _pixels(rough_image)[:, 0]
        packed[:, 2] = _pixels(metal_image)[:, 0]
        packed[:, 3] = 1.0
        _store(orm_image, packed)
        _pack(orm_image)
        for temp in (rough_image, metal_image):
            bpy.data.images.remove(temp)
    else:
        # Tanpa ORM: AO dikalikan lembut ke warna dasar supaya celah tetap terbaca, dan permukaan logam
        # digelapkan (tanpa map logam, logam terang terlihat seperti cat putih).
        metal_image = _new_image("metallic", base_color, data=True)
        with _emit_channel(mats, "Metallic"):
            _bake(asset, metal_image, "EMIT", samples=EMIT_SAMPLES, margin=padding)
        ao = _pixels(ao_image)[:, 0]
        metal = _pixels(metal_image)[:, 0]
        colors = _pixels(color_image)
        colors[:, :3] *= ((0.35 + 0.65 * ao) * (1.0 - METAL_DARKEN * metal))[:, None]
        _store(color_image, colors)
        bpy.data.images.remove(metal_image)
    bpy.data.images.remove(ao_image)

    if normal is not None:
        protocol.progress("bake normal", 80)
        normal_image = _new_image("normal", normal, data=True, fill=(0.5, 0.5, 1.0, 1.0))
        _bake(asset, normal_image, "NORMAL", samples=1, margin=padding)
        _pack(normal_image)
    _pack(color_image)

    final = _atlas_material(color_image, normal_image, orm_image)
    materials.assign(asset, final)
    for layer in [layer for layer in asset.data.uv_layers if layer.name != uv.ATLAS_UV]:
        asset.data.uv_layers.remove(layer)
    atlas_layer = asset.data.uv_layers[uv.ATLAS_UV]
    asset.data.uv_layers.active = atlas_layer
    atlas_layer.active_render = True
    for mat in mats:
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    return {
        "baseColor": base_color,
        "normal": normal,
        "orm": orm,
        "charts": summary["charts"],
        "utilization": summary["utilization"],
    }

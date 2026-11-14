"""Ekspor GLB dan `.blend`. Dipanggil oleh harness (`assetkit.run --export/--blend`), bukan oleh skrip aset."""
import os

import bpy


def export_glb(path: str, *, materials: bool = False) -> dict:
    """Ekspor semua mesh yang terlihat ke GLB (+Y up). Tahap bentuk dasar selalu `materials=False`."""
    if not path.endswith(".glb"):
        raise ValueError("path ekspor harus berakhiran .glb")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_visible=True,
        export_materials="EXPORT" if materials else "NONE",
        export_texcoords=materials,
        export_normals=True,
        # Tangent ikut diekspor untuk normal map (tanpa ini engine menghitung sendiri dan hasilnya bisa berbeda).
        export_tangents=materials,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    return {"path": path, "bytes": os.path.getsize(path)}


def _id_blocks():
    """Semua datablock ID di file, termasuk node tree yang tertanam di material, world, dan lampu."""
    for name in dir(bpy.data):
        collection = getattr(bpy.data, name, None)
        if not isinstance(collection, bpy.types.bpy_prop_collection):
            continue
        for block in collection:
            if not isinstance(block, bpy.types.ID):
                continue
            yield block
            tree = getattr(block, "node_tree", None)
            if isinstance(tree, bpy.types.ID):
                yield tree


def _strip_python() -> dict:
    """Buang semua yang bisa menjalankan Python saat `.blend` dibuka di Blender desktop pemilik.

    Skrip aset tidak tepercaya dan hanya berjalan di sandbox. Teks (modul yang didaftarkan saat file dibuka) dan driver
    berekspresi Python akan berjalan di host bila Blender mengizinkan skrip otomatis. Driver jenis lain (rata-rata,
    jumlah, min/maks) tidak menjalankan Python, jadi tetap disimpan.
    """
    texts = list(bpy.data.texts)
    for text in texts:
        bpy.data.texts.remove(text)
    drivers = 0
    for block in _id_blocks():
        animation = getattr(block, "animation_data", None)
        if animation is None:
            continue
        for fcurve in [fcurve for fcurve in animation.drivers if fcurve.driver.type == "SCRIPTED"]:
            animation.drivers.remove(fcurve)
            drivers += 1
    return {"texts": len(texts), "drivers": drivers}


def save_blend(path: str) -> dict:
    """Simpan adegan sebagai `.blend` untuk preset ekspor Sumber (setelah ekspor GLB, jadi isinya sama).

    Teks dan driver Python dibuang lebih dulu (`_strip_python`). Data yatim dibuang (mis. material pustaka yang sudah
    diganti atlas), lalu gambar yang masih dipakai dikemas ke dalam file, sehingga `.blend` bisa dibuka di Blender mana
    pun tanpa folder pustaka atau lampiran.
    """
    if not path.endswith(".blend"):
        raise ValueError("path .blend harus berakhiran .blend")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    removed = _strip_python()
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    for image in bpy.data.images:
        if image.users > 0 and image.packed_file is None and image.source in {"FILE", "GENERATED"}:
            image.pack()
    # Operator tanpa UI (jalan di mode modul); `copy=True`: path file sesi tidak ikut berubah.
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True, copy=True)
    return {"path": path, "bytes": os.path.getsize(path), "removed": removed}

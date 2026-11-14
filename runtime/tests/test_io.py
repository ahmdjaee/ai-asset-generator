import bpy
import pytest

from assetkit import export_glb, finalize, prim, save_blend
from helpers import read_glb_json


def test_ekspor_glb_y_up_tanpa_material(tmp_path):
    prim.box((1, 2, 3))
    finalize()
    out = str(tmp_path / "base.glb")
    result = export_glb(out)
    assert result["bytes"] > 0
    gltf = read_glb_json(out)
    assert "materials" not in gltf
    accessor = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    # Tinggi aset (sumbu Z Blender) menjadi sumbu Y di glTF.
    assert accessor["min"][1] == pytest.approx(0.0, abs=1e-5)
    assert accessor["max"][1] == pytest.approx(3.0, abs=1e-5)


def test_ekstensi_harus_glb(tmp_path):
    prim.box()
    with pytest.raises(ValueError):
        export_glb(str(tmp_path / "base.gltf"))


def _textured_box():
    box = prim.box((1, 1, 1), name="peti")
    # Seperti hasil bake: piksel diubah, jadi gambar harus dikemas (gambar GENERATED yang belum diubah dibuat ulang
    # Blender saat file dibuka, jadi tidak perlu dikemas).
    image = bpy.data.images.new("atlas", 8, 8)
    pixels = [0.0] * (8 * 8 * 4)
    pixels[0:4] = (1.0, 0.0, 0.0, 1.0)
    image.pixels.foreach_set(pixels)
    mat = bpy.data.materials.new("atlas")
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    box.data.materials.append(mat)
    return image


def test_simpan_blend_mengemas_gambar_membuang_data_yatim(tmp_path):
    _textured_box()
    bpy.data.materials.new("yatim")
    bpy.data.images.new("yatim", 4, 4)
    finalize()
    out = str(tmp_path / "scene.blend")
    assert save_blend(out)["bytes"] > 0
    with bpy.data.libraries.load(out) as (data_from, data_to):
        assert "peti" in data_from.objects
        assert "yatim" not in data_from.materials
        assert "yatim" not in data_from.images
        data_to.images = ["atlas"]
    loaded = data_to.images[0]
    assert loaded.packed_file is not None
    assert tuple(loaded.size) == (8, 8)
    assert tuple(loaded.pixels[0:4]) == pytest.approx((1.0, 0.0, 0.0, 1.0), abs=1e-2)


def test_simpan_blend_menolak_ekstensi_lain(tmp_path):
    prim.box()
    with pytest.raises(ValueError):
        save_blend(str(tmp_path / "scene.blend1"))


def test_simpan_blend_membuang_teks_dan_driver_python(tmp_path):
    """Skrip aset tidak tepercaya: kode yang bisa berjalan saat `.blend` dibuka di host tidak ikut tersimpan."""
    box = prim.box((1, 1, 1), name="peti")
    text = bpy.data.texts.new("jahat.py")
    text.write("import os\n")
    text.use_module = True
    text.use_fake_user = True
    scripted = box.driver_add("location", 0).driver
    scripted.type = "SCRIPTED"
    scripted.expression = "__import__('os').getpid()"
    average = box.driver_add("location", 1).driver
    average.type = "AVERAGE"
    mat = bpy.data.materials.new("bahan")
    value = mat.node_tree.nodes.new("ShaderNodeValue")
    in_tree = value.outputs[0].driver_add("default_value").driver
    in_tree.type = "SCRIPTED"
    in_tree.expression = "1 + 1"
    box.data.materials.append(mat)
    out = str(tmp_path / "scene.blend")
    assert save_blend(out)["removed"] == {"texts": 1, "drivers": 2}
    with bpy.data.libraries.load(out) as (data_from, data_to):
        assert list(data_from.texts) == []
        data_to.objects = ["peti"]
        data_to.materials = ["bahan"]
    loaded_box, loaded_mat = data_to.objects[0], data_to.materials[0]
    assert [fcurve.driver.type for fcurve in loaded_box.animation_data.drivers] == ["AVERAGE"]
    tree_animation = loaded_mat.node_tree.animation_data
    assert tree_animation is None or len(tree_animation.drivers) == 0

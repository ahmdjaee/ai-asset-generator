import pytest

from assetkit import material, prim
from texture_helpers import fake_library


def test_rgba_hex_dan_tuple_ke_linear():
    assert material.rgba("#ffffff") == (1.0, 1.0, 1.0, 1.0)
    assert material.rgba((0, 0, 0)) == (0.0, 0.0, 0.0, 1.0)
    assert abs(material.rgba("#808080")[0] - 0.2158) < 1e-3


@pytest.mark.parametrize("value", ["#fff", "merah", (2, 0, 0), (0.1, 0.2)])
def test_warna_tidak_valid_ditolak(value):
    with pytest.raises(ValueError):
        material.rgba(value)


def test_pbr_mengisi_principled():
    mat = material.pbr("cat", color="#ff0000", roughness=0.3, metallic=1.0, emission="#00ff00", emission_strength=2)
    bsdf = material.principled(mat)
    assert tuple(bsdf.inputs["Base Color"].default_value) == (1.0, 0.0, 0.0, 1.0)
    assert bsdf.inputs["Roughness"].default_value == pytest.approx(0.3)
    assert bsdf.inputs["Metallic"].default_value == 1.0
    assert bsdf.inputs["Emission Strength"].default_value == 2.0


def test_pbr_nilai_di_luar_rentang_ditolak():
    with pytest.raises(ValueError):
        material.pbr("x", roughness=1.5)


def test_from_library_memakai_uv_tiling_dan_normal_map(tmp_path, monkeypatch):
    monkeypatch.setenv(material.MATERIALS_ENV, fake_library(tmp_path, metal=True))
    mat = material.from_library("Wood001", scale_m=0.5, tint="#ffffff")
    nodes = mat.node_tree.nodes
    images = sorted(n.image.name for n in nodes if n.type == "TEX_IMAGE")
    assert images == ["color.jpg", "metalness.jpg", "normal.jpg", "roughness.jpg"]
    assert next(n for n in nodes if n.type == "UVMAP").uv_map == material.TILING_UV
    assert next(n for n in nodes if n.type == "NORMAL_MAP").uv_map == material.TILING_UV
    assert tuple(next(n for n in nodes if n.type == "MAPPING").inputs["Scale"].default_value)[:2] == (2.0, 2.0)
    assert bpy_image("normal.jpg").colorspace_settings.name == "Non-Color"
    assert bpy_image("color.jpg").colorspace_settings.name == "sRGB"


def bpy_image(name):
    import bpy

    return bpy.data.images[name]


def test_from_library_tanpa_metalness_logam_nol(tmp_path, monkeypatch):
    monkeypatch.setenv(material.MATERIALS_ENV, fake_library(tmp_path))
    mat = material.from_library("Wood001")
    assert material.principled(mat).inputs["Metallic"].default_value == 0.0


@pytest.mark.parametrize("material_id", ["../etc", "Wood001/../x", "", "1abc"])
def test_from_library_id_tidak_valid(tmp_path, monkeypatch, material_id):
    monkeypatch.setenv(material.MATERIALS_ENV, fake_library(tmp_path))
    with pytest.raises(ValueError):
        material.from_library(material_id)


def test_from_library_id_tidak_ada_menyarankan_list_materials(tmp_path, monkeypatch):
    monkeypatch.setenv(material.MATERIALS_ENV, fake_library(tmp_path))
    with pytest.raises(ValueError, match="list_materials"):
        material.from_library("Metal999")


def test_from_library_tanpa_pustaka(monkeypatch):
    monkeypatch.delenv(material.MATERIALS_ENV, raising=False)
    with pytest.raises(RuntimeError, match="pustaka"):
        material.from_library("Wood001")


def test_assign_mengganti_semua_slot():
    box = prim.box((1, 1, 1))
    material.assign(box, material.pbr("a"))
    material.assign(box, material.pbr("b"))
    assert [slot.material.name for slot in box.material_slots] == ["b"]

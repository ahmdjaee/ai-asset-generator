"""Bake atlas di ukuran kecil (cepat). Sanity: normal area datar ≈ (0.5, 0.5, 1), warna/ORM sesuai input."""
import bpy
import numpy as np
import pytest

from assetkit import bake, decal, finalize, material, mod, prim, stats
from assetkit.io import export_glb
from helpers import read_glb_json
from texture_helpers import covered, save_image


def _plane_box(color="#ff0000", roughness=0.25, metallic=1.0):
    box = prim.box((1, 1, 0.02), name="pelat", location=(0, 0, 0.01))
    material.assign(box, material.pbr("cat", color=color, roughness=roughness, metallic=metallic))
    return box


def _image(name):
    return bpy.data.images[name]


def test_atlas_satu_material_dan_ukuran_tier():
    _plane_box()
    other = prim.box((0.2, 0.2, 0.2), name="kubus", location=(0, 0, 0.12))
    material.assign(other, material.pbr("biru", color="#0000ff"))
    finalize()
    summary = bake.atlas(base_color=64, normal=64, orm=32, padding=2)
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert len(objects) == 1
    asset = objects[0]
    assert [slot.material.name for slot in asset.material_slots] == [bake.ATLAS_MATERIAL]
    assert [layer.name for layer in asset.data.uv_layers] == ["atlas"]
    assert tuple(_image("baseColor").size) == (64, 64)
    assert tuple(_image("normal").size) == (64, 64)
    assert tuple(_image("orm").size) == (32, 32)
    assert summary["charts"] >= 2
    assert stats()["materials"] == 1


def test_sanity_normal_datar_warna_dan_orm():
    _plane_box(color="#ff0000", roughness=0.25, metallic=1.0)
    finalize()
    bake.atlas(base_color=64, normal=64, orm=64, padding=2)
    normal = np.median(covered(_image("normal"))[:, :3], axis=0)
    assert normal == pytest.approx([0.5, 0.5, 1.0], abs=0.03)
    color = np.median(covered(_image("baseColor"))[:, :3], axis=0)
    assert color == pytest.approx([1.0, 0.0, 0.0], abs=0.03)
    orm = np.median(covered(_image("orm"))[:, :3], axis=0)
    assert orm[1] == pytest.approx(0.25, abs=0.03)
    assert orm[2] == pytest.approx(1.0, abs=0.03)
    assert orm[0] > 0.6  # AO pelat tunggal hampir tanpa oklusi


def test_tier_ringan_tanpa_normal_orm_dan_logam_digelapkan():
    _plane_box(color="#ffffff", metallic=1.0)
    finalize()
    bake.atlas(base_color=32, padding=2)
    assert "normal" not in bpy.data.images and "orm" not in bpy.data.images
    color = np.median(covered(_image("baseColor"))[:, :3], axis=0)
    assert color.max() < 0.8


def test_slot_kosong_dari_boolean_diisi_material_pertama():
    box = _plane_box()
    box.data.materials.append(None)
    bake._ensure_material(box)
    assert all(slot.material is not None for slot in box.material_slots)


def test_ekspor_glb_occlusion_dan_mr_satu_tekstur(tmp_path):
    _plane_box()
    finalize()
    bake.atlas(base_color=32, normal=32, orm=32, padding=2)
    out = str(tmp_path / "final.glb")
    export_glb(out, materials=True)
    gltf = read_glb_json(out)
    assert len(gltf["materials"]) == 1
    pbr = gltf["materials"][0]["pbrMetallicRoughness"]
    assert "baseColorTexture" in pbr and "metallicRoughnessTexture" in pbr
    assert "normalTexture" in gltf["materials"][0]
    assert gltf["materials"][0]["occlusionTexture"]["index"] == pbr["metallicRoughnessTexture"]["index"]
    assert len(gltf["images"]) == 3
    # Normal map butuh tangent di file supaya hasilnya sama di semua engine (validator: GENERATED_TANGENT_SPACE).
    assert "TANGENT" in gltf["meshes"][0]["primitives"][0]["attributes"]


def test_decal_ikut_terbake_ke_warna(tmp_path):
    box = _plane_box(color="#ff0000", metallic=0.0)
    logo = save_image(str(tmp_path / "logo.png"), 8, (0.0, 0.0, 1.0, 1.0), file_format="PNG")
    decal.from_image("logo.png", box, center=(0, 0, 0.02), normal=(0, 0, 1), up=(0, 1, 0), width=0.5, path=logo)
    finalize()
    bake.atlas(base_color=64, padding=2)
    colors = covered(_image("baseColor"))[:, :3]
    blue = (colors[:, 2] > 0.5) & (colors[:, 0] < 0.3)
    red = (colors[:, 0] > 0.5) & (colors[:, 2] < 0.3)
    assert blue.sum() > 20 and red.sum() > 20


def test_decal_validasi():
    box = prim.box((1, 1, 1))
    with pytest.raises(ValueError):
        decal.from_image("../rahasia.png", box, center=(0, 0, 0), normal=(0, 0, 1), width=0.1)
    with pytest.raises(ValueError):
        decal.from_image("x.png", box, center=(0, 0, 0), normal=(0, 0, 1), up=(0, 0, 1), width=0.1, path="/x")


def test_detail_high_poly_ke_normal_dan_high_tidak_diekspor(tmp_path):
    low = _plane_box(metallic=0.0)
    high = prim.box((1, 1, 0.02), name="tinggi", location=(0, 0, 0.01))
    bump = prim.box((0.3, 0.3, 0.03), name="tonjolan", location=(0, 0, 0.03))
    mod.bevel(bump, width=0.01, segments=3)
    bake.pbr(bump, low, cage_extrusion=0.05)
    bake.pbr(high, low, cage_extrusion=0.05)
    s = finalize()
    assert s["objects"] == 1
    bake.atlas(base_color=64, normal=64, orm=32, padding=2)
    normals = covered(_image("normal"))[:, :3]
    assert (np.abs(normals[:, 0] - 0.5) > 0.15).sum() > 3
    assert {o.name for o in bpy.context.scene.objects if o.type == "MESH"} == {"asset"}


def test_pbr_validasi():
    a = prim.box((1, 1, 1))
    with pytest.raises(ValueError):
        bake.pbr(a, a)
    with pytest.raises(ValueError):
        bake.pbr(prim.box((1, 1, 1)), a, maps=("height",))

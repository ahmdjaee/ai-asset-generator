"""Variasi warna, keausan, dan cat prosedural ikut ter-bake ke atlas warna."""
import bpy
import numpy as np
import pytest

from assetkit import bake, decal, finalize, material, prim
from texture_helpers import covered


def _color():
    return covered(bpy.data.images["baseColor"])[:, :3]


def test_variation_membuat_warna_tidak_rata():
    box = prim.box((1, 1, 0.02), name="pelat", location=(0, 0, 0.01))
    material.assign(box, material.pbr("kayu", color="#808080", variation=0.3, variation_scale_m=0.1))
    finalize()
    bake.atlas(base_color=64, padding=2)
    brightness = _color().mean(axis=1)
    # ±30% linear ≈ ±13% setelah encode sRGB.
    assert brightness.std() > 0.015
    assert np.percentile(brightness, 95) - np.percentile(brightness, 5) > 0.06
    # Piksel atlas warna tersimpan sRGB: median tetap dekat warna dasar #808080 ≈ 0,5.
    assert np.median(brightness) == pytest.approx(0.5, abs=0.08)


def test_variation_nol_tetap_rata():
    box = prim.box((1, 1, 0.02), name="pelat", location=(0, 0, 0.01))
    material.assign(box, material.pbr("cat", color="#808080"))
    finalize()
    bake.atlas(base_color=32, padding=2)
    assert _color().mean(axis=1).std() < 0.005


def test_dirt_menggelapkan_sudut_dalam():
    alas = prim.box((1, 1, 0.1), name="alas", location=(0, 0, 0.05))
    dinding = prim.box((0.1, 1, 0.5), name="dinding", location=(0.45, 0, 0.35))
    cat = material.wear(material.pbr("cat", color="#ffffff", roughness=0.8), dirt=1.0, dirt_distance_m=0.2)
    for obj in (alas, dinding):
        material.assign(obj, cat)
    finalize()
    bake.atlas(base_color=64, padding=2)
    brightness = _color().mean(axis=1)
    # Sudut pertemuan alas-dinding gelap; permukaan terbuka tetap terang.
    assert brightness.min() < 0.5
    assert np.percentile(brightness, 75) > 0.7


def test_edge_mencerahkan_tepi():
    kubus = prim.box((0.5, 0.5, 0.5), name="kubus", location=(0, 0, 0.25))
    material.assign(kubus, material.wear(material.pbr("gelap", color="#202020"), edge=1.0, edge_width_m=0.03,
                                        edge_color="#ffffff"))
    finalize()
    bake.atlas(base_color=64, padding=2)
    brightness = _color().mean(axis=1)
    assert brightness.max() > 0.3  # tepi mendekati putih
    assert np.median(brightness) < 0.2  # tengah sisi tetap #202020 (sRGB ≈ 0,125)


def test_wear_validasi():
    mat = material.pbr("x")
    with pytest.raises(ValueError):
        material.wear(mat, edge=2.0)
    with pytest.raises(ValueError):
        material.wear(mat, dirt=0.5, dirt_distance_m=0)
    with pytest.raises(ValueError):
        material.pbr("y", variation=0.2, variation_scale_m=0)


def test_paint_lingkaran_dan_persegi_ikut_terbake():
    box = prim.box((1, 1, 0.02), name="pelat", location=(0, 0, 0.01))
    material.assign(box, material.pbr("merah", color="#ff0000", roughness=0.8, metallic=0.0))
    decal.paint(box, shape="circle", center=(-0.25, 0, 0.02), normal=(0, 0, 1), up=(0, 1, 0), size=0.3,
                color="#0000ff")
    decal.paint(box, shape="square", center=(0.25, 0, 0.02), normal=(0, 0, 1), up=(0, 1, 0), size=0.3,
                color="#00ff00")
    finalize()
    bake.atlas(base_color=64, padding=2)
    colors = _color()
    blue = (colors[:, 2] > 0.5) & (colors[:, 0] < 0.3)
    green = (colors[:, 1] > 0.5) & (colors[:, 0] < 0.3)
    red = (colors[:, 0] > 0.5) & (colors[:, 1] < 0.3) & (colors[:, 2] < 0.3)
    assert blue.sum() > 10 and green.sum() > 10 and red.sum() > 20
    # Lingkaran (π/4 · d²) lebih kecil dari persegi (d²) dengan ukuran sama.
    assert blue.sum() < green.sum()


def test_paint_validasi():
    box = prim.box((1, 1, 1))
    with pytest.raises(ValueError):
        decal.paint(box, shape="bintang", center=(0, 0, 0), normal=(0, 0, 1), size=0.1, color="#fff")
    with pytest.raises(ValueError):
        decal.paint(box, center=(0, 0, 0), normal=(0, 0, 1), size=0.0, color="#ffffff")

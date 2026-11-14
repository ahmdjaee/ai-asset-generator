import math

import pytest
from mathutils import Matrix

from assetkit import finalize, mod, prim, stats
from helpers import approx_list


def test_origin_di_dasar_tengah():
    prim.box((1, 2, 3), location=(5, -4, 7))
    s = finalize()
    assert approx_list(s["bbox"]["min"], [-0.5, -1.0, 0.0])
    assert approx_list(s["bbox"]["max"], [0.5, 1.0, 3.0])


def test_transform_dibakar_ke_vertex():
    box = prim.box((2, 1, 1))
    box.rotation_euler = (0, 0, math.pi / 2)
    box.scale = (1, 1, 2)
    finalize()
    assert box.matrix_world == Matrix.Identity(4)
    assert approx_list(stats()["bbox"]["size"], [1, 2, 2])


def test_vertex_ganda_digabung():
    half = prim.box((1, 1, 1))
    half.data.transform(Matrix.Translation((0.5, 0, 0)))  # sisi kiri tepat di x = 0
    mod.mirror(half, axis="X", merge=False)
    assert stats()["vertices"] == 16
    assert finalize()["vertices"] == 12


def test_finalize_idempoten():
    box = prim.box((1, 1, 1), location=(1, 1, 1))
    mod.bevel(box, width=0.1)
    first = finalize()
    second = finalize()
    assert first == second


def test_scene_kosong_ditolak():
    with pytest.raises(ValueError):
        finalize()

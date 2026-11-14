import math

import pytest

from assetkit import prim, stats
from helpers import approx_list


def test_box_ukuran_dan_topologi():
    prim.box((0.6, 0.4, 0.35))
    s = stats()
    assert s["objects"] == 1
    assert s["vertices"] == 8
    assert s["triangles"] == 12
    assert approx_list(s["bbox"]["size"], [0.6, 0.4, 0.35])


def test_box_location_menggeser_pusat():
    prim.box((1, 1, 1), location=(2, 0, 0))
    s = stats()
    assert approx_list(s["bbox"]["min"], [1.5, -0.5, -0.5])


def test_cylinder_ukuran_dan_segitiga():
    prim.cylinder(0.25, 1.0, vertices=16)
    s = stats()
    assert approx_list(s["bbox"]["size"], [0.5, 0.5, 1.0], tol=1e-3)
    # 16 sisi (masing-masing 2 segitiga) + 2 tutup 16-gon (masing-masing 14 segitiga)
    assert s["triangles"] == 16 * 2 + 2 * 14


def test_cone_runcing():
    prim.cone(0.5, 0.0, 2.0, vertices=12)
    s = stats()
    assert math.isclose(s["bbox"]["size"][2], 2.0, abs_tol=1e-4)
    assert s["vertices"] == 13


def test_sphere_diameter():
    prim.sphere(0.5)
    s = stats()
    assert approx_list(s["bbox"]["size"], [1.0, 1.0, 1.0], tol=1e-2)


def test_torus_ukuran_dan_vertex():
    prim.torus(0.5, 0.1, major_segments=24, minor_segments=8)
    s = stats()
    assert s["vertices"] == 24 * 8
    assert approx_list(s["bbox"]["size"][:2], [1.2, 1.2], tol=1e-2)
    assert math.isclose(s["bbox"]["size"][2], 0.2, abs_tol=1e-2)


@pytest.mark.parametrize(
    "build",
    [
        lambda: prim.box((0, 1, 1)),
        lambda: prim.cylinder(-1, 1),
        lambda: prim.cone(0.5, -0.1, 1),
        lambda: prim.cone(0.5, 0, 1, vertices=2),
        lambda: prim.sphere(0),
        lambda: prim.torus(0.1, 0.2),
    ],
)
def test_argumen_tidak_valid_ditolak(build):
    with pytest.raises(ValueError):
        build()

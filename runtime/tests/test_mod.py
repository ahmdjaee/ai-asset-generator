import pytest
from mathutils import Matrix

from assetkit import finalize, mod, prim, stats
from helpers import approx_list


def test_bevel_menambah_vertex_tanpa_mengubah_ukuran():
    box = prim.box((1, 1, 1))
    mod.bevel(box, width=0.05, segments=2)
    s = stats()
    assert s["vertices"] > 8
    assert approx_list(s["bbox"]["size"], [1, 1, 1])


def test_boolean_difference_dan_cutter_dihapus_saat_finalize():
    box = prim.box((1, 1, 1), name="badan")
    cutter = prim.box((0.5, 0.5, 2), name="pelubang")
    mod.boolean(box, cutter)
    before = stats()
    assert before["objects"] == 1, "cutter tidak dihitung"
    assert before["triangles"] > 12
    after = finalize()
    assert after["objects"] == 1
    assert approx_list(after["bbox"]["size"], [1, 1, 1])


def test_mirror_menggandakan_ke_sisi_lain():
    half = prim.box((1, 1, 1))
    half.data.transform(Matrix.Translation((0.5, 0, 0)))  # sisi kiri tepat di x = 0
    mod.mirror(half, axis="X")
    s = stats()
    assert approx_list(s["bbox"]["min"][:1], [-1.0])
    assert approx_list(s["bbox"]["max"][:1], [1.0])


def test_array_jarak_tetap():
    box = prim.box((1, 1, 1))
    mod.array(box, count=3, offset=(1.5, 0, 0))
    s = stats()
    assert approx_list(s["bbox"]["size"], [4.0, 1, 1])
    assert s["vertices"] == 24


@pytest.mark.parametrize(
    "apply",
    [
        lambda o: mod.bevel(o, width=0),
        lambda o: mod.mirror(o, axis="W"),
        lambda o: mod.array(o, count=0, offset=(1, 0, 0)),
        lambda o: mod.boolean(o, o, operation="XOR"),
    ],
)
def test_argumen_modifier_tidak_valid_ditolak(apply):
    with pytest.raises(ValueError):
        apply(prim.box())

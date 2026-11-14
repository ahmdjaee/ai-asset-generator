import numpy as np
import pytest

from assetkit import prim, uv


def _uvs(obj, name):
    layer = obj.data.uv_layers[name]
    data = np.empty(len(obj.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", data)
    return data.reshape(-1, 2)


def test_xatlas_atlas_di_0_1_dan_segitiga_tetap():
    box = prim.box((1, 2, 0.5))
    triangles_before = sum(len(p.vertices) - 2 for p in box.data.polygons)
    summary = uv.unwrap(box, method="xatlas", padding=2, resolution=256)
    uvs = _uvs(box, uv.ATLAS_UV)
    assert ((uvs >= 0.0) & (uvs <= 1.0)).all()
    assert len(box.data.polygons) == triangles_before
    assert box.data.uv_layers.active.name == uv.ATLAS_UV
    assert summary["charts"] >= 1 and 0 < summary["utilization"] <= 1


def test_xatlas_tanpa_tumpang_tindih_kasar():
    box = prim.box((1, 1, 1))
    uv.unwrap(box, resolution=256)
    uvs = _uvs(box, uv.ATLAS_UV).reshape(-1, 3, 2)
    a, b = uvs[:, 1] - uvs[:, 0], uvs[:, 2] - uvs[:, 0]
    area = 0.5 * np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]).sum()
    assert 0.2 < area <= 1.0


def test_box_project_memakai_meter_dunia():
    box = prim.box((2, 2, 2), location=(0, 0, 1))
    uv.box_project(box)
    uvs = _uvs(box, "tiling")
    assert uvs.max() - uvs.min() == pytest.approx(2.0)
    top = next(p for p in box.data.polygons if p.normal.z > 0.9)
    for loop_index in top.loop_indices:
        co = box.data.vertices[box.data.loops[loop_index].vertex_index].co
        assert tuple(_uvs(box, "tiling")[loop_index]) == pytest.approx((co.x, co.y))


def test_method_tidak_dikenal_ditolak():
    with pytest.raises(ValueError):
        uv.unwrap(prim.box((1, 1, 1)), method="smart")

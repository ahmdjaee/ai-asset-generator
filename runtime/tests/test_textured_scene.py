import pytest

from assetkit import prim, scene


def test_run_base_menjalankan_skrip_bentuk_dasar(tmp_path):
    base = tmp_path / "base.py"
    base.write_text(
        "from assetkit import prim, scene\nscene.reset()\nprim.box((1, 1, 1), name='badan')\n", encoding="utf-8"
    )
    objects = scene.run_base(str(base))
    assert [o.name for o in objects] == ["badan"]
    assert scene.get("badan").name == "badan"


def test_run_base_tanpa_file():
    with pytest.raises(RuntimeError):
        scene.run_base("/tidak/ada.py")


def test_get_menyebut_nama_yang_ada():
    prim.box((1, 1, 1), name="tutup")
    with pytest.raises(KeyError, match="tutup"):
        scene.get("badan")

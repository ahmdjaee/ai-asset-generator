import json
import os

from assetkit import run
from helpers import read_glb_json


def _script(tmp_path, body: str) -> str:
    path = tmp_path / "script.py"
    path.write_text(body, encoding="utf-8")
    return str(path)


def test_skrip_berhasil_diekspor_dengan_statistik(tmp_path, capsys):
    script = _script(tmp_path, "from assetkit import prim\nprim.box((1, 1, 2), location=(3, 3, 3))\n")
    out = str(tmp_path / "base.glb")
    stats_path = str(tmp_path / "stats.json")
    assert run.main([script, "--export", out, "--stats", stats_path]) == 0
    assert read_glb_json(out)["asset"]["version"] == "2.0"
    with open(stats_path, encoding="utf-8") as handle:
        stats = json.load(handle)
    assert stats["bbox"]["min"][2] == 0.0
    lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("@@aag ")]
    steps = [json.loads(line[6:]) for line in lines]
    assert steps[0] == {"type": "progress", "step": "menjalankan skrip", "pct": 0.0}
    assert {"type": "progress", "step": "selesai", "pct": 100.0} in steps
    if os.path.exists(run.MEMORY_PEAK_PATH):
        assert steps[-1]["type"] == "memory" and steps[-1]["peakBytes"] > 0


def test_blend_disimpan_setelah_ekspor(tmp_path, capsys):
    script = _script(tmp_path, "from assetkit import prim\nprim.box((1, 1, 2), name='badan')\n")
    out = str(tmp_path / "base.glb")
    blend = str(tmp_path / "scene.blend")
    assert run.main([script, "--export", out, "--blend", blend]) == 0
    assert os.path.getsize(out) > 0 and os.path.getsize(blend) > 0
    steps = [json.loads(line[6:]) for line in capsys.readouterr().out.splitlines() if line.startswith("@@aag ")]
    names = [step.get("step") for step in steps if step["type"] == "progress"]
    assert names.index("ekspor GLB") < names.index("simpan .blend") < names.index("selesai")


def test_gagal_simpan_blend_tidak_menggagalkan_build(tmp_path, capsys, monkeypatch):
    import assetkit

    def rusak(path):
        raise RuntimeError("disk penuh")

    monkeypatch.setattr(assetkit, "save_blend", rusak)
    script = _script(tmp_path, "from assetkit import prim\nprim.box()\n")
    out = str(tmp_path / "base.glb")
    blend = str(tmp_path / "scene.blend")
    assert run.main([script, "--export", out, "--blend", blend]) == 0
    assert os.path.getsize(out) > 0 and not os.path.exists(blend)
    assert "RuntimeError: disk penuh" in capsys.readouterr().err


def test_skrip_gagal_kode_1_dan_traceback(tmp_path, capsys):
    script = _script(tmp_path, "raise RuntimeError('rusak')\n")
    assert run.main([script]) == 1
    assert "RuntimeError: rusak" in capsys.readouterr().err


def test_sys_exit_di_skrip_diteruskan(tmp_path):
    script = _script(tmp_path, "import sys\nsys.exit(3)\n")
    assert run.main([script]) == 3


def test_textured_bake_atlas_dan_ekspor_material(tmp_path):
    script = _script(
        tmp_path,
        "from assetkit import material, prim\n"
        "b = prim.box((1, 1, 1))\n"
        "material.assign(b, material.pbr('cat', color='#336699'))\n",
    )
    out = str(tmp_path / "final.glb")
    stats_path = str(tmp_path / "stats.json")
    args = [script, "--textured", "--base-color", "32", "--normal", "32", "--orm", "32", "--library-res", "1k"]
    assert run.main([*args, "--export", out, "--stats", stats_path]) == 0
    with open(stats_path, encoding="utf-8") as handle:
        stats = json.load(handle)
    assert stats["materials"] == 1 and stats["bake"]["baseColor"] == 32
    gltf = read_glb_json(out)
    assert len(gltf["materials"]) == 1 and len(gltf["textures"]) >= 2
    assert os.environ["AAG_TEXTURE_RES"] == "1k"

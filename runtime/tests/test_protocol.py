import json

from assetkit import protocol


def test_baris_progres(capsys):
    protocol.progress("membangun badan", 42.345)
    line = capsys.readouterr().out
    assert line.startswith("@@aag ") and line.endswith("\n")
    assert json.loads(line[len("@@aag "):]) == {"type": "progress", "step": "membangun badan", "pct": 42.3}


def test_pct_dibatasi_dan_step_dipotong(capsys):
    protocol.progress("x" * 300, 250)
    event = json.loads(capsys.readouterr().out[len("@@aag "):])
    assert event["pct"] == 100
    assert len(event["step"]) == 200

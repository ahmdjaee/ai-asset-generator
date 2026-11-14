"""Pembantu tes: membaca bagian JSON dari file GLB."""
import json
import struct


def read_glb_json(path: str) -> dict:
    with open(path, "rb") as handle:
        magic, version, _length = struct.unpack("<4sII", handle.read(12))
        assert magic == b"glTF" and version == 2
        chunk_length, chunk_type = struct.unpack("<I4s", handle.read(8))
        assert chunk_type == b"JSON"
        return json.loads(handle.read(chunk_length))


def approx_list(values, expected, tol=1e-4):
    return all(abs(a - b) <= tol for a, b in zip(values, expected, strict=True))

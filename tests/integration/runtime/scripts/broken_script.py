"""Skrip aset yang gagal: traceback harus sampai ke hasil build."""
from assetkit import prim, scene

scene.reset()
prim.box((1, 1, 1))
raise ValueError("ukuran kaki tidak valid")

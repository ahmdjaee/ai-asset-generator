"""Scene kosong dengan konvensi assetkit."""
import os

import bpy


def threads() -> int:
    """Jumlah thread CPU dari env runner (`AAG_THREADS`), minimal 1."""
    try:
        return max(1, int(os.environ.get("AAG_THREADS", "1")))
    except ValueError:
        return 1


def reset() -> bpy.types.Scene:
    """Mengosongkan file (tanpa kamera, lampu, atau kubus bawaan), satuan meter, thread dari env."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.threads_mode = "FIXED"
    scene.render.threads = threads()
    return scene


def mesh_objects() -> list[bpy.types.Object]:
    """Semua objek mesh di scene aktif, urut nama supaya hasil deterministik."""
    return sorted((o for o in bpy.context.scene.objects if o.type == "MESH"), key=lambda o: o.name)


#: Salinan skrip bentuk dasar yang disetujui, disiapkan harness di folder job bertekstur.
BASE_SCRIPT = "/job/base.py"


def run_base(path: str = BASE_SCRIPT) -> list[bpy.types.Object]:
    """Menjalankan skrip bentuk dasar yang disetujui (geometri sama persis). Hasil: objek mesh di scene."""
    import runpy

    if not os.path.isfile(path):
        raise RuntimeError("skrip bentuk dasar tidak tersedia (run_base hanya untuk build bertekstur)")
    runpy.run_path(path, run_name="__main__")
    return mesh_objects()


def get(name: str) -> bpy.types.Object:
    """Objek mesh bernama `name`. Bila tidak ada, pesan error menyebut nama yang tersedia."""
    obj = bpy.context.scene.objects.get(name)
    if obj is None or obj.type != "MESH":
        names = ", ".join(o.name for o in mesh_objects()) or "(kosong)"
        raise KeyError(f"objek {name!r} tidak ada; yang tersedia: {names}")
    return obj

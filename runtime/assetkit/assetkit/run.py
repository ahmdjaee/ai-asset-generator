"""Wrapper job: `python -m assetkit.run SKRIP [--export OUT.glb] [--stats OUT.json] [--blend OUT.blend] [--textured ...]`.

1. Menjalankan skrip aset.
2. Bila diminta (tugas harness): `finalize()`, ekspor GLB, tulis statistik, lalu simpan `.blend` (preset Sumber).
   Dengan `--textured --base-color N [--normal N] [--orm N]`: setelah finalize, semua material di-bake ke satu
   atlas (`bake.atlas`) lalu GLB diekspor dengan material dan UV.
3. Selalu mencetak `memory.peak` cgroup sebagai event protokol di akhir.

Kode keluar: 0 berhasil, 1 skrip/ekspor gagal (traceback di stderr), 2 argumen salah.
"""
import argparse
import json
import os
import runpy
import sys
import traceback

from assetkit import protocol

MEMORY_PEAK_PATH = "/sys/fs/cgroup/memory.peak"


def _memory_peak() -> int | None:
    try:
        with open(MEMORY_PEAK_PATH, encoding="ascii") as handle:
            return int(handle.read().strip())
    except (OSError, ValueError):
        return None


def _write_json(path: str, data: dict) -> None:
    temp = f"{path}.tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    os.replace(temp, path)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="assetkit.run")
    parser.add_argument("script")
    parser.add_argument("--export", dest="export_path")
    parser.add_argument("--stats", dest="stats_path")
    parser.add_argument("--blend", dest="blend_path")
    parser.add_argument("--textured", action="store_true")
    parser.add_argument("--base-color", type=int, default=1024)
    parser.add_argument("--normal", type=int)
    parser.add_argument("--orm", type=int)
    parser.add_argument("--library-res", choices=("1k", "2k"))
    args = parser.parse_args(argv)
    if args.library_res:
        # Dibaca `material.from_library`; ditentukan harness per tier, bukan oleh skrip.
        os.environ["AAG_TEXTURE_RES"] = args.library_res

    try:
        protocol.progress("menjalankan skrip", 0)
        runpy.run_path(args.script, run_name="__main__")
        if args.export_path or args.stats_path or args.blend_path:
            from assetkit import export_glb, finalize, save_blend

            protocol.progress("finalisasi mesh", 80 if not args.textured else 10)
            result = finalize()
            if args.textured:
                from assetkit import bake, stats

                summary = bake.atlas(base_color=args.base_color, normal=args.normal, orm=args.orm)
                result = {**stats(), "bake": summary}
            if args.export_path:
                protocol.progress("ekspor GLB", 90)
                export_glb(args.export_path, materials=args.textured)
            if args.stats_path:
                _write_json(args.stats_path, result)
            if args.blend_path:
                # Terakhir: membuang data yatim, jadi tidak boleh mendahului ekspor dan statistik.
                protocol.progress("simpan .blend", 95)
                try:
                    save_blend(args.blend_path)
                except Exception:
                    # `.blend` hanya pelengkap preset Sumber: gagal menyimpannya tidak menggagalkan build.
                    traceback.print_exc(file=sys.stderr)
        protocol.progress("selesai", 100)
        return 0
    except SystemExit as stop:
        code = stop.code if isinstance(stop.code, int) else 1
        return code
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return 1
    finally:
        peak = _memory_peak()
        if peak is not None:
            protocol.emit("memory", peakBytes=peak)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

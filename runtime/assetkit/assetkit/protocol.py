"""Protokol stdout ke runner: satu baris `@@aag {json}` per event (dibaca `server/runtime/docker.ts`)."""
import json
import sys

PREFIX = "@@aag "


def emit(event_type: str, **data: object) -> None:
    """Mencetak satu event protokol. Selalu satu baris dan langsung di-flush."""
    line = json.dumps({"type": event_type, **data}, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(f"{PREFIX}{line}\n")
    sys.stdout.flush()


def progress(step: str, pct: float) -> None:
    """Progres job untuk UI. `pct` dibatasi ke 0..100."""
    emit("progress", step=step[:200], pct=round(max(0.0, min(100.0, float(pct))), 1))

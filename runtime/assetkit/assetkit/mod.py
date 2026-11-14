"""Modifier non-destruktif. Semuanya diterapkan oleh `finalize()` lewat depsgraph (tanpa operator UI)."""
import bpy

AXES = ("X", "Y", "Z")


def bevel(obj: bpy.types.Object, *, width: float = 0.01, segments: int = 2, angle_deg: float = 30.0) -> bpy.types.Modifier:
    """Membulatkan tepi yang sudutnya lebih tajam dari `angle_deg`."""
    if width <= 0:
        raise ValueError("width harus > 0")
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width
    m.segments = max(1, segments)
    m.limit_method = "ANGLE"
    m.angle_limit = angle_deg * 3.141592653589793 / 180.0
    m.harden_normals = False
    return m


def boolean(obj: bpy.types.Object, cutter: bpy.types.Object, *, operation: str = "DIFFERENCE", hide_cutter: bool = True) -> bpy.types.Modifier:
    """Boolean EXACT. `operation`: DIFFERENCE, UNION, atau INTERSECT. Cutter disembunyikan dan tidak ikut diekspor."""
    if operation not in ("DIFFERENCE", "UNION", "INTERSECT"):
        raise ValueError(f"operation tidak dikenal: {operation}")
    m = obj.modifiers.new(f"boolean_{cutter.name}", "BOOLEAN")
    m.object = cutter
    m.operation = operation
    m.solver = "EXACT"
    if hide_cutter:
        cutter["assetkit_cutter"] = True
        cutter.hide_render = True
        cutter.hide_set(True)
    return m


def mirror(obj: bpy.types.Object, *, axis: str = "X", merge: bool = True) -> bpy.types.Modifier:
    """Mencerminkan mesh terhadap origin objek pada sumbu `axis`."""
    if axis not in AXES:
        raise ValueError(f"axis harus salah satu dari {AXES}")
    m = obj.modifiers.new(f"mirror_{axis.lower()}", "MIRROR")
    m.use_axis = [a == axis for a in AXES]
    m.use_mirror_merge = merge
    m.use_clip = merge
    return m


def array(obj: bpy.types.Object, *, count: int, offset: tuple[float, float, float]) -> bpy.types.Modifier:
    """`count` salinan dengan jarak tetap `offset` (meter)."""
    if count < 1:
        raise ValueError("count minimal 1")
    m = obj.modifiers.new("array", "ARRAY")
    m.count = count
    m.use_relative_offset = False
    m.use_constant_offset = True
    m.constant_offset_displace = offset
    return m

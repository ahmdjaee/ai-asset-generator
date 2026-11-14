"""Pembantu tes tekstur: pustaka material palsu dan pembacaan piksel."""
import os

import bpy
import numpy as np


def save_image(path: str, size: int, rgba, *, file_format: str = "JPEG") -> str:
    image = bpy.data.images.new(os.path.basename(path), width=size, height=size, alpha=file_format == "PNG")
    pixels = np.tile(np.array(rgba, dtype=np.float32), size * size)
    image.pixels.foreach_set(pixels)
    image.filepath_raw = path
    image.file_format = file_format
    image.save()
    bpy.data.images.remove(image)
    return path


def fake_library(root, material_id: str = "Wood001", *, metal: bool = False) -> str:
    folder = root / material_id / "1k"
    folder.mkdir(parents=True)
    save_image(str(folder / "color.jpg"), 16, (0.6, 0.4, 0.2, 1.0))
    save_image(str(folder / "normal.jpg"), 16, (0.5, 0.5, 1.0, 1.0))
    save_image(str(folder / "roughness.jpg"), 16, (0.7, 0.7, 0.7, 1.0))
    if metal:
        save_image(str(folder / "metalness.jpg"), 16, (1.0, 1.0, 1.0, 1.0))
    return str(root)


def pixels(image: bpy.types.Image) -> np.ndarray:
    data = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(-1, 4)


def covered(image: bpy.types.Image) -> np.ndarray:
    """Piksel yang benar-benar terisi bake (bukan latar hitam)."""
    data = pixels(image)
    return data[data[:, :3].sum(axis=1) > 0.02]

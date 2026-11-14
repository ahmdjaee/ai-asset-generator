"""Setiap tes mulai dari scene kosong."""
import pytest

from assetkit import scene


@pytest.fixture(autouse=True)
def clean_scene():
    scene.reset()
    yield

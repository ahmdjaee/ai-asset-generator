# syntax=docker/dockerfile:1
# Image `asset-forge`: Blender 5.2.4 LTS sebagai modul Python (bpy) + xatlas.
# Dibangun lewat `bun run runtime:build`; tag-nya hash isi Dockerfile + requirements.txt.
# `assetkit` TIDAK dipanggang ke image: runner memasangnya read-only di /opt/assetkit.
FROM python:3.13-slim@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90

# Library sistem yang di-link langsung oleh bpy/__init__.so (hasil `ldd` saat spike Tahap 1). X11/GL tetap
# dibutuhkan walau tanpa layar. libegl1, libgomp1, dan libxxf86vm1 terbukti tidak perlu (probe lolos tanpa itu).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgl1 libsm6 libx11-6 libxfixes3 libxi6 libxkbcommon0 libxrender1 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-compile -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

# User non-root. Runner tetap memakai --user <uid:gid> pemilik folder job.
RUN useradd --uid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin forge
ENV HOME=/tmp \
    PYTHONPATH=/opt/assetkit \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
USER 10001:10001
WORKDIR /job

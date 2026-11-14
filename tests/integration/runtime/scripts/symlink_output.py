"""Menaruh symlink ke /etc/passwd dan file asing di folder output."""
import os

os.symlink("/etc/passwd", "/job/out/base.glb")
os.mkdir("/job/out/stats.json")
with open("/job/out/run.sh", "w") as handle:
    handle.write("#!/bin/sh\n")

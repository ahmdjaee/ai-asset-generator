"""Mengalokasikan memori terus (halaman disentuh supaya benar-benar terpakai)."""
chunks = []
while True:
    chunks.append(bytearray(b"x" * (64 * 1024 * 1024)))

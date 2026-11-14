"""Mencoba akses jaringan. Mencetak SANDBOX_OK bila semua percobaan gagal."""
import socket

attempts = []
for host, port in [("1.1.1.1", 53), ("8.8.8.8", 443), ("host.docker.internal", 4340), ("172.17.0.1", 4340)]:
    try:
        socket.create_connection((host, port), timeout=2).close()
        attempts.append(f"TERHUBUNG {host}:{port}")
    except OSError:
        pass
try:
    socket.getaddrinfo("example.com", 80)
    attempts.append("DNS berhasil")
except OSError:
    pass
interfaces = [name for _, name in socket.if_nameindex() if name != "lo"]
if interfaces:
    attempts.append(f"antarmuka selain lo: {interfaces}")
print("SANDBOX_GAGAL " + "; ".join(attempts) if attempts else "SANDBOX_OK")

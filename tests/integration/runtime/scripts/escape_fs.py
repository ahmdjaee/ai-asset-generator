"""Mencoba menulis di luar /job dan /tmp, serta memeriksa user, capability, dan no_new_privs."""
import os

escaped = []
for path in ["/etc/aag", "/opt/assetkit/aag", "/usr/local/aag", "/aag", "/root/aag", "/refs/aag"]:
    try:
        with open(path, "w") as handle:
            handle.write("x")
        escaped.append(path)
    except OSError:
        pass
with open("/tmp/boleh", "w") as handle:
    handle.write("ok")
with open("/job/boleh", "w") as handle:
    handle.write("ok")

status = dict(line.split(":", 1) for line in open("/proc/self/status").read().splitlines() if ":" in line)
if os.getuid() == 0:
    escaped.append("uid 0")
if int(status["CapEff"].strip(), 16) != 0:
    escaped.append(f"CapEff {status['CapEff'].strip()}")
if status["NoNewPrivs"].strip() != "1":
    escaped.append("NoNewPrivs mati")
print("SANDBOX_GAGAL " + ", ".join(escaped) if escaped else f"SANDBOX_OK uid={os.getuid()}")

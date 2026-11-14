"""Fork terus sampai dibatasi pids-limit, lalu membersihkan anak-anaknya."""
import os
import signal
import time

children = []
limited = False
while len(children) < 5000:
    try:
        pid = os.fork()
    except OSError:
        limited = True
        break
    if pid == 0:
        time.sleep(60)
        os._exit(0)
    children.append(pid)
for pid in children:
    os.kill(pid, signal.SIGKILL)
for pid in children:
    os.waitpid(pid, 0)
print(f"FORK limited={limited} children={len(children)}")

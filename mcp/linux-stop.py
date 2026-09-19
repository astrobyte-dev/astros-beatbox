"""Linux owned-tree shutdown. No PID-only signals; every signal uses a pidfd.

Called with the creation identity of a live child/session leader spawned by Node.
No adoption after owner death. /proc inventory alone never grants ownership.
Requires Python 3.9+ and Linux pidfd support. No third-party Python dependencies.
"""
import json
import os
import select
import signal
import sys
import time


def stat(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            text = f.read()
        fields = text[text.rindex(")") + 2:].split()
        return dict(pid=pid, parent=int(fields[1]), group=int(fields[2]),
                    session=int(fields[3]), started=fields[19], state=fields[0])
    except (FileNotFoundError, ProcessLookupError):
        return None


def inventory():
    return [p for name in os.listdir("/proc") if name.isdigit() and (p := stat(int(name)))]


def stop(identity, grace, timeout):
    pid, started = identity["pid"], identity["started"]
    if not isinstance(pid, int) or pid <= 1 or not isinstance(started, str) or not started.isdigit():
        raise RuntimeError("Invalid owned identity")
    root = stat(pid)
    if root is None or root["started"] != started:
        if any(p["session"] == pid for p in inventory()):
            raise RuntimeError("Root identity unavailable/changed; descendants left untouched")
        return
    if root["group"] != pid or root["session"] != pid:
        raise RuntimeError("Owned root must be a dedicated session/group leader")
    handles, records, sent, inodes = {}, {}, {}, set()

    def exited(fd):
        return bool(select.select([fd], [], [], 0)[0])

    def capture(p):
        key = (p["pid"], p["started"])
        if key in handles:
            return
        try:
            fd = os.pidfd_open(p["pid"])
        except ProcessLookupError:
            return
        current = stat(p["pid"])
        if current is None or any(current[k] != p[k] for k in ("started", "parent", "session", "group")):
            os.close(fd)
            return
        handles[key], records[key] = fd, current
        if exited(fd):
            return
        try:
            for name in os.listdir(f'/proc/{p["pid"]}/fd'):
                try:
                    link = os.readlink(f'/proc/{p["pid"]}/fd/{name}')
                    if link.startswith("socket:["):
                        inodes.add(link[8:-1])
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
        except PermissionError:
            if not exited(fd):
                raise RuntimeError("Owned descriptor inspection denied; port release cannot be verified")

    def discover():
        rows = inventory()
        # A live captured pidfd anchors the session. Never infer an orphan's
        # ownership from a recycled numeric group/session ID alone.
        anchors = [r for key, r in records.items() if not exited(handles[key])]
        changed = True
        while changed:
            changed = False
            for p in rows:
                if (p["pid"], p["started"]) in handles:
                    continue
                parent = next((a for a in anchors if a["pid"] == p["parent"] and int(p["started"]) >= int(a["started"])), None)
                session = any(a["session"] == pid for a in anchors) and p["session"] == pid and int(p["started"]) >= int(started)
                if parent or session:
                    before = len(handles)
                    capture(p)
                    if len(handles) != before:
                        anchors.append(p)
                        changed = True
        return rows

    try:
        capture(root)
        if (pid, started) not in handles:
            raise RuntimeError("Root exited during identity acquisition; cleanup unconfirmed")
        begin = time.monotonic()
        while True:
            rows = discover()
            alive = [(key, fd) for key, fd in handles.items() if not exited(fd)]
            if not alive:
                leftovers = [p for p in rows if p["session"] == pid and p["state"] not in ("Z", "X")]
                if leftovers:
                    raise RuntimeError("Unverified session descendants remain; left untouched")
                # Verify captured listening/bound sockets have disappeared.
                for name in ("tcp", "tcp6", "udp", "udp6"):
                    try:
                        with open("/proc/net/" + name) as f:
                            sockets = f.readlines()[1:]
                    except FileNotFoundError:
                        continue
                    if any(len(s.split()) > 9 and s.split()[9] in inodes for s in sockets):
                        raise RuntimeError("Owned socket remains open; shutdown unconfirmed")
                return
            elapsed = time.monotonic() - begin
            if elapsed >= timeout:
                raise RuntimeError("Owned lifecycle timeout: " + ", ".join(str(key[0]) for key, _ in alive))
            sig = signal.SIGKILL if elapsed >= grace else signal.SIGTERM
            # Descendants first; root last. Signals target held identities even
            # if an exit/PID reuse occurs after this snapshot.
            for key, fd in sorted(alive, key=lambda item: item[0][0] == pid):
                if sent.get(key) != sig:
                    try:
                        signal.pidfd_send_signal(fd, sig)
                        sent[key] = sig
                    except ProcessLookupError:
                        pass
            time.sleep(0.025)
    finally:
        for fd in handles.values():
            os.close(fd)


if __name__ == "__main__":
    try:
        if sys.argv[1] == "--check":
            fd = os.pidfd_open(os.getpid())
            signal.pidfd_send_signal(fd, 0)
            os.close(fd)
        else:
            stop(json.loads(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

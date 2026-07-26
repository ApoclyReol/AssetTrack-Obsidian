"""Executable Python sidecar entry point used by the Obsidian plugin."""

from __future__ import annotations

import json
import multiprocessing
import os
import socket
import sys
import threading
import time

import uvicorn
from loguru import logger

from assettrack.api.app import PROTOCOL_VERSION, create_app


# stdout is a private machine-readable handshake channel.  Keep all Python
# diagnostics on stderr so the plugin never has to guess whether a line is JSON.
logger.remove()
logger.add(sys.stderr, enqueue=False, backtrace=False, diagnose=False)


def _parent_is_alive(parent_pid: int) -> bool:
    if parent_pid <= 1:
        return True
    try:
        os.kill(parent_pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def main() -> None:
    parent_pid = int(os.getenv("ASSET_TRACK_PARENT_PID", "0") or 0)
    ready = threading.Event()
    port_holder: dict[str, int] = {}

    def on_ready() -> None:
        payload = {
            "event": "ready",
            "protocol_version": PROTOCOL_VERSION,
            "port": port_holder["port"],
            "pid": os.getpid(),
        }
        print(json.dumps(payload, ensure_ascii=False), flush=True)
        ready.set()

    app = create_app(
        bootstrap_token=os.getenv("ASSET_TRACK_BOOTSTRAP_TOKEN", ""),
        require_bootstrap=True,
        ready_callback=on_ready,
    )
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    sock.setblocking(False)
    port_holder["port"] = int(sock.getsockname()[1])

    def monitor_parent() -> None:
        if parent_pid <= 1:
            return
        while not app.state.ready or not getattr(app.state, "server", None):
            time.sleep(0.2)
        while not app.state.server.should_exit:
            if not _parent_is_alive(parent_pid):
                app.state.server.should_exit = True
                return
            time.sleep(1.0)

    config = uvicorn.Config(
        app,
        log_config=None,
        access_log=False,
        use_colors=False,
        server_header=False,
    )
    server = uvicorn.Server(config)
    app.state.server = server
    threading.Thread(target=monitor_parent, name="asset-track-parent-monitor", daemon=True).start()
    try:
        server.run(sockets=[sock])
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()


if __name__ == "__main__":
    # PyInstaller reuses the frozen executable for multiprocessing's resource
    # tracker on macOS.  Without this guard, the tracker interprets its
    # internal ``-c`` command as a fresh sidecar and recursively spawns.
    multiprocessing.freeze_support()
    main()

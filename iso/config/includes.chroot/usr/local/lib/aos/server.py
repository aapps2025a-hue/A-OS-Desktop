#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


ROOT = Path("/opt/a-os/public")
READY_FILE = Path("/tmp/aos-browser-ready")
os.chdir(ROOT)


class AosHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/__aos_browser_ready":
            self.send_error(404)
            return

        length = min(int(self.headers.get("Content-Length", "0") or 0), 4096)
        message = self.rfile.read(length).decode("utf-8", errors="replace")
        READY_FILE.write_text(message or "A-OS HTML mounted", encoding="utf-8")
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", 5000), AosHandler).serve_forever()

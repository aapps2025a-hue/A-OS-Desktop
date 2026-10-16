#!/usr/bin/env python3

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


ROOT = Path("/opt/a-os/public")
os.chdir(ROOT)


class AosHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", 5000), AosHandler).serve_forever()

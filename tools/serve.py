"""Local dev server for Zarhart with caching disabled (so edited ES modules always reload).

Dev-only extra: POST /__shot?name=<file>.jpg with a JPEG body saves it to assets/img/shots/
(used to capture product shots from the simulator).
"""
import functools
import http.server
import os
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "assets" / "img" / "shots"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/__shot":
            self.send_error(404)
            return
        name = urllib.parse.parse_qs(url.query).get("name", [""])[0]
        if not re.fullmatch(r"[a-z0-9-]{1,40}\.jpg", name):
            self.send_error(400, "name must look like hero-1.jpg")
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 8_000_000:
            self.send_error(400, "bad size")
            return
        data = self.rfile.read(length)
        if not data.startswith(b"\xff\xd8"):
            self.send_error(400, "not a JPEG")
            return
        SHOTS.mkdir(parents=True, exist_ok=True)
        (SHOTS / name).write_bytes(data)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f"saved {name} ({len(data)} bytes)".encode())

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8765))
    handler = functools.partial(NoCache, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Zarhart on http://localhost:{port}", flush=True)
        httpd.serve_forever()

"""Serve the standalone static map on a free local port."""

from __future__ import annotations

import argparse
import functools
import http.server
import webbrowser
from pathlib import Path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true")
    arguments = parser.parse_args()
    site = Path(__file__).resolve().parent / "site"
    if not (site / "data" / "precincts_2024.geojson").exists():
        parser.error("Map data missing. Run python build_map_data.py first.")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(site))
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        url = f"http://127.0.0.1:{server.server_port}/"
        print(f"Map available at {url}", flush=True)
        if not arguments.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
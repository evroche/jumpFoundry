#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import webbrowser


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a font session and open the local app.")
    parser.add_argument("--backend-base-url", default="http://127.0.0.1:8200")
    parser.add_argument("--frontend-base-url", default="http://127.0.0.1:5174")
    parser.add_argument("--no-open", action="store_true", help="Print the session URL without opening a browser.")
    return parser.parse_args()


def create_session(backend_base_url: str, frontend_base_url: str) -> dict:
    request = urllib.request.Request(
        f"{backend_base_url.rstrip('/')}/api/v1/sessions",
        data=json.dumps({"frontend_base_url": frontend_base_url}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    args = parse_args()
    try:
        payload = create_session(args.backend_base_url, args.frontend_base_url)
    except urllib.error.URLError as exc:
        print(f"Failed to create font session: {exc}", file=sys.stderr)
        return 1

    session_url = payload["frontend_url"]
    print(f"Session ID: {payload['session_id']}")
    print(f"Open: {session_url}")
    print(
        f"I've opened up JumpFoundry in your browser:\n{session_url}\n\n"
        'Start by drawing two sample letters. I\'ll use them to build the rest of your font.\n\n'
        'Go ahead and draw the first letter "E". Let me know when you\'re done.'
    )

    if not args.no_open:
        webbrowser.open(session_url)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

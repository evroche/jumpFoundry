from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .service.models import ImageSearchRequest
from .service.search import search_images as run_search


def search_images(args: dict, **kwargs) -> str:
    try:
        req = ImageSearchRequest(
            query=args.get("query", "").strip(),
            max_results=args.get("max_results", 20),
            sites=args.get("sites", []),
            site_mode=args.get("site_mode", "prefer"),
        )
        result = run_search(req)
        return json.dumps(result.model_dump())
    except Exception as exc:
        return json.dumps({"error": str(exc)})


def start_fontsketch_session(args: dict, **kwargs) -> str:
    frontend_base_url = args.get("frontend_base_url", "http://127.0.0.1:5174").strip() or "http://127.0.0.1:5174"
    backend_base_url = args.get("backend_base_url", "http://127.0.0.1:8200").strip() or "http://127.0.0.1:8200"
    open_browser = bool(args.get("open_browser", True))

    script_path = (
        Path.home()
        / "PycharmProjects"
        / "fontbuilder"
        / "fontbuilder-service"
        / "scripts"
        / "start_font_session.py"
    )
    if not script_path.exists():
        return json.dumps({"error": f"Fontsketch launcher not found at {script_path}"})

    command = [
        sys.executable,
        str(script_path),
        "--frontend-base-url",
        frontend_base_url,
        "--backend-base-url",
        backend_base_url,
    ]
    if not open_browser:
        command.append("--no-open")

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        return json.dumps({"error": detail})

    session_id = ""
    frontend_url = ""
    message = ""
    for line in completed.stdout.splitlines():
        if line.startswith("Session ID: "):
            session_id = line.removeprefix("Session ID: ").strip()
        elif line.startswith("Open: "):
            frontend_url = line.removeprefix("Open: ").strip()
        elif line.strip():
            message = line.strip()

    return json.dumps(
        {
            "session_id": session_id,
            "frontend_url": frontend_url,
            "message": message or "Start by drawing one letter. We'll use this to generate the rest of the typeface.",
        }
    )

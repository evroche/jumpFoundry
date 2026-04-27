from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
import urllib.error
import urllib.request

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
            "message": message or 'We\'ll draw two letters and use this to generate the rest of the typeface.\n\nStart by drawing the letter "E".',
        }
    )


def get_fontsketch_session_status(args: dict, **kwargs) -> str:
    requested_session_id = (args.get("session_id") or "").strip()
    sessions_dir = (
        Path.home()
        / "PycharmProjects"
        / "fontbuilder"
        / "fontbuilder-service"
        / "runs"
        / "sessions"
    )
    if not sessions_dir.exists():
        return json.dumps({"error": f"Fontsketch sessions directory not found at {sessions_dir}"})

    session_path: Path | None = None
    if requested_session_id:
        candidate = sessions_dir / f"{requested_session_id}.json"
        if candidate.exists():
            session_path = candidate
        else:
            return json.dumps({"error": f"Fontsketch session {requested_session_id} was not found."})
    else:
        session_files = list(sessions_dir.glob("*.json"))
        if not session_files:
            return json.dumps({"error": "No local Fontsketch sessions were found."})
        session_path = max(session_files, key=lambda path: path.stat().st_mtime)

    payload = json.loads(session_path.read_text(encoding="utf-8"))
    return json.dumps(
        {
            "session_id": payload.get("session_id", session_path.stem),
            "stage": payload.get("stage", "draw"),
            "status": payload.get("status", "ready"),
            "instruction": payload.get("instruction", ""),
            "source_character": payload.get("source_character", ""),
            "target_character": payload.get("target_character", ""),
            "updated_at": datetime.fromtimestamp(session_path.stat().st_mtime).isoformat(),
        }
    )


def submit_fontsketch_revision(args: dict, **kwargs) -> str:
    correction = (args.get("correction") or "").strip()
    if not correction:
        return json.dumps({"error": "A non-empty correction is required."})

    session_payload = json.loads(get_fontsketch_session_status({"session_id": args.get("session_id", "")}))
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    backend_base_url = "http://127.0.0.1:8200"
    request = urllib.request.Request(
        f"{backend_base_url}/api/v1/sessions/{session_id}",
        data=json.dumps(
            {
                "status": "regenerate_requested",
                "correction": correction,
                "instruction": "Applying your requested changes now. Wait for the regenerated glyph to appear.",
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            updated_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to update Fontsketch session: {exc}"})

    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_payload.get("status", "regenerate_requested"),
            "instruction": updated_payload.get("instruction", ""),
            "correction": correction,
        }
    )

from __future__ import annotations

import base64
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
import time
import urllib.error
import urllib.request

from .service.models import ImageSearchRequest
from .service.search import search_images as run_search


BACKEND_BASE_URL = "http://127.0.0.1:8200"
EXTRA_GLYPHS = ["\\", ".", "\""]
SUPPORTED_GLYPHS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") | set(EXTRA_GLYPHS)


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


def _sessions_dir() -> Path:
    return (
        Path.home()
        / "PycharmProjects"
        / "fontbuilder"
        / "fontbuilder-service"
        / "runs"
        / "sessions"
    )


def _read_full_session(requested_session_id: str = "") -> dict:
    sessions_dir = _sessions_dir()
    if not sessions_dir.exists():
        return {"error": f"Fontsketch sessions directory not found at {sessions_dir}"}

    session_path: Path | None = None
    if requested_session_id:
        candidate = sessions_dir / f"{requested_session_id}.json"
        if candidate.exists():
            session_path = candidate
        else:
            return {"error": f"Fontsketch session {requested_session_id} was not found."}
    else:
        session_files = list(sessions_dir.glob("*.json"))
        if not session_files:
            return {"error": "No local Fontsketch sessions were found."}
        session_path = max(session_files, key=lambda path: path.stat().st_mtime)

    payload = json.loads(session_path.read_text(encoding="utf-8"))
    payload["_updated_at"] = datetime.fromtimestamp(session_path.stat().st_mtime).isoformat()
    return payload


def _json_request(url: str, *, method: str = "GET", payload: dict | None = None, timeout: float = 30.0) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={"Content-Type": "application/json"} if payload is not None else {},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def _binary_request(url: str, *, payload: dict, timeout: float = 60.0) -> bytes:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _patch_session(session_id: str, payload: dict) -> dict:
    return _json_request(
        f"{BACKEND_BASE_URL}/api/v1/sessions/{session_id}",
        method="PATCH",
        payload=payload,
        timeout=10.0,
    )


def _load_run(run_id: str) -> dict:
    return _json_request(f"{BACKEND_BASE_URL}/api/v1/runs/{run_id}", timeout=30.0)


def _normalize_letter(value: str, fallback: str = "A") -> str:
    normalized = (value[:1] or fallback).upper()
    return normalized if normalized in SUPPORTED_GLYPHS else fallback


def _next_alphabet_character(character: str) -> str:
    normalized = _normalize_letter(character, "A")
    if normalized == "Z":
        return "A"
    return chr(ord(normalized) + 1)


def _data_url_to_bytes(data_url: str) -> bytes:
    if "," not in data_url:
        return b""
    header, payload = data_url.split(",", 1)
    if ";base64" in header:
        return base64.b64decode(payload)
    return payload.encode("utf-8")


def _session_export_glyphs(session_payload: dict) -> list[dict[str, str]]:
    glyph_map: dict[str, dict[str, str]] = {}
    for glyph in session_payload.get("export_glyph_overrides", []) or []:
        character = _normalize_letter(glyph.get("character", "A"))
        image_data_url = glyph.get("image_data_url", "")
        if image_data_url:
            glyph_map[character] = {"character": character, "image_data_url": image_data_url}

    for seed in session_payload.get("seed_references", []) or []:
        character = _normalize_letter(seed.get("character", "A"))
        image_data_url = seed.get("image_data_url", "")
        if image_data_url and character not in glyph_map:
            glyph_map[character] = {"character": character, "image_data_url": image_data_url}

    latest_run_id = (session_payload.get("latest_run_id") or "").strip()
    if latest_run_id:
        run = _load_run(latest_run_id)
        image_data_url = run.get("generated_image_data_url", "")
        run_character = _normalize_letter(run.get("target_character", "A"))
        if image_data_url and run_character not in glyph_map:
            glyph_map[run_character] = {
                "character": run_character,
                "image_data_url": image_data_url,
            }

    for run_id in session_payload.get("batch_run_ids", []) or []:
        run = _load_run(run_id)
        image_data_url = run.get("generated_image_data_url", "")
        run_character = _normalize_letter(run.get("target_character", "A"))
        if image_data_url and run_character not in glyph_map:
            glyph_map[run_character] = {
                "character": run_character,
                "image_data_url": image_data_url,
            }

    return [glyph_map[key] for key in sorted(glyph_map.keys())]


def _multipart_generate_request(
    *,
    session_id: str,
    primary_seed: dict,
    secondary_seed: dict | None,
    source_character: str,
    target_character: str,
    correction: str,
    previous_run_id: str,
    brush_size: int = 16,
) -> dict:
    boundary = "----FontsketchGlyphGeneration"
    body_parts: list[bytes] = []

    def add_field(name: str, value: str) -> None:
        body_parts.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
            value.encode("utf-8"),
            b"\r\n",
        ])

    def add_file(name: str, filename: str, content_type: str, content: bytes) -> None:
        body_parts.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            content,
            b"\r\n",
        ])

    add_file("reference_glyph", "reference_glyph.png", "image/png", _data_url_to_bytes(primary_seed.get("image_data_url", "")))
    if secondary_seed and secondary_seed.get("image_data_url"):
        add_file("second_reference_glyph", "second_reference_glyph.png", "image/png", _data_url_to_bytes(secondary_seed.get("image_data_url", "")))
        add_field("second_source_character", _normalize_letter(secondary_seed.get("character", "S"), "S"))
    add_field("source_character", source_character)
    add_field("target_character", target_character)
    add_field("correction", correction)
    add_field("previous_run_id", previous_run_id)
    add_field("session_id", session_id)
    add_field("generation_mode", "final")
    add_field("brush_size", str(brush_size))
    request = urllib.request.Request(
        f"{BACKEND_BASE_URL}/api/v1/generate",
        data=b"".join(body_parts + [f"--{boundary}--\r\n".encode("utf-8")]),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def _multipart_generate_request_with_retry(
    *,
    session_id: str,
    primary_seed: dict,
    secondary_seed: dict | None,
    source_character: str,
    target_character: str,
    correction: str,
    previous_run_id: str,
    brush_size: int = 16,
    attempts: int = 3,
) -> dict:
    last_error: urllib.error.URLError | None = None
    for attempt in range(attempts):
        try:
            return _multipart_generate_request(
                session_id=session_id,
                primary_seed=primary_seed,
                secondary_seed=secondary_seed,
                source_character=source_character,
                target_character=target_character,
                correction=correction,
                previous_run_id=previous_run_id,
                brush_size=brush_size,
            )
        except urllib.error.URLError as exc:
            last_error = exc
            status_code = getattr(exc, "code", None)
            is_retriable = status_code is None or status_code >= 500
            if attempt >= attempts - 1 or not is_retriable:
                raise
            time.sleep(0.8 * (attempt + 1))

    if last_error is not None:
        raise last_error
    raise urllib.error.URLError("Unknown glyph generation failure")


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
    message_lines: list[str] = []
    started_message = False
    for line in completed.stdout.splitlines():
        if line.startswith("Session ID: "):
            session_id = line.removeprefix("Session ID: ").strip()
        elif line.startswith("Open: "):
            frontend_url = line.removeprefix("Open: ").strip()
        elif line.strip():
            started_message = True
            message_lines.append(line.strip())
        elif started_message:
            message_lines.append("")

    while message_lines and message_lines[-1] == "":
        message_lines.pop()

    message = "\n".join(message_lines).strip()
    fallback_message = (
        f"I've opened up Fontsketch in your browser:\n{frontend_url}\n\n"
        'Start by drawing two sample letters. I\'ll use them to build the rest of your font.\n\n'
        'Go ahead and draw the first letter "E". Let me know when you\'re done.'
        if frontend_url
        else
        'Start by drawing two sample letters. I\'ll use them to build the rest of your font.\n\n'
        'Go ahead and draw the first letter "E". Let me know when you\'re done.'
    )

    startup_message = message or fallback_message

    return json.dumps(
        {
            "session_id": session_id,
            "frontend_url": frontend_url,
            "message": startup_message,
            "startup_message": startup_message,
        }
    )


def get_fontsketch_session_status(args: dict, **kwargs) -> str:
    payload = _read_full_session((args.get("session_id") or "").strip())
    if payload.get("error"):
        return json.dumps(payload)
    return json.dumps(
        {
            "session_id": payload.get("session_id", ""),
            "stage": payload.get("stage", "draw"),
            "status": payload.get("status", "ready"),
            "instruction": payload.get("instruction", ""),
            "source_character": payload.get("source_character", ""),
            "target_character": payload.get("target_character", ""),
            "selected_revision_characters": payload.get("selected_revision_characters", []),
            "pending_revision_characters": payload.get("pending_revision_characters", []),
            "font_name": payload.get("font_name", ""),
            "updated_at": payload.get("_updated_at", ""),
        }
    )


def advance_fontsketch_session(args: dict, **kwargs) -> str:
    session_payload = json.loads(get_fontsketch_session_status({"session_id": args.get("session_id", "")}))
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    request = urllib.request.Request(
        f"{BACKEND_BASE_URL}/api/v1/sessions/{session_id}",
        data=json.dumps(
            {
                "status": "advance_requested",
                "instruction": "I am moving Fontsketch to the next step now.",
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(request, timeout=10):
            pass
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to advance Fontsketch session: {exc}"})

    for _ in range(20):
        time.sleep(0.5)
        next_payload = json.loads(get_fontsketch_session_status({"session_id": session_id}))
        if next_payload.get("error"):
            return json.dumps(next_payload)
        if next_payload.get("status") != "advance_requested":
            return json.dumps(next_payload)

    return json.dumps(
        {
            "session_id": session_id,
            "status": "advance_requested",
            "instruction": "I am moving Fontsketch to the next step now.",
        }
    )


def generate_fontsketch_review_glyph(args: dict, **kwargs) -> str:
    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    seed_references = session_payload.get("seed_references", []) or []
    current_drawing = session_payload.get("current_drawing_image_data_url", "")
    if len(seed_references) < 1 or not current_drawing:
        return json.dumps({"error": "Fontsketch needs the first seed and the current drawing before I can generate the review glyph."})

    primary_seed = seed_references[0]
    secondary_seed = seed_references[1] if len(seed_references) > 1 else {
        "character": session_payload.get("source_character", "S"),
        "image_data_url": current_drawing,
    }
    source_character = _normalize_letter(primary_seed.get("character", session_payload.get("source_character", "E")))
    target_character = _next_alphabet_character(source_character)
    _patch_session(
        session_id,
        {
            "status": "generating_single",
            "instruction": f'Based on the two characters you provided, I am now generating a sample of the letter "{target_character}" for you to review.',
            "selected_revision_characters": [],
        },
    )

    try:
        payload = _multipart_generate_request_with_retry(
            session_id=session_id,
            primary_seed=primary_seed,
            secondary_seed=secondary_seed,
            source_character=source_character,
            target_character=target_character,
            correction="",
            previous_run_id="",
            brush_size=16,
        )
    except urllib.error.URLError as exc:
        _patch_session(
            session_id,
            {
                "status": "ready",
                "stage": "draw",
                "instruction": "I couldn't generate the first sample just now. Please try again in a moment.",
                "selected_revision_characters": [],
            },
        )
        return json.dumps({"error": f"Failed to generate Fontsketch review glyph: {exc}"})

    _patch_session(
        session_id,
        {
            "seed_references": [
                {
                    "character": source_character,
                    "image_data_url": primary_seed.get("image_data_url", ""),
                },
                {
                    "character": _normalize_letter(secondary_seed.get("character", session_payload.get("source_character", "S")), "S"),
                    "image_data_url": secondary_seed.get("image_data_url", ""),
                },
            ],
            "batch_run_ids": [],
            "pending_revision_characters": [],
            "export_glyph_overrides": [],
            "normalized_glyphs": [],
            "font_file_data_url": "",
            "current_drawing_image_data_url": "",
        },
    )
    next_session = json.loads(get_fontsketch_session_status({"session_id": session_id}))
    return json.dumps(
        {
            "session_id": session_id,
            "run_id": payload.get("run_id", ""),
            "status": next_session.get("status", "ready"),
            "instruction": next_session.get("instruction", ""),
            "target_character": payload.get("target_character", target_character),
        }
    )


def generate_fontsketch_alphabet_batch(args: dict, **kwargs) -> str:
    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    seed_references = session_payload.get("seed_references", []) or []
    latest_run_id = (session_payload.get("latest_run_id") or "").strip()
    if len(seed_references) < 2 or not latest_run_id:
        return json.dumps({"error": "Fontsketch needs both seed letters and an approved review glyph before I can generate the alphabet batch."})

    primary_seed = seed_references[0]
    secondary_seed = seed_references[1]
    approved_run = _load_run(latest_run_id)
    approved_character = _normalize_letter(approved_run.get("target_character", session_payload.get("target_character", "F")), "F")
    next_targets = [_next_alphabet_character(approved_character)]
    next_targets.append(_next_alphabet_character(next_targets[-1]))
    next_targets.append(_next_alphabet_character(next_targets[-1]))
    next_targets.extend(EXTRA_GLYPHS)
    _patch_session(
        session_id,
        {
            "status": "generating_batch",
            "instruction": "I am now generating the rest of the alphabet.",
            "selected_revision_characters": [],
            "pending_revision_characters": [],
        },
    )
    try:
        items = [
            _multipart_generate_request_with_retry(
                session_id="",
                primary_seed=primary_seed,
                secondary_seed=secondary_seed,
                source_character=_normalize_letter(primary_seed.get("character", "E")),
                target_character=target_character,
                correction="",
                previous_run_id=latest_run_id,
                brush_size=16,
            )
            for target_character in next_targets
        ]
    except urllib.error.URLError as exc:
        _patch_session(
            session_id,
            {
                "status": "ready",
                "stage": "review",
                "instruction": "I couldn't generate the alphabet just now. Please try again in a moment.",
                "selected_revision_characters": [],
                "pending_revision_characters": [],
            },
        )
        return json.dumps({"error": f"Failed to generate Fontsketch alphabet batch: {exc}"})

    batch_run_ids = [item.get("run_id", "") for item in items if item.get("run_id")]
    updated_session = _patch_session(
        session_id,
        {
            "status": "ready",
            "stage": "review",
            "instruction": "Here is the full set of characters for your typeface. If you'd like to request changes, select the letters you'd like to revise and let me know when you're ready. If everything looks good, tell me \"continue\" and I'll move on.",
            "source_character": approved_character,
            "target_character": next_targets[0] if next_targets else _next_alphabet_character(approved_character),
            "latest_run_id": latest_run_id,
            "correction": "",
            "seed_references": seed_references,
            "batch_run_ids": batch_run_ids,
            "selected_revision_characters": [],
            "pending_revision_characters": [],
            "export_glyph_overrides": [],
            "normalized_glyphs": [],
            "font_file_data_url": "",
            "current_drawing_image_data_url": "",
        },
    )
    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_session.get("status", "ready"),
            "instruction": updated_session.get("instruction", ""),
            "target_characters": next_targets,
            "batch_run_ids": batch_run_ids,
        }
    )


def export_fontsketch_outline_set(args: dict, **kwargs) -> str:
    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    glyphs = _session_export_glyphs(session_payload)
    if not glyphs:
        return json.dumps({"error": "No Fontsketch glyphs are available to convert to SVG outlines yet."})

    session_id = session_payload["session_id"]
    _patch_session(
        session_id,
        {
            "status": "exporting_outlines",
            "instruction": "I am converting your glyphs to SVG outlines now.",
            "selected_revision_characters": [],
        },
    )
    try:
        archive_bytes = _binary_request(
            f"{BACKEND_BASE_URL}/api/v1/export-outline-set",
            payload={"session_id": session_id, "glyphs": glyphs},
            timeout=120.0,
        )
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to export Fontsketch outline set: {exc}"})

    updated_session = _patch_session(
        session_id,
        {
            "instruction": "I converted the current glyphs to SVG outlines. Next I will trim and normalize them for the font build.",
            "selected_revision_characters": [],
        },
    )
    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_session.get("status", "ready"),
            "instruction": updated_session.get("instruction", ""),
            "outline_archive_bytes": len(archive_bytes),
            "glyph_count": len(glyphs),
        }
    )


def normalize_fontsketch_glyphs(args: dict, **kwargs) -> str:
    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    glyphs = _session_export_glyphs(session_payload)
    if not glyphs:
        return json.dumps({"error": "No Fontsketch glyphs are available to normalize yet."})

    session_id = session_payload["session_id"]
    _patch_session(
        session_id,
        {
            "status": "normalizing_glyphs",
            "instruction": "I am trimming and formatting your glyphs now so I can compile the font.",
            "selected_revision_characters": [],
        },
    )
    try:
        payload = _json_request(
            f"{BACKEND_BASE_URL}/api/v1/normalize-glyph-set",
            method="POST",
            payload={"session_id": session_id, "glyphs": glyphs},
            timeout=120.0,
        )
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to normalize Fontsketch glyphs: {exc}"})

    updated_session = _patch_session(
        session_id,
        {
            "status": "awaiting_font_name",
            "instruction": "Now I'll compile your font and prepare it for download. What name would you like to give your font?",
            "normalized_glyphs": payload.get("glyphs", []),
            "selected_revision_characters": [],
        },
    )
    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_session.get("status", "awaiting_font_name"),
            "instruction": updated_session.get("instruction", ""),
            "glyph_count": len(payload.get("glyphs", [])),
        }
    )


def submit_fontsketch_revision(args: dict, **kwargs) -> str:
    correction = (args.get("correction") or "").strip()
    if not correction:
        return json.dumps({"error": "A non-empty correction is required."})

    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    target_letters = session_payload.get("selected_revision_characters", []) or [session_payload.get("target_character", "")]
    seed_references = session_payload.get("seed_references", []) or []
    if len(seed_references) < 2:
        return json.dumps({"error": "Fontsketch needs both seed letters before I can apply that revision."})

    normalized_targets = [_normalize_letter(letter, "") for letter in target_letters if letter]
    pending_targets = [_normalize_letter(letter, "") for letter in (session_payload.get("pending_revision_characters") or []) if letter]
    available_targets = [letter for letter in normalized_targets if letter and letter not in pending_targets]
    blocked_targets = [letter for letter in normalized_targets if letter and letter in pending_targets]
    if normalized_targets and not available_targets:
        pending_label = ", ".join(blocked_targets or pending_targets)
        return json.dumps(
            {
                "error": (
                    f"I am still finishing the current revision pass for {pending_label}."
                    if pending_label
                    else "I am still finishing the current revision pass."
                )
            }
        )

    target_label = ", ".join(normalized_targets) or _normalize_letter(session_payload.get("target_character", "F"), "F")
    is_batch_revision = bool(session_payload.get("selected_revision_characters"))
    if not is_batch_revision:
        try:
            _patch_session(
                session_id,
                {
                    "status": "generating_single",
                    "correction": correction,
                    "instruction": f"I am applying that change to {target_label} now.",
                },
            )
        except urllib.error.URLError as exc:
            return json.dumps({"error": f"Failed to update Fontsketch session: {exc}"})

    primary_seed = seed_references[0]
    secondary_seed = seed_references[1]
    source_character = _normalize_letter(primary_seed.get("character", session_payload.get("source_character", "E")))
    latest_run_id = (session_payload.get("latest_run_id") or "").strip()

    try:
        if is_batch_revision:
            payload = _json_request(
                f"{BACKEND_BASE_URL}/api/v1/sessions/{session_id}/revision-batch",
                method="POST",
                payload={
                    "correction": correction,
                    "target_characters": available_targets,
                },
                timeout=10.0,
            )
            return json.dumps(
                {
                    "session_id": session_id,
                    "status": payload.get("status", "generating_batch"),
                    "instruction": payload.get("instruction", ""),
                    "correction": correction,
                    "target_characters": payload.get("target_characters", available_targets),
                    "skipped_target_characters": blocked_targets,
                    "job_id": payload.get("job_id", ""),
                }
            )
        else:
            target_character = _normalize_letter(session_payload.get("target_character", "F"), "F")
            payload = _multipart_generate_request_with_retry(
                session_id=session_id,
                primary_seed=primary_seed,
                secondary_seed=secondary_seed,
                source_character=source_character,
                target_character=target_character,
                correction=correction,
                previous_run_id=latest_run_id,
                brush_size=16,
            )
            final_session = _patch_session(
                session_id,
                {
                    "status": "ready",
                    "stage": "review",
                    "latest_run_id": payload.get("run_id", latest_run_id),
                    "selected_revision_characters": [],
                    "instruction": (
                        f"I've generated a revision for {target_label}. Let me know if it looks good or if you'd like another revision.\n\n"
                        "If it looks good, I will go ahead and generate the full set of characters."
                    ),
                },
            )
    except urllib.error.URLError as exc:
        if not is_batch_revision:
            _patch_session(
                session_id,
                {
                    "status": "ready",
                    "stage": "review",
                    "instruction": "I couldn't apply that revision just now. Please try again in a moment.",
                    "selected_revision_characters": [],
                },
            )
        return json.dumps({"error": f"Failed to apply Fontsketch revision: {exc}"})

    return json.dumps(
        {
            "session_id": session_id,
            "status": final_session.get("status", "ready"),
            "instruction": final_session.get("instruction", ""),
            "correction": correction,
        }
    )


def set_fontsketch_font_name(args: dict, **kwargs) -> str:
    font_name = (args.get("font_name") or "").strip()
    if not font_name:
        return json.dumps({"error": "A non-empty font_name is required."})

    session_payload = json.loads(get_fontsketch_session_status({"session_id": args.get("session_id", "")}))
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    try:
        updated_payload = _patch_session(
            session_id,
            {
                "font_name": font_name,
                "status": "awaiting_font_name",
                "instruction": f'I saved the name "{font_name}". Next I will compile the font file.',
            },
        )
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to save Fontsketch font name: {exc}"})

    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_payload.get("status", "awaiting_font_name"),
            "instruction": updated_payload.get("instruction", ""),
            "font_name": font_name,
        }
    )


def build_fontsketch_font(args: dict, **kwargs) -> str:
    font_name = (args.get("font_name") or "").strip()
    if not font_name:
        return json.dumps({"error": "A non-empty font_name is required."})

    session_payload = _read_full_session((args.get("session_id") or "").strip())
    if session_payload.get("error"):
        return json.dumps(session_payload)

    session_id = session_payload["session_id"]
    glyphs = session_payload.get("normalized_glyphs", []) or _session_export_glyphs(session_payload)
    if not glyphs:
        return json.dumps({"error": "No normalized Fontsketch glyphs are available to build the font yet."})

    _patch_session(
        session_id,
        {
            "font_name": font_name,
            "status": "building_font",
            "instruction": f'I am compiling "{font_name}" into a font file now.',
        },
    )
    try:
        font_bytes = _binary_request(
            f"{BACKEND_BASE_URL}/api/v1/export-partial-font",
            payload={"session_id": session_id, "glyphs": glyphs},
            timeout=120.0,
        )
    except urllib.error.URLError as exc:
        return json.dumps({"error": f"Failed to build the Fontsketch font: {exc}"})

    font_data_url = f"data:font/ttf;base64,{base64.b64encode(font_bytes).decode('ascii')}"
    updated_payload = _patch_session(
        session_id,
        {
            "font_name": font_name,
            "font_file_data_url": font_data_url,
            "normalized_glyphs": glyphs,
            "status": "preview_requested",
            "instruction": f'I am opening the final preview for "{font_name}" now.',
        },
    )
    return json.dumps(
        {
            "session_id": session_id,
            "status": updated_payload.get("status", "preview_requested"),
            "instruction": updated_payload.get("instruction", ""),
            "font_name": font_name,
            "font_bytes": len(font_bytes),
        }
    )

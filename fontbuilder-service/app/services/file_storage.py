import json
from pathlib import Path
from datetime import UTC, datetime
from threading import RLock
from uuid import uuid4

from app.core.config import get_settings

EXTRA_GLYPHS = {"\\", ".", "\""}
SUPPORTED_GLYPHS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") | EXTRA_GLYPHS


class RunStorage:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.runs_dir = Path(self.settings.runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir = self.runs_dir / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self._session_lock = RLock()

    def create_run_dir(self) -> tuple[str, Path]:
        run_id = f"run_{uuid4().hex[:10]}"
        run_dir = self.runs_dir / run_id
        for child in ("input", "kimi", "generated", "eval", "vector"):
            (run_dir / child).mkdir(parents=True, exist_ok=True)
        return run_id, run_dir

    def create_session(self) -> str:
        with self._session_lock:
            session_id = uuid4().hex[:10]
            self.write_json(self.sessions_dir / f"{session_id}.json", self._default_session_payload(session_id))
            return session_id

    def read_session(self, session_id: str) -> dict | None:
        with self._session_lock:
            path = self.sessions_dir / f"{session_id}.json"
            if not path.exists():
                return None
            return self.read_json(path)

    def update_session(self, session_id: str, updates: dict) -> dict | None:
        with self._session_lock:
            current = self.read_session(session_id)
            if current is None:
                return None
            merged = {**current, **{key: value for key, value in updates.items() if value is not None}}
            self.write_json(self.sessions_dir / f"{session_id}.json", merged)
            return merged

    def approve_session(self, session_id: str) -> dict | None:
        current = self.read_session(session_id)
        if current is None:
            return None

        source_character = (current.get("target_character") or current.get("source_character") or "A").upper()
        target_character = self._next_alphabet_character(source_character)
        return self.update_session(
            session_id,
            {
                "status": "awaiting_hermes_batch_confirmation",
                "instruction": f'I recorded your approval of "{source_character}". Tell me if you want me to generate more glyphs.',
                "source_character": source_character,
                "target_character": target_character,
                "skeleton_image_data_url": "",
                "selected_revision_characters": [],
                "pending_revision_characters": [],
                "active_revision_job_id": "",
            },
        )

    def request_session_edit(self, session_id: str, selected_revision_characters: list[str] | None = None) -> dict | None:
        current = self.read_session(session_id)
        if current is None:
            return None

        selected = [
            self._normalize_session_character(character, "")
            for character in (selected_revision_characters or [])
            if self._normalize_session_character(character, "")
        ]
        selected = list(dict.fromkeys(selected))
        target_character = (current.get("target_character") or "B").upper()
        pending = [
            self._normalize_session_character(character, "")
            for character in (current.get("pending_revision_characters") or [])
            if self._normalize_session_character(character, "")
        ]
        pending = list(dict.fromkeys(pending))
        if selected and pending:
            instruction = (
                f'You\'ve selected {", ".join(selected)} for the next revision pass. '
                f'I am still updating {", ".join(pending)} right now. '
                "If you've already told me what to change, tell me to continue and I'll queue the next revisions."
            )
        elif selected:
            instruction = (
                f'You\'ve selected {", ".join(selected)} for revisions. '
                "If you've already told me what to change, tell me to continue and I'll make those revisions. "
                "Otherwise, tell me what to change."
            )
        else:
            instruction = (
                f'I\'m ready to revise "{target_character}". '
                "If you've already told me what to change, tell me to continue and I'll make the revision. "
                "Otherwise, tell me what to change."
            )
        return self.update_session(
            session_id,
            {
                "status": "generating_batch" if pending else "awaiting_hermes_edit_prompt",
                "instruction": instruction,
                "selected_revision_characters": selected,
            },
        )

    @staticmethod
    def _default_session_payload(session_id: str) -> dict:
        return {
            "session_id": session_id,
            "status": "ready",
            "stage": "draw",
            "instruction": "Start by drawing two sample letters. I'll use them to build the rest of your font.\n\nGo ahead and draw the first letter \"E\". Approve it when you're done.",
            "source_character": "E",
            "target_character": "E",
            "skeleton_image_data_url": "",
            "structural_mode": "stroke-path",
            "correction": "",
            "latest_run_id": "",
            "selected_revision_characters": [],
            "font_name": "",
            "current_drawing_image_data_url": "",
            "seed_references": [],
            "batch_run_ids": [],
            "pending_revision_characters": [],
            "active_revision_job_id": "",
            "export_glyph_overrides": [],
            "normalized_glyphs": [],
            "font_file_data_url": "",
            "created_at": datetime.now(UTC).isoformat(),
        }

    @staticmethod
    def _next_alphabet_character(character: str) -> str:
        normalized = (character[:1] or "A").upper()
        if not normalized.isalpha():
            return "B"
        if normalized == "Z":
            return "A"
        return chr(ord(normalized) + 1)

    @staticmethod
    def _normalize_session_character(character: str, fallback: str = "A") -> str:
        normalized = (character[:1] or fallback).upper()
        return normalized if normalized in SUPPORTED_GLYPHS else fallback

    def write_bytes(self, path: Path, content: bytes) -> None:
        path.write_bytes(content)

    def read_bytes(self, path: Path) -> bytes:
        return path.read_bytes()

    def write_json(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

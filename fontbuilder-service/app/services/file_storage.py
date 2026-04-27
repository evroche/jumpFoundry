import json
from pathlib import Path
from datetime import UTC, datetime
from uuid import uuid4

from app.core.config import get_settings


class RunStorage:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.runs_dir = Path(self.settings.runs_dir)
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_dir = self.runs_dir / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def create_run_dir(self) -> tuple[str, Path]:
        run_id = f"run_{uuid4().hex[:10]}"
        run_dir = self.runs_dir / run_id
        for child in ("input", "kimi", "generated", "eval", "vector"):
            (run_dir / child).mkdir(parents=True, exist_ok=True)
        return run_id, run_dir

    def create_session(self) -> str:
        session_id = uuid4().hex[:10]
        self.write_json(self.sessions_dir / f"{session_id}.json", self._default_session_payload(session_id))
        return session_id

    def read_session(self, session_id: str) -> dict | None:
        path = self.sessions_dir / f"{session_id}.json"
        if not path.exists():
            return None
        return self.read_json(path)

    def update_session(self, session_id: str, updates: dict) -> dict | None:
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
                "instruction": f'Ask whether to continue generating more glyphs after approving "{source_character}".',
                "source_character": source_character,
                "target_character": target_character,
                "skeleton_image_data_url": "",
            },
        )

    def request_session_edit(self, session_id: str) -> dict | None:
        current = self.read_session(session_id)
        if current is None:
            return None

        target_character = (current.get("target_character") or "B").upper()
        return self.update_session(
            session_id,
            {
                "status": "awaiting_hermes_edit_prompt",
                "instruction": f'Ask what should change about the "{target_character}" glyph before revising it. Once the user tells you, save the revision and regenerate that glyph.',
            },
        )

    @staticmethod
    def _default_session_payload(session_id: str) -> dict:
        return {
            "session_id": session_id,
            "status": "ready",
            "stage": "draw",
            "instruction": 'We\'ll draw two letters and use this to generate the rest of the typeface.\n\nStart by drawing the letter "E".',
            "source_character": "E",
            "target_character": "E",
            "skeleton_image_data_url": "",
            "structural_mode": "stroke-path",
            "correction": "",
            "latest_run_id": "",
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

    def write_bytes(self, path: Path, content: bytes) -> None:
        path.write_bytes(content)

    def read_bytes(self, path: Path) -> bytes:
        return path.read_bytes()

    def write_json(self, path: Path, payload: dict) -> None:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def read_json(self, path: Path) -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

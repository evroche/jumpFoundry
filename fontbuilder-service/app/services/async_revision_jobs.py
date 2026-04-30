import base64
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from uuid import uuid4

from app.services.file_storage import RunStorage
from app.services.orchestrator import GenerationOrchestrator


def _normalize_letter(value: str, fallback: str = "A") -> str:
    normalized = (value[:1] or fallback).upper()
    return normalized if normalized.isalpha() else fallback


def _data_url_to_bytes(data_url: str) -> bytes:
    if "," not in data_url:
        return b""
    header, payload = data_url.split(",", 1)
    if ";base64" in header:
        return base64.b64decode(payload)
    return payload.encode("utf-8")


class AsyncRevisionJobService:
    def __init__(
        self,
        *,
        storage: RunStorage,
        orchestrator: GenerationOrchestrator,
        max_workers: int = 4,
    ) -> None:
        self.storage = storage
        self.orchestrator = orchestrator
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="fontsketch-async-revisions",
        )
        self._lock = Lock()
        self._active_job_by_session: dict[str, str] = {}

    def has_active_job(self, session_id: str) -> bool:
        with self._lock:
            return session_id in self._active_job_by_session

    def submit_revision_batch(
        self,
        *,
        session_id: str,
        correction: str,
        target_characters: list[str],
    ) -> str:
        with self._lock:
            if session_id in self._active_job_by_session:
                raise ValueError("A revision batch is already running for this session.")
            job_id = f"job_{uuid4().hex[:10]}"
            self._active_job_by_session[session_id] = job_id

        try:
            future = self.executor.submit(
                self._run_revision_batch,
                job_id,
                session_id,
                correction,
                [_normalize_letter(character, "") for character in target_characters if character],
            )
        except Exception:
            with self._lock:
                if self._active_job_by_session.get(session_id) == job_id:
                    self._active_job_by_session.pop(session_id, None)
            raise
        future.add_done_callback(lambda _: self._mark_complete(session_id, job_id))
        return job_id

    def _mark_complete(self, session_id: str, job_id: str) -> None:
        with self._lock:
            if self._active_job_by_session.get(session_id) == job_id:
                self._active_job_by_session.pop(session_id, None)

    def _run_revision_batch(
        self,
        job_id: str,
        session_id: str,
        correction: str,
        target_characters: list[str],
    ) -> None:
        completed: list[str] = []
        failed: list[str] = []
        pending = list(target_characters)
        try:
            session = self.storage.read_session(session_id)
            if session is None:
                return

            seed_references = session.get("seed_references", []) or []
            if len(seed_references) < 2:
                self.storage.update_session(
                    session_id,
                    {
                        "status": "ready",
                        "instruction": "I couldn't apply that revision because both seed letters are required.",
                        "pending_revision_characters": [],
                        "active_revision_job_id": "",
                        "selected_revision_characters": [],
                    },
                )
                return

            primary_seed = seed_references[0]
            secondary_seed = seed_references[1]
            primary_bytes = _data_url_to_bytes(primary_seed.get("image_data_url", ""))
            secondary_bytes = _data_url_to_bytes(secondary_seed.get("image_data_url", ""))
            source_character = _normalize_letter(primary_seed.get("character", session.get("source_character", "E")), "E")
            secondary_character = _normalize_letter(secondary_seed.get("character", session.get("target_character", "S")), "S")
            brush_size = 16

            for character in target_characters:
                try:
                    latest_session = self.storage.read_session(session_id) or session
                    previous_run_id = self._existing_run_id_for_character(latest_session, character)
                    generation = self.orchestrator.generate(
                        reference_filename="reference_glyph.png",
                        reference_media_type="image/png",
                        reference_bytes=primary_bytes,
                        source_character=source_character,
                        target_character=character,
                        correction=correction,
                        previous_run_id=previous_run_id,
                        generation_mode="final",
                        brush_size=brush_size,
                        additional_reference_images=[(secondary_bytes, "image/png")] if secondary_bytes else None,
                        additional_source_characters=[secondary_character] if secondary_bytes else None,
                    )
                    completed.append(character)
                    pending = [item for item in pending if item != character]
                    self._apply_completed_revision(
                        session_id=session_id,
                        character=character,
                        run_id=generation.run_id,
                        image_data_url=generation.generated_image_data_url,
                        pending_characters=pending,
                        job_id=job_id,
                    )
                except Exception:
                    failed.append(character)
                    pending = [item for item in pending if item != character]
                    self.storage.update_session(
                        session_id,
                        {
                            "pending_revision_characters": pending,
                            "active_revision_job_id": job_id,
                        },
                    )
        finally:
            self.storage.update_session(
                session_id,
                {
                    "status": "ready",
                    "stage": "review",
                    "instruction": self._completion_instruction(completed, failed),
                    "pending_revision_characters": [],
                    "active_revision_job_id": "",
                    "selected_revision_characters": [],
                },
            )

    def _apply_completed_revision(
        self,
        *,
        session_id: str,
        character: str,
        run_id: str,
        image_data_url: str,
        pending_characters: list[str],
        job_id: str,
    ) -> None:
        session = self.storage.read_session(session_id)
        if session is None:
            return

        updated_seed_references = []
        replaced_seed_reference = False
        for reference in session.get("seed_references", []) or []:
            if _normalize_letter(reference.get("character", ""), "") == character:
                replaced_seed_reference = True
                updated_seed_references.append(
                    {
                        "character": _normalize_letter(reference.get("character", character), character),
                        "image_data_url": image_data_url,
                    }
                )
            else:
                updated_seed_references.append(reference)

        updated_latest_run_id = session.get("latest_run_id", "") or ""
        replaced_latest_run = False
        if updated_latest_run_id:
            latest_run = self.orchestrator.load_run(updated_latest_run_id)
            if latest_run and _normalize_letter(latest_run.target_character, "") == character:
                replaced_latest_run = True
                updated_latest_run_id = run_id

        updated_batch_run_ids: list[str] = []
        replaced_batch_run = False
        for existing_run_id in session.get("batch_run_ids", []) or []:
            existing_run = self.orchestrator.load_run(existing_run_id)
            if existing_run and _normalize_letter(existing_run.target_character, "") == character:
                replaced_batch_run = True
                updated_batch_run_ids.append(run_id)
            else:
                updated_batch_run_ids.append(existing_run_id)
        if not replaced_seed_reference and not replaced_latest_run and not replaced_batch_run:
            updated_batch_run_ids.append(run_id)

        self.storage.update_session(
            session_id,
            {
                "seed_references": updated_seed_references,
                "latest_run_id": updated_latest_run_id,
                "batch_run_ids": updated_batch_run_ids,
                "pending_revision_characters": pending_characters,
                "active_revision_job_id": job_id,
                "normalized_glyphs": [],
                "font_file_data_url": "",
            },
        )

    def _existing_run_id_for_character(self, session: dict, character: str) -> str:
        latest_run_id = (session.get("latest_run_id") or "").strip()
        if latest_run_id:
            latest_run = self.orchestrator.load_run(latest_run_id)
            if latest_run and _normalize_letter(latest_run.target_character, "") == character:
                return latest_run_id

        for existing_run_id in session.get("batch_run_ids", []) or []:
            run = self.orchestrator.load_run(existing_run_id)
            if run and _normalize_letter(run.target_character, "") == character:
                return existing_run_id
        return ""

    @staticmethod
    def _completion_instruction(completed: list[str], failed: list[str]) -> str:
        if completed and not failed:
            return (
                "I finished the latest revision pass. The updated letters are on the board. "
                "If you'd like more changes, select the letters you'd like to revise and let me know when you're ready."
            )
        if completed and failed:
            return (
                "I finished the latest revision pass. The updated letters are on the board, but a few requested letters did not update. "
                "If you'd like to try again, select those letters and let me know when you're ready."
            )
        return (
            "I couldn't produce new revisions from that last request. "
            "If you'd like to try again, select the letters you'd like to revise and let me know when you're ready."
        )

import base64
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from uuid import uuid4

from app.services.file_storage import RunStorage
from app.services.orchestrator import GenerationOrchestrator

EXTRA_GLYPHS = {"!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "-", ":", ";", "/", "\\", "?", ".", ",", "'", "\""}
SUPPORTED_GLYPHS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ") | set("0123456789") | EXTRA_GLYPHS


def _normalize_letter(value: str, fallback: str = "A") -> str:
    normalized = (value[:1] or fallback).upper()
    return normalized if normalized in SUPPORTED_GLYPHS else fallback


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
        self._active_jobs_by_session: dict[str, set[str]] = {}
        self._active_letters_by_session: dict[str, set[str]] = {}
        self._letters_by_job: dict[str, set[str]] = {}

    def has_active_job(self, session_id: str) -> bool:
        with self._lock:
            return bool(self._pending_letters_locked(session_id))

    def submit_revision_batch(
        self,
        *,
        session_id: str,
        correction: str,
        target_characters: list[str],
    ) -> tuple[str, str, list[str]]:
        normalized_targets = [_normalize_letter(character, "") for character in target_characters if character]
        if not normalized_targets:
            raise ValueError("target_characters must contain at least one valid glyph.")

        with self._lock:
            session = self.storage.read_session(session_id) or {}
            persisted_pending = self._normalize_letter_list(session.get("pending_revision_characters", []) or [])
            active_letters = set(persisted_pending)
            active_letters.update(self._active_letters_by_session.get(session_id, set()))
            overlapping = [character for character in normalized_targets if character in active_letters]
            if overlapping:
                raise ValueError(
                    f'A revision is already running for {", ".join(overlapping)}.'
                )
            job_id = f"job_{uuid4().hex[:10]}"
            merged_pending = self._normalize_letter_list([*persisted_pending, *normalized_targets])
            self._active_letters_by_session[session_id] = set(merged_pending)
            self._active_jobs_by_session.setdefault(session_id, set()).add(job_id)
            self._letters_by_job[job_id] = set(normalized_targets)
            instruction = (
                f'I am applying that change to {", ".join(normalized_targets)} now. '
                "The updated letters will appear on the board as each one finishes."
            )
            updated_session = self.storage.update_session(
                session_id,
                {
                    "status": "generating_batch",
                    "stage": "review",
                    "correction": correction,
                    "instruction": instruction,
                    "selected_revision_characters": [],
                    "pending_revision_characters": merged_pending,
                    "active_revision_job_id": job_id,
                    "export_glyph_overrides": [],
                    "normalized_glyphs": [],
                    "font_file_data_url": "",
                },
            )
            if updated_session is None:
                self._release_job_locked(session_id, job_id, normalized_targets)
                raise ValueError("Session not found.")

        try:
            future = self.executor.submit(
                self._run_revision_batch,
                job_id,
                session_id,
                correction,
                normalized_targets,
            )
        except Exception:
            with self._lock:
                self._release_job_locked(session_id, job_id, normalized_targets)
                restored_pending = self._pending_letters_locked(session_id)
                self.storage.update_session(
                    session_id,
                    {
                        "status": "generating_batch" if restored_pending else "ready",
                        "instruction": self._in_progress_instruction(restored_pending) if restored_pending else "I couldn't start that revision batch. Please try again.",
                        "pending_revision_characters": restored_pending,
                        "active_revision_job_id": self._representative_job_id_locked(session_id),
                    },
                )
            raise
        return job_id, instruction, normalized_targets

    @staticmethod
    def _normalize_letter_list(values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            letter = _normalize_letter(value, "")
            if letter and letter not in normalized:
                normalized.append(letter)
        return normalized

    def _pending_letters_locked(self, session_id: str) -> list[str]:
        letters = self._active_letters_by_session.get(session_id, set())
        return sorted(letters)

    def _representative_job_id_locked(self, session_id: str) -> str:
        active_jobs = sorted(self._active_jobs_by_session.get(session_id, set()))
        return active_jobs[0] if active_jobs else ""

    def _release_job_locked(self, session_id: str, job_id: str, letters: list[str]) -> None:
        active_jobs = self._active_jobs_by_session.get(session_id)
        if active_jobs is not None:
            active_jobs.discard(job_id)
            if not active_jobs:
                self._active_jobs_by_session.pop(session_id, None)
        self._letters_by_job.pop(job_id, None)
        active_letters = self._active_letters_by_session.get(session_id)
        if active_letters is not None:
            for letter in letters:
                active_letters.discard(letter)
            if not active_letters:
                self._active_letters_by_session.pop(session_id, None)

    def _run_revision_batch(
        self,
        job_id: str,
        session_id: str,
        correction: str,
        target_characters: list[str],
    ) -> None:
        completed: list[str] = []
        failed: list[str] = []
        try:
            session = self.storage.read_session(session_id)
            if session is None:
                return

            seed_references = session.get("seed_references", []) or []
            if len(seed_references) < 2:
                failed.extend(target_characters or ["?"])
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
                    self._apply_completed_revision(
                        session_id=session_id,
                        character=character,
                        run_id=generation.run_id,
                        image_data_url=generation.generated_image_data_url,
                        job_id=job_id,
                    )
                except Exception:
                    failed.append(character)
                    self._apply_failed_revision(
                        session_id=session_id,
                        character=character,
                        job_id=job_id,
                    )
        finally:
            self._finalize_job(
                session_id=session_id,
                job_id=job_id,
                completed=completed,
                failed=failed,
            )

    def _apply_completed_revision(
        self,
        *,
        session_id: str,
        character: str,
        run_id: str,
        image_data_url: str,
        job_id: str,
    ) -> None:
        with self._lock:
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

            pending_characters, active_job_id = self._finish_letter_locked(session_id, job_id, character)
            self.storage.update_session(
                session_id,
                {
                    "seed_references": updated_seed_references,
                    "latest_run_id": updated_latest_run_id,
                    "batch_run_ids": updated_batch_run_ids,
                    "pending_revision_characters": pending_characters,
                    "active_revision_job_id": active_job_id,
                    "status": "generating_batch" if pending_characters else "ready",
                    "instruction": self._in_progress_instruction(pending_characters) if pending_characters else session.get("instruction", ""),
                    "export_glyph_overrides": [],
                    "normalized_glyphs": [],
                    "font_file_data_url": "",
                },
            )

    def _apply_failed_revision(
        self,
        *,
        session_id: str,
        character: str,
        job_id: str,
    ) -> None:
        with self._lock:
            pending_characters, active_job_id = self._finish_letter_locked(session_id, job_id, character)
            self.storage.update_session(
                session_id,
                {
                    "pending_revision_characters": pending_characters,
                    "active_revision_job_id": active_job_id,
                    "status": "generating_batch" if pending_characters else "ready",
                    "instruction": self._in_progress_instruction(pending_characters) if pending_characters else "I couldn't produce new revisions from that last request.",
                },
            )

    def _finish_letter_locked(self, session_id: str, job_id: str, character: str) -> tuple[list[str], str]:
        active_letters = self._active_letters_by_session.setdefault(session_id, set())
        active_letters.discard(character)
        if not active_letters:
            self._active_letters_by_session.pop(session_id, None)

        job_letters = self._letters_by_job.get(job_id)
        if job_letters is not None:
            job_letters.discard(character)
            if not job_letters:
                self._letters_by_job.pop(job_id, None)
                active_jobs = self._active_jobs_by_session.get(session_id)
                if active_jobs is not None:
                    active_jobs.discard(job_id)
                    if not active_jobs:
                        self._active_jobs_by_session.pop(session_id, None)

        return self._pending_letters_locked(session_id), self._representative_job_id_locked(session_id)

    def _finalize_job(
        self,
        *,
        session_id: str,
        job_id: str,
        completed: list[str],
        failed: list[str],
        forced_instruction: str | None = None,
    ) -> None:
        with self._lock:
            remaining_job_letters = sorted(self._letters_by_job.pop(job_id, set()))
            active_jobs = self._active_jobs_by_session.get(session_id)
            if active_jobs is not None:
                active_jobs.discard(job_id)
                if not active_jobs:
                    self._active_jobs_by_session.pop(session_id, None)

            active_letters = self._active_letters_by_session.get(session_id)
            if active_letters is not None:
                for letter in remaining_job_letters:
                    active_letters.discard(letter)
                if not active_letters:
                    self._active_letters_by_session.pop(session_id, None)

            pending_letters = self._pending_letters_locked(session_id)
            active_job_id = self._representative_job_id_locked(session_id)
            self.storage.update_session(
                session_id,
                {
                    "status": "generating_batch" if pending_letters else "ready",
                    "stage": "review",
                    "instruction": (
                        self._in_progress_instruction(pending_letters)
                        if pending_letters
                        else (forced_instruction or self._completion_instruction(completed, failed))
                    ),
                    "pending_revision_characters": pending_letters,
                    "active_revision_job_id": active_job_id,
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
                "If you'd like more changes, select the letters you'd like to revise and press redo."
            )
        if completed and failed:
            return (
                "I finished the latest revision pass. The updated letters are on the board, but a few requested letters did not update. "
                "If you'd like to try again, select those letters and press redo."
            )
        return (
            "I couldn't produce new revisions from that last request. "
            "If you'd like to try again, select the letters you'd like to revise and press redo."
        )

    @staticmethod
    def _in_progress_instruction(pending_letters: list[str]) -> str:
        if not pending_letters:
            return ""
        return (
            f'I am still applying revisions to {", ".join(pending_letters)} now. '
            "The updated letters will appear on the board as each one finishes."
        )

import base64
from pathlib import Path

from app.core.config import get_backend_version
from app.schemas.glyph import DebugEntry, GlyphBatchResponse, GlyphGenerationResponse
from app.services.file_storage import RunStorage
from app.services.provider_clients import (
    OpenAIImagesClient,
    build_generation_prompt,
    write_json,
)
from app.services.vectorizer import vectorize_centerline_and_render

MAX_RETURNED_VECTOR_DATA_URL_BYTES = 2_000_000


class GenerationOrchestrator:
    def __init__(self) -> None:
        self.storage = RunStorage()
        self.images = OpenAIImagesClient()

    def generate(
        self,
        reference_filename: str,
        reference_media_type: str,
        reference_bytes: bytes,
        source_character: str,
        target_character: str,
        correction: str = "",
        previous_run_id: str = "",
        session_id: str = "",
        generation_mode: str = "final",
        brush_size: int = 16,
        additional_reference_images: list[tuple[bytes, str]] | None = None,
        additional_source_characters: list[str] | None = None,
    ) -> GlyphGenerationResponse:
        run_id, run_dir = self.storage.create_run_dir()

        reference_path = run_dir / "input" / self._normalize_reference_name(reference_filename)
        self.storage.write_bytes(reference_path, reference_bytes)

        previous_generated_image_bytes = self._load_previous_generated_image(previous_run_id) if previous_run_id else None
        prompt = build_generation_prompt(
            source_character,
            target_character,
            correction,
            has_previous_generated_image=bool(previous_generated_image_bytes),
            generation_mode=generation_mode,
            additional_source_characters=additional_source_characters,
        )
        prompt_path = run_dir / "kimi" / "prompt.json"
        write_json(prompt_path, {"prompt": prompt})
        try:
            generated_bytes, provider_response = self.images.edit_glyph(
                reference_bytes,
                reference_media_type,
                prompt,
                additional_reference_images=additional_reference_images,
                previous_generated_image_bytes=previous_generated_image_bytes,
            )
        except Exception as exc:
            (run_dir / "generated" / "error.txt").write_text(str(exc), encoding="utf-8")
            raise
        analysis = None
        suggested_revision = ""
        try:
            interpreted_vector_data_url, final_render_data_url = vectorize_centerline_and_render(
                generated_bytes,
                brush_size=brush_size,
            )
        except Exception as exc:
            (run_dir / "vector" / "error.txt").write_text(str(exc), encoding="utf-8")
            raise
        debug = [
            DebugEntry(
                step="generate",
                payload={
                    "mode": "revise" if previous_generated_image_bytes else "first_pass",
                    "source_character": source_character.upper(),
                    "target_character": target_character.upper(),
                    "previous_run_id": previous_run_id,
                    "correction": correction,
                    "prompt": prompt,
                    "generation_mode": generation_mode,
                    "brush_size": brush_size,
                    "reference_image_bytes": len(reference_bytes),
                    "additional_reference_count": len(additional_reference_images or []),
                    "additional_source_characters": [character.upper() for character in (additional_source_characters or [])],
                    "has_previous_generated_image": bool(previous_generated_image_bytes),
                },
            )
        ]

        analysis_path = run_dir / "kimi" / "analysis.json"
        provider_path = run_dir / "generated" / "provider_response.json"
        generated_path = run_dir / "generated" / f"{target_character.upper()}.png"
        interpreted_vector_path = run_dir / "vector" / f"{target_character.upper()}_centerline.svg.txt"
        final_render_path = run_dir / "vector" / f"{target_character.upper()}_final.png.txt"
        manifest_path = run_dir / "manifest.json"

        write_json(provider_path, provider_response)
        self.storage.write_bytes(generated_path, generated_bytes)
        interpreted_vector_path.write_text(interpreted_vector_data_url, encoding="utf-8")
        final_render_path.write_text(final_render_data_url, encoding="utf-8")
        write_json(
            manifest_path,
            {
                "run_id": run_id,
                "reference_image_path": str(reference_path.relative_to(run_dir)),
                "analysis_path": str(analysis_path.relative_to(run_dir)),
                "generated_image_path": str(generated_path.relative_to(run_dir)),
                "interpreted_vector_path": str(interpreted_vector_path.relative_to(run_dir)),
                "final_render_path": str(final_render_path.relative_to(run_dir)),
                "source_character": source_character.upper(),
                "target_character": target_character.upper(),
                "correction": correction,
                "used_previous_generated_image": bool(previous_generated_image_bytes),
                "previous_run_id": previous_run_id,
            },
        )

        image_base64 = base64.b64encode(generated_bytes).decode("utf-8")
        response = GlyphGenerationResponse(
            run_id=run_id,
            backend_version=get_backend_version(),
            source_character=source_character.upper(),
            target_character=target_character.upper(),
            correction=correction,
            suggested_revision="",
            generated_image_data_url=f"data:image/png;base64,{image_base64}",
            interpreted_vector_data_url=interpreted_vector_data_url,
            final_render_data_url=final_render_data_url,
            analysis=None,
            debug=debug,
        )
        if session_id:
            self.storage.update_session(
                session_id,
                {
                    "status": "ready",
                    "stage": "review",
                    "instruction": (
                        f'I generated the "{target_character.upper()}" glyph skeleton. Review it before I continue.'
                        if generation_mode == "skeleton"
                        else (
                            f'I generated a revision of "{target_character.upper()}". Let me know if it looks good or if you want another revision.'
                            if correction and previous_generated_image_bytes
                            else f'I generated "{target_character.upper()}". Approve it if it looks right, or message me back to request changes.'
                        )
                    ),
                    "source_character": source_character.upper(),
                    "target_character": target_character.upper(),
                    "correction": correction,
                    "latest_run_id": run_id,
                    "skeleton_image_data_url": "",
                    "selected_revision_characters": [],
                },
            )
        return response

    def generate_many(
        self,
        reference_filename: str,
        reference_media_type: str,
        reference_bytes: bytes,
        source_character: str,
        target_characters: list[str],
        accepted_run_id: str = "",
        correction: str = "",
    ) -> GlyphBatchResponse:
        items: list[GlyphGenerationResponse] = []
        for target_character in target_characters:
            items.append(
                self.generate(
                    reference_filename=reference_filename,
                    reference_media_type=reference_media_type,
                    reference_bytes=reference_bytes,
                    source_character=source_character,
                    target_character=target_character,
                    correction=correction,
                    previous_run_id=accepted_run_id,
                    brush_size=16,
                )
            )
        return GlyphBatchResponse(
            backend_version=get_backend_version(),
            source_character=source_character.upper(),
            target_characters=target_characters,
            accepted_run_id=accepted_run_id,
            items=items,
        )

    def load_run(self, run_id: str) -> GlyphGenerationResponse | None:
        run_dir = self.storage.runs_dir / run_id
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            return None

        manifest = self.storage.read_json(manifest_path)
        generated_rel = manifest.get("generated_image_path")
        if not generated_rel:
            return None

        generated_path = run_dir / generated_rel
        if not generated_path.exists():
            return None

        generated_bytes = self.storage.read_bytes(generated_path)
        image_base64 = base64.b64encode(generated_bytes).decode("utf-8")

        interpreted_vector_rel = manifest.get("interpreted_vector_path", "")
        final_render_rel = manifest.get("final_render_path", "")
        interpreted_vector_data_url = ""
        final_render_data_url = ""
        if interpreted_vector_rel:
            interpreted_vector_path = run_dir / interpreted_vector_rel
            if (
                interpreted_vector_path.exists()
                and interpreted_vector_path.stat().st_size <= MAX_RETURNED_VECTOR_DATA_URL_BYTES
            ):
                interpreted_vector_data_url = interpreted_vector_path.read_text(encoding="utf-8")
        if final_render_rel:
            final_render_path = run_dir / final_render_rel
            if final_render_path.exists():
                final_render_data_url = final_render_path.read_text(encoding="utf-8")

        prompt = ""
        prompt_path = run_dir / "kimi" / "prompt.json"
        if prompt_path.exists():
            prompt_payload = self.storage.read_json(prompt_path)
            prompt = prompt_payload.get("prompt", "")

        return GlyphGenerationResponse(
            run_id=run_id,
            backend_version=get_backend_version(),
            source_character=(manifest.get("source_character") or "A").upper(),
            target_character=(manifest.get("target_character") or "B").upper(),
            correction=manifest.get("correction", "") or "",
            suggested_revision="",
            generated_image_data_url=f"data:image/png;base64,{image_base64}",
            interpreted_vector_data_url=interpreted_vector_data_url,
            final_render_data_url=final_render_data_url,
            analysis=None,
            debug=[
                DebugEntry(
                    step="generate",
                    payload={
                        "mode": "revise" if manifest.get("used_previous_generated_image") else "first_pass",
                        "source_character": (manifest.get("source_character") or "A").upper(),
                        "target_character": (manifest.get("target_character") or "B").upper(),
                        "previous_run_id": manifest.get("previous_run_id", "") or "",
                        "correction": manifest.get("correction", "") or "",
                        "prompt": prompt,
                    },
                )
            ],
        )

    @staticmethod
    def _normalize_reference_name(filename: str) -> str:
        suffix = Path(filename).suffix or ".png"
        return f"reference_glyph{suffix}"

    def _load_previous_generated_image(self, previous_run_id: str) -> bytes | None:
        run_dir = self.storage.runs_dir / previous_run_id
        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            return None
        manifest = self.storage.read_json(manifest_path)
        generated_rel = manifest.get("generated_image_path")
        if not generated_rel:
            return None
        generated_path = run_dir / generated_rel
        if not generated_path.exists():
            return None
        return self.storage.read_bytes(generated_path)

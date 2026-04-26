import base64
from pathlib import Path

from app.core.config import get_backend_version
from app.schemas.glyph import DebugEntry, GlyphBatchResponse, GlyphGenerationResponse
from app.services.file_storage import RunStorage
from app.services.provider_clients import (
    HermesClient,
    OpenAIImagesClient,
    build_generation_prompt,
    run_parallel_image_and_analysis,
    write_json,
)


class GenerationOrchestrator:
    def __init__(self) -> None:
        self.storage = RunStorage()
        self.hermes = HermesClient()
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
        )
        (generated_bytes, provider_response), analysis, suggested_revision = run_parallel_image_and_analysis(
            self.hermes,
            self.images,
            reference_bytes,
            reference_media_type,
            prompt,
            previous_generated_image_bytes=previous_generated_image_bytes,
        )
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
                },
            )
        ]
        if analysis is not None:
            debug.append(
                DebugEntry(
                    step="suggested_revision",
                    payload={
                        "style_summary": analysis.style_summary,
                        "suggested_revision": suggested_revision,
                    },
                )
            )

        analysis_path = run_dir / "kimi" / "analysis.json"
        provider_path = run_dir / "generated" / "provider_response.json"
        generated_path = run_dir / "generated" / f"{target_character.upper()}.png"
        manifest_path = run_dir / "manifest.json"

        if analysis is not None:
            write_json(analysis_path, analysis.model_dump())
        write_json(run_dir / "kimi" / "prompt.json", {"prompt": prompt})
        write_json(provider_path, provider_response)
        self.storage.write_bytes(generated_path, generated_bytes)
        write_json(
            manifest_path,
            {
                "run_id": run_id,
                "reference_image_path": str(reference_path.relative_to(run_dir)),
                "analysis_path": str(analysis_path.relative_to(run_dir)),
                "generated_image_path": str(generated_path.relative_to(run_dir)),
                "source_character": source_character.upper(),
                "target_character": target_character.upper(),
                "correction": correction,
                "suggested_revision": suggested_revision,
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
            correction=correction or suggested_revision,
            suggested_revision=suggested_revision,
            generated_image_data_url=f"data:image/png;base64,{image_base64}",
            analysis=analysis,
            debug=debug,
        )
        if session_id:
            self.storage.update_session(
                session_id,
                {
                    "stage": "review",
                    "instruction": f'Review the generated "{target_character.upper()}" glyph. Regenerate if needed or continue when it feels right.',
                    "source_character": source_character.upper(),
                    "target_character": target_character.upper(),
                    "correction": correction,
                    "latest_run_id": run_id,
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
                )
            )
        return GlyphBatchResponse(
            backend_version=get_backend_version(),
            source_character=source_character.upper(),
            target_characters=target_characters,
            accepted_run_id=accepted_run_id,
            items=items,
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

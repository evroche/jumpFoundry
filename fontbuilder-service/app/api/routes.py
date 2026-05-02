import base64
import io
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from PIL import Image

from app.core.config import get_backend_version
from app.schemas.glyph import (
    AsyncRevisionBatchRequest,
    AsyncRevisionBatchResponse,
    FontPackageExportRequest,
    FontSessionEditRequest,
    FontSessionCreateRequest,
    FontSessionResponse,
    FontSessionUpdateRequest,
    GlyphBatchResponse,
    GlyphGenerationResponse,
    GlyphNormalizationResponse,
    GlyphOutlineExportRequest,
    PunctuationGlyphPreviewItem,
    PunctuationGlyphPreviewResponse,
    GlyphVectorizationResponse,
    PartialFontExportRequest,
    SkeletonPreviewRequest,
    SkeletonPreviewResponse,
)
from app.services.async_revision_jobs import AsyncRevisionJobService
from app.services.file_storage import RunStorage
from app.services.font_export import build_font_package_zip, build_partial_ttf
from app.services.outline_export import build_outline_svg_zip, normalize_glyph_images
from app.services.orchestrator import GenerationOrchestrator
from app.services.skeleton_renderer import render_skeleton_preview
from app.services.vectorizer import vectorize_centerline_and_render

router = APIRouter()
orchestrator = GenerationOrchestrator()
storage = RunStorage()
revision_jobs = AsyncRevisionJobService(storage=storage, orchestrator=orchestrator)
LETTER_GLYPHS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
DIGIT_GLYPHS = set("0123456789")
AI_GENERATED_PUNCTUATION_GLYPHS = {"!", "@", "#", "$", "%", "&", "(", ")", "-", "/", "?"}
DETERMINISTIC_PUNCTUATION_GLYPHS = {"^", "*", ":", ";", ".", ",", "'", "\""}
LEGACY_EXTRA_GLYPHS = {"\\"}
EXTRA_GLYPHS = AI_GENERATED_PUNCTUATION_GLYPHS | DETERMINISTIC_PUNCTUATION_GLYPHS | LEGACY_EXTRA_GLYPHS
SUPPORTED_GLYPHS = LETTER_GLYPHS | DIGIT_GLYPHS | EXTRA_GLYPHS
PUNCTUATION_ASSET_FILENAMES = {
    "^": "caret.png",
    ":": "colon.png",
    ";": "semicolon.png",
    ".": "period.png",
    ",": "comma.png",
    "'": "apostrophe.png",
    '"': "quote.png",
    "*": "asterix.png",
}
PUNCTUATION_FALLBACK_ASSET_FILENAMES = {
    '"': "doubleQuote.png",
}
PUNCTUATION_SOURCE_SCALE = {
    "^": 0.68,
    ":": 0.68,
    ";": 0.68,
    ".": 0.68,
    ",": 0.68,
    "'": 0.68,
    '"': 0.68,
    "*": 0.74,
}


def _set_no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"


def _build_session_response(session_id: str, session: dict, frontend_url: str | None = None) -> FontSessionResponse:
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=frontend_url or f"http://127.0.0.1:5174/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
        correction=session.get("correction", ""),
        latest_run_id=session.get("latest_run_id", ""),
        skeleton_image_data_url=session.get("skeleton_image_data_url", ""),
        structural_mode=session.get("structural_mode", "stroke-path"),
        selected_revision_characters=session.get("selected_revision_characters", []),
        font_name=session.get("font_name", ""),
        current_drawing_image_data_url=session.get("current_drawing_image_data_url", ""),
        seed_references=session.get("seed_references", []),
        batch_run_ids=session.get("batch_run_ids", []),
        pending_revision_characters=session.get("pending_revision_characters", []),
        active_revision_job_id=session.get("active_revision_job_id", ""),
        export_glyph_overrides=session.get("export_glyph_overrides", []),
        normalized_glyphs=session.get("normalized_glyphs", []),
        font_file_data_url=session.get("font_file_data_url", ""),
    )


def _assets_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "assets"


def _data_url_for_bytes(image_bytes: bytes, media_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _sanitize_punctuation_image(image: Image.Image) -> Image.Image:
    sanitized = image.convert("RGBA")
    pixels = sanitized.load()
    for y in range(sanitized.height):
        for x in range(sanitized.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            if red >= 240 and green >= 240 and blue >= 240:
                pixels[x, y] = (255, 255, 255, 0)
                continue
            pixels[x, y] = (17, 17, 17, alpha)
    return sanitized


def _load_builtin_punctuation_image(character: str) -> Image.Image:
    assets_dir = _assets_dir()
    asset_name = PUNCTUATION_ASSET_FILENAMES.get(character)
    if not asset_name:
        raise FileNotFoundError(f"No punctuation asset mapping exists for {character!r}.")

    asset_path = assets_dir / asset_name
    if asset_path.exists():
        return _sanitize_punctuation_image(Image.open(io.BytesIO(asset_path.read_bytes())))

    fallback_asset_name = PUNCTUATION_FALLBACK_ASSET_FILENAMES.get(character)
    if fallback_asset_name:
        fallback_asset_path = assets_dir / fallback_asset_name
        if fallback_asset_path.exists():
            return _sanitize_punctuation_image(Image.open(io.BytesIO(fallback_asset_path.read_bytes())))

    if character != '"':
        raise FileNotFoundError(f"Punctuation asset not found at {asset_path}.")

    apostrophe_path = assets_dir / PUNCTUATION_ASSET_FILENAMES["'"]
    if not apostrophe_path.exists():
        raise FileNotFoundError(f'Neither quote asset nor apostrophe asset was found in {assets_dir}.')

    apostrophe = _sanitize_punctuation_image(Image.open(io.BytesIO(apostrophe_path.read_bytes())))
    bbox = apostrophe.getbbox()
    if bbox is None:
        raise FileNotFoundError(f"Apostrophe asset at {apostrophe_path} is empty.")

    mark = apostrophe.crop(bbox)
    canvas = Image.new("RGBA", apostrophe.size, (0, 0, 0, 0))
    left_x = max(0, int(round(canvas.width * 0.32 - mark.width / 2)))
    right_x = min(canvas.width - mark.width, int(round(canvas.width * 0.68 - mark.width / 2)))
    top_y = max(0, bbox[1])
    canvas.alpha_composite(mark, dest=(left_x, top_y))
    canvas.alpha_composite(mark, dest=(right_x, top_y))
    return canvas


def _encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _normalize_builtin_punctuation_image(character: str) -> bytes:
    source = _load_builtin_punctuation_image(character)
    bbox = source.getbbox()
    if bbox is None:
        raise FileNotFoundError(f"Punctuation asset for {character!r} is empty.")

    mark = source.crop(bbox)
    scale = PUNCTUATION_SOURCE_SCALE.get(character, 0.68)
    scaled_width = max(1, int(round(mark.width * scale)))
    scaled_height = max(1, int(round(mark.height * scale)))
    scaled_mark = mark.resize((scaled_width, scaled_height), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", source.size, (255, 255, 255, 0))
    center_x = (bbox[0] + bbox[2]) / 2
    left_x = int(round(center_x - scaled_width / 2))
    left_x = max(0, min(canvas.width - scaled_width, left_x))

    if character in {".", ","}:
        baseline_y = bbox[3]
        top_y = int(round(baseline_y - scaled_height))
    elif character in {"'", '"'}:
        top_y = bbox[1]
    elif character == "*":
        center_y = (bbox[1] + bbox[3]) / 2
        top_y = int(round(center_y - scaled_height / 2))
    else:
        top_y = bbox[1]

    top_y = max(0, min(canvas.height - scaled_height, top_y))
    canvas.alpha_composite(scaled_mark, dest=(left_x, top_y))
    return _encode_png(canvas)


def _build_builtin_punctuation_items() -> list[PunctuationGlyphPreviewItem]:
    items: list[PunctuationGlyphPreviewItem] = []
    for character in ["^", "*", ":", ";", '"', "'", ".", ","]:
        try:
            image_bytes = _normalize_builtin_punctuation_image(character)
        except FileNotFoundError:
            continue
        interpreted_vector_data_url, final_render_data_url = vectorize_centerline_and_render(
            image_bytes,
            brush_size=16,
            crop_final_render_to_bounds=False,
        )
        items.append(
            PunctuationGlyphPreviewItem(
                character=character,
                image_data_url=_data_url_for_bytes(image_bytes),
                interpreted_vector_data_url=interpreted_vector_data_url,
                final_render_data_url=final_render_data_url,
            )
        )
    if not items:
        raise FileNotFoundError(f"No built-in punctuation assets were found in {_assets_dir()}.")
    return items


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/v1/punctuation-glyphs", response_model=PunctuationGlyphPreviewResponse)
async def get_punctuation_glyphs() -> PunctuationGlyphPreviewResponse:
    try:
        items = await run_in_threadpool(_build_builtin_punctuation_items)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return PunctuationGlyphPreviewResponse(
        backend_version=get_backend_version(),
        items=items,
    )


@router.post("/api/v1/sessions", response_model=FontSessionResponse)
async def create_session(payload: FontSessionCreateRequest, response: Response) -> FontSessionResponse:
    _set_no_store(response)
    session_id = storage.create_session()
    session = storage.read_session(session_id) or {}
    frontend_base_url = payload.frontend_base_url.rstrip("/")
    return _build_session_response(session_id, session, f"{frontend_base_url}/session/{session_id}")


@router.get("/api/v1/sessions/{session_id}", response_model=FontSessionResponse)
async def get_session(session_id: str, response: Response) -> FontSessionResponse:
    _set_no_store(response)
    session = storage.read_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_session_response(session_id, session)


@router.patch("/api/v1/sessions/{session_id}", response_model=FontSessionResponse)
async def update_session(session_id: str, payload: FontSessionUpdateRequest, response: Response) -> FontSessionResponse:
    _set_no_store(response)
    session = storage.update_session(session_id, payload.model_dump())
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_session_response(session_id, session)


@router.post("/api/v1/sessions/{session_id}/approve", response_model=FontSessionResponse)
async def approve_session(session_id: str, response: Response) -> FontSessionResponse:
    _set_no_store(response)
    session = storage.approve_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_session_response(session_id, session)


@router.post("/api/v1/sessions/{session_id}/edit-request", response_model=FontSessionResponse)
async def request_session_edit(session_id: str, payload: FontSessionEditRequest, response: Response) -> FontSessionResponse:
    _set_no_store(response)
    session = storage.request_session_edit(session_id, payload.selected_revision_characters)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_session_response(session_id, session)


@router.post("/api/v1/sessions/{session_id}/revision-batch", response_model=AsyncRevisionBatchResponse)
async def create_async_revision_batch(
    session_id: str,
    payload: AsyncRevisionBatchRequest,
    response: Response,
) -> AsyncRevisionBatchResponse:
    _set_no_store(response)
    correction = payload.correction.strip()
    if not correction:
        raise HTTPException(status_code=400, detail="correction must be non-empty")

    session = storage.read_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if len(session.get("seed_references", []) or []) < 2:
        raise HTTPException(status_code=400, detail="Both seed letters are required before revisions can start")

    target_characters = []
    for character in payload.target_characters:
        normalized = (character[:1] or "").upper()
        if normalized in SUPPORTED_GLYPHS and normalized not in target_characters:
            target_characters.append(normalized)
    if not target_characters:
        raise HTTPException(status_code=400, detail="target_characters must contain at least one supported glyph")

    try:
        job_id, instruction, accepted_targets = revision_jobs.submit_revision_batch(
            session_id=session_id,
            correction=correction,
            target_characters=target_characters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return AsyncRevisionBatchResponse(
        backend_version=get_backend_version(),
        session_id=session_id,
        job_id=job_id,
        status="generating_batch",
        instruction=instruction,
        target_characters=accepted_targets,
    )


@router.post("/api/v1/skeleton-preview", response_model=SkeletonPreviewResponse)
async def create_skeleton_preview(payload: SkeletonPreviewRequest) -> SkeletonPreviewResponse:
    if len(payload.source_character) != 1:
        raise HTTPException(status_code=400, detail="source_character must be a single character")
    if len(payload.target_character) != 1:
        raise HTTPException(status_code=400, detail="target_character must be a single character")

    try:
        skeleton_image_data_url = await run_in_threadpool(
            render_skeleton_preview,
            payload.drawing,
            structural_mode=payload.structural_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    stroke_count = len(payload.drawing.strokes)
    point_count = sum(len(stroke.points) for stroke in payload.drawing.strokes)
    session = storage.update_session(
        payload.session_id,
        {
            "status": "ready",
            "stage": "draw",
            "instruction": "Review the structural skeleton before I generate the next glyph.",
            "source_character": payload.source_character.upper(),
            "target_character": payload.target_character.upper(),
            "skeleton_image_data_url": skeleton_image_data_url,
            "structural_mode": payload.structural_mode,
        },
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return SkeletonPreviewResponse(
        backend_version=get_backend_version(),
        session_id=payload.session_id,
        structural_mode=payload.structural_mode,
        source_character=payload.source_character.upper(),
        target_character=payload.target_character.upper(),
        skeleton_image_data_url=skeleton_image_data_url,
        stroke_count=stroke_count,
        point_count=point_count,
    )


@router.post("/api/v1/vectorize-preview", response_model=GlyphVectorizationResponse)
async def vectorize_preview(
    glyph_image: UploadFile = File(...),
    brush_size: int = Form(16),
) -> GlyphVectorizationResponse:
    image_bytes = await glyph_image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="glyph_image must be non-empty")

    try:
        interpreted_vector_data_url, final_render_data_url = await run_in_threadpool(
            vectorize_centerline_and_render,
            image_bytes,
            brush_size=brush_size,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return GlyphVectorizationResponse(
        backend_version=get_backend_version(),
        interpreted_vector_data_url=interpreted_vector_data_url,
        final_render_data_url=final_render_data_url,
    )


@router.post("/api/v1/generate", response_model=GlyphGenerationResponse)
async def generate_run(
    reference_glyph: UploadFile = File(...),
    second_reference_glyph: UploadFile | None = File(None),
    source_character: str = Form(...),
    second_source_character: str = Form(""),
    target_character: str = Form(...),
    correction: str = Form(""),
    previous_run_id: str = Form(""),
    session_id: str = Form(""),
    generation_mode: str = Form("final"),
    brush_size: int = Form(16),
) -> GlyphGenerationResponse:
    if len(source_character) != 1:
        raise HTTPException(status_code=400, detail="source_character must be a single character")
    if len(target_character) != 1:
        raise HTTPException(status_code=400, detail="target_character must be a single character")

    reference_bytes = await reference_glyph.read()
    additional_reference_images: list[tuple[bytes, str]] = []
    additional_source_characters: list[str] = []
    if second_reference_glyph is not None:
        second_reference_bytes = await second_reference_glyph.read()
        if second_reference_bytes:
            additional_reference_images.append(
                (
                    second_reference_bytes,
                    second_reference_glyph.content_type or "image/png",
                )
            )
            if second_source_character.strip():
                additional_source_characters.append(second_source_character.strip())
    try:
        return await run_in_threadpool(
            orchestrator.generate,
            reference_filename=reference_glyph.filename or "reference_glyph.png",
            reference_media_type=reference_glyph.content_type or "image/png",
            reference_bytes=reference_bytes,
            source_character=source_character,
            target_character=target_character,
            correction=correction.strip(),
            previous_run_id=previous_run_id.strip(),
            session_id=session_id.strip(),
            generation_mode=generation_mode.strip() or "final",
            brush_size=brush_size,
            additional_reference_images=additional_reference_images,
            additional_source_characters=additional_source_characters,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/api/v1/generate-many", response_model=GlyphBatchResponse)
async def generate_many(
    reference_glyph: UploadFile = File(...),
    source_character: str = Form(...),
    target_characters: str = Form(...),
    accepted_run_id: str = Form(""),
    correction: str = Form(""),
) -> GlyphBatchResponse:
    reference_bytes = await reference_glyph.read()
    targets = [item.strip().upper() for item in target_characters.split(",") if item.strip()]
    if len(source_character) != 1:
        raise HTTPException(status_code=400, detail="source_character must be a single character")
    if not targets:
        raise HTTPException(status_code=400, detail="target_characters must contain at least one target")
    try:
        return await run_in_threadpool(
            orchestrator.generate_many,
            reference_filename=reference_glyph.filename or "reference_glyph.png",
            reference_media_type=reference_glyph.content_type or "image/png",
            reference_bytes=reference_bytes,
            source_character=source_character,
            target_characters=targets,
            accepted_run_id=accepted_run_id.strip(),
            correction=correction.strip(),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/api/v1/runs/{run_id}", response_model=GlyphGenerationResponse)
async def get_run(run_id: str, response: Response) -> GlyphGenerationResponse:
    _set_no_store(response)
    run = orchestrator.load_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.post("/api/v1/export-outline-set")
async def export_outline_set(payload: GlyphOutlineExportRequest) -> StreamingResponse:
    if not payload.glyphs:
        raise HTTPException(status_code=400, detail="glyphs must contain at least one item")
    archive_bytes = await run_in_threadpool(
        build_outline_svg_zip,
        [item.model_dump() for item in payload.glyphs],
    )
    filename = f"jumpfoundry-outline-set-{payload.session_id or 'export'}.zip"
    return StreamingResponse(
        io.BytesIO(archive_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/v1/normalize-glyph-set", response_model=GlyphNormalizationResponse)
async def normalize_glyph_set(payload: GlyphOutlineExportRequest) -> GlyphNormalizationResponse:
    if not payload.glyphs:
        raise HTTPException(status_code=400, detail="glyphs must contain at least one item")
    return GlyphNormalizationResponse(
        backend_version=get_backend_version(),
        session_id=payload.session_id,
        glyphs=await run_in_threadpool(
            normalize_glyph_images,
            [item.model_dump() for item in payload.glyphs],
        ),
    )


@router.post("/api/v1/export-partial-font")
async def export_partial_font(payload: PartialFontExportRequest) -> StreamingResponse:
    if not payload.glyphs:
        raise HTTPException(status_code=400, detail="glyphs must contain at least one item")
    font_bytes = await run_in_threadpool(
        build_partial_ttf,
        [item.model_dump() for item in payload.glyphs],
        payload.family_name,
        payload.style_name,
        payload.weight_class,
    )
    filename = f"{(payload.family_name.strip() or 'jumpfoundry').replace(' ', '-')}-{(payload.style_name.strip() or 'Regular').replace(' ', '-')}.ttf"
    return StreamingResponse(
        io.BytesIO(font_bytes),
        media_type="font/ttf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/v1/export-font-package")
async def export_font_package(payload: FontPackageExportRequest) -> StreamingResponse:
    if not payload.variants:
        raise HTTPException(status_code=400, detail="variants must contain at least one font variant")
    package_bytes = await run_in_threadpool(
        build_font_package_zip,
        [
            {
                "style_name": variant.style_name,
                "weight_class": variant.weight_class,
                "glyphs": [item.model_dump() for item in variant.glyphs],
            }
            for variant in payload.variants
        ],
        payload.family_name,
    )
    filename = f"{(payload.family_name.strip() or 'jumpfoundry').replace(' ', '-')}.zip"
    return StreamingResponse(
        io.BytesIO(package_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

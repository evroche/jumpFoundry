from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.config import get_backend_version
from app.schemas.glyph import (
    FontSessionCreateRequest,
    FontSessionResponse,
    FontSessionUpdateRequest,
    GlyphBatchResponse,
    GlyphGenerationResponse,
)
from app.services.file_storage import RunStorage
from app.services.orchestrator import GenerationOrchestrator

router = APIRouter()
orchestrator = GenerationOrchestrator()
storage = RunStorage()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/v1/sessions", response_model=FontSessionResponse)
async def create_session(payload: FontSessionCreateRequest) -> FontSessionResponse:
    session_id = storage.create_session()
    session = storage.read_session(session_id) or {}
    frontend_base_url = payload.frontend_base_url.rstrip("/")
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=f"{frontend_base_url}/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
    )


@router.get("/api/v1/sessions/{session_id}", response_model=FontSessionResponse)
async def get_session(session_id: str) -> FontSessionResponse:
    session = storage.read_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=f"http://127.0.0.1:5174/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
    )


@router.patch("/api/v1/sessions/{session_id}", response_model=FontSessionResponse)
async def update_session(session_id: str, payload: FontSessionUpdateRequest) -> FontSessionResponse:
    session = storage.update_session(session_id, payload.model_dump())
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=f"http://127.0.0.1:5174/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
    )


@router.post("/api/v1/sessions/{session_id}/approve", response_model=FontSessionResponse)
async def approve_session(session_id: str) -> FontSessionResponse:
    session = storage.approve_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=f"http://127.0.0.1:5174/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
    )


@router.post("/api/v1/sessions/{session_id}/edit-request", response_model=FontSessionResponse)
async def request_session_edit(session_id: str) -> FontSessionResponse:
    session = storage.request_session_edit(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return FontSessionResponse(
        session_id=session_id,
        backend_version=get_backend_version(),
        frontend_url=f"http://127.0.0.1:5174/session/{session_id}",
        status=session.get("status", "ready"),
        stage=session.get("stage", "draw"),
        instruction=session.get("instruction", ""),
        source_character=session.get("source_character", "A"),
        target_character=session.get("target_character", "B"),
    )


@router.post("/api/v1/generate", response_model=GlyphGenerationResponse)
async def generate_run(
    reference_glyph: UploadFile = File(...),
    source_character: str = Form(...),
    target_character: str = Form(...),
    correction: str = Form(""),
    previous_run_id: str = Form(""),
    session_id: str = Form(""),
) -> GlyphGenerationResponse:
    if len(source_character) != 1:
        raise HTTPException(status_code=400, detail="source_character must be a single character")
    if len(target_character) != 1:
        raise HTTPException(status_code=400, detail="target_character must be a single character")

    reference_bytes = await reference_glyph.read()
    try:
        return orchestrator.generate(
            reference_filename=reference_glyph.filename or "reference_glyph.png",
            reference_media_type=reference_glyph.content_type or "image/png",
            reference_bytes=reference_bytes,
            source_character=source_character,
            target_character=target_character,
            correction=correction.strip(),
            previous_run_id=previous_run_id.strip(),
            session_id=session_id.strip(),
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
        return orchestrator.generate_many(
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

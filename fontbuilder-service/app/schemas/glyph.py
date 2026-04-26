from pydantic import BaseModel
from typing import Literal


class GlyphAnalysis(BaseModel):
    detected_character: str
    confidence: float
    style_summary: str
    must_preserve: list[str]
    must_avoid: list[str]


class DebugEntry(BaseModel):
    step: str
    payload: dict


class GlyphGenerationResponse(BaseModel):
    run_id: str
    backend_version: str
    source_character: str
    target_character: str
    correction: str = ""
    suggested_revision: str = ""
    generated_image_data_url: str
    analysis: GlyphAnalysis | None = None
    debug: list[DebugEntry] = []


class GlyphBatchResponse(BaseModel):
    backend_version: str
    source_character: str
    target_characters: list[str]
    accepted_run_id: str = ""
    items: list[GlyphGenerationResponse]


class FontSessionCreateRequest(BaseModel):
    frontend_base_url: str = "http://127.0.0.1:5174"


class FontSessionResponse(BaseModel):
    session_id: str
    backend_version: str
    frontend_url: str
    status: str = "ready"
    stage: Literal["draw", "review"] = "draw"
    instruction: str = "Start by drawing one letter. We'll use it to generate the rest of the typeface."
    source_character: str = "A"
    target_character: str = "B"


class FontSessionUpdateRequest(BaseModel):
    stage: Literal["draw", "review"] | None = None
    instruction: str | None = None
    source_character: str | None = None
    target_character: str | None = None
    correction: str | None = None
    latest_run_id: str | None = None

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
    interpreted_vector_data_url: str = ""
    final_render_data_url: str = ""
    analysis: GlyphAnalysis | None = None
    debug: list[DebugEntry] = []


class GlyphBatchResponse(BaseModel):
    backend_version: str
    source_character: str
    target_characters: list[str]
    accepted_run_id: str = ""
    items: list[GlyphGenerationResponse]


StructuralMode = Literal["stroke-path", "contour-outline"]


class VectorPoint(BaseModel):
    x: float
    y: float


class VectorStroke(BaseModel):
    points: list[VectorPoint]
    brush_size: int
    brush_label: str


class VectorDrawingData(BaseModel):
    canvas_size: int
    brush_size: int
    brush_label: str
    strokes: list[VectorStroke]


class SkeletonPreviewRequest(BaseModel):
    session_id: str
    source_character: str
    target_character: str
    structural_mode: StructuralMode = "stroke-path"
    drawing: VectorDrawingData


class SkeletonPreviewResponse(BaseModel):
    backend_version: str
    session_id: str
    stage: Literal["skeleton_preview"] = "skeleton_preview"
    structural_mode: StructuralMode
    source_character: str
    target_character: str
    skeleton_image_data_url: str
    stroke_count: int
    point_count: int


class FontSessionCreateRequest(BaseModel):
    frontend_base_url: str = "http://127.0.0.1:5174"


class FontSessionResponse(BaseModel):
    session_id: str
    backend_version: str
    frontend_url: str
    status: str = "ready"
    stage: Literal["draw", "skeleton_preview", "review"] = "draw"
    instruction: str = "Start by drawing one letter. We'll use it to generate the rest of the typeface."
    source_character: str = "A"
    target_character: str = "B"
    skeleton_image_data_url: str = ""
    structural_mode: StructuralMode = "stroke-path"


class FontSessionUpdateRequest(BaseModel):
    stage: Literal["draw", "skeleton_preview", "review"] | None = None
    instruction: str | None = None
    source_character: str | None = None
    target_character: str | None = None
    correction: str | None = None
    latest_run_id: str | None = None
    skeleton_image_data_url: str | None = None
    structural_mode: StructuralMode | None = None
    status: str | None = None

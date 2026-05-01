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


class GlyphOutlineExportItem(BaseModel):
    character: str
    image_data_url: str


class SessionSeedReference(BaseModel):
    character: str
    image_data_url: str


class GlyphOutlineExportRequest(BaseModel):
    session_id: str = ""
    glyphs: list[GlyphOutlineExportItem]


class PartialFontExportRequest(BaseModel):
    session_id: str = ""
    glyphs: list[GlyphOutlineExportItem]
    family_name: str = "JumpFoundry Test"
    style_name: str = "Regular"
    weight_class: int = 400


class FontPackageVariantRequest(BaseModel):
    style_name: str
    weight_class: int
    glyphs: list[GlyphOutlineExportItem]


class FontPackageExportRequest(BaseModel):
    session_id: str = ""
    family_name: str = "JumpFoundry Test"
    variants: list[FontPackageVariantRequest]


class GlyphNormalizationResponse(BaseModel):
    backend_version: str
    session_id: str = ""
    glyphs: list[GlyphOutlineExportItem]


class GlyphVectorizationResponse(BaseModel):
    backend_version: str
    interpreted_vector_data_url: str
    final_render_data_url: str


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
    instruction: str = "Start by drawing two sample letters. I'll use them to build the rest of your font.\n\nGo ahead and draw the first letter \"E\". Let me know when you're done."
    source_character: str = "E"
    target_character: str = "E"
    correction: str = ""
    latest_run_id: str = ""
    skeleton_image_data_url: str = ""
    structural_mode: StructuralMode = "stroke-path"
    selected_revision_characters: list[str] = []
    font_name: str = ""
    current_drawing_image_data_url: str = ""
    seed_references: list[SessionSeedReference] = []
    batch_run_ids: list[str] = []
    pending_revision_characters: list[str] = []
    active_revision_job_id: str = ""
    export_glyph_overrides: list[GlyphOutlineExportItem] = []
    normalized_glyphs: list[GlyphOutlineExportItem] = []
    font_file_data_url: str = ""


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
    selected_revision_characters: list[str] | None = None
    font_name: str | None = None
    current_drawing_image_data_url: str | None = None
    seed_references: list[SessionSeedReference] | None = None
    batch_run_ids: list[str] | None = None
    pending_revision_characters: list[str] | None = None
    active_revision_job_id: str | None = None
    export_glyph_overrides: list[GlyphOutlineExportItem] | None = None
    normalized_glyphs: list[GlyphOutlineExportItem] | None = None
    font_file_data_url: str | None = None


class FontSessionEditRequest(BaseModel):
    selected_revision_characters: list[str] = []


class AsyncRevisionBatchRequest(BaseModel):
    correction: str
    target_characters: list[str] = []


class AsyncRevisionBatchResponse(BaseModel):
    backend_version: str
    session_id: str
    job_id: str
    status: str = "generating_batch"
    instruction: str = ""
    target_characters: list[str] = []

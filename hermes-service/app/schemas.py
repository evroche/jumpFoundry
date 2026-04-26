from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: list[dict] = Field(default_factory=list)
    context: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    reply: str
    history: list[dict] = Field(default_factory=list)
    ui_actions: list[dict] = Field(default_factory=list)


class MoodboardPlanRequest(BaseModel):
    theme: str = Field(min_length=2)
    max_asset_count: int = Field(default=8, ge=4, le=12)
    force_hermes: bool = False


class MoodboardSearchTarget(BaseModel):
    query: str
    why: str
    optional_cutout_targets: list[str] = Field(default_factory=list)


class MoodboardReferenceBucket(BaseModel):
    bucket: str
    rationale: str
    targets: list[MoodboardSearchTarget]


class MoodboardPlan(BaseModel):
    theme: str
    direction: str
    aesthetic_keywords: list[str]
    reference_buckets: list[MoodboardReferenceBucket]
    search_targets: list[str]
    must_have_assets: list[str]
    optional_assets: list[str]
    composition_intent: str
    max_asset_count: int
    planner: str = "fallback"


class MoodboardPlanResponse(BaseModel):
    status: str
    plan: MoodboardPlan
    debug: dict[str, Any] = Field(default_factory=dict)


class SemanticSwapFeature(BaseModel):
    feature_id: str
    label: str
    bbox: list[int] = Field(min_length=4, max_length=4)


class SemanticSwapPlanRequest(BaseModel):
    theme: str = Field(min_length=2)
    features: list[SemanticSwapFeature] = Field(default_factory=list)


class SemanticSwapSuggestion(BaseModel):
    feature_id: str
    feature_label: str
    swap_object: str
    search_query: str
    reason: str
    placement_note: str


class SemanticSwapPlan(BaseModel):
    theme: str
    direction: str
    suggestions: list[SemanticSwapSuggestion]
    planner: str = "fallback"


class SemanticSwapPlanResponse(BaseModel):
    status: str
    plan: SemanticSwapPlan
    debug: dict[str, Any] = Field(default_factory=dict)


class ProductMoodboardSeed(BaseModel):
    url: str
    title: str = ""
    description: str = ""
    source_domain: str = ""
    image_url: str | None = None


class ProductMoodboardEnhanceRequest(BaseModel):
    products: list[ProductMoodboardSeed] = Field(default_factory=list)
    max_asset_count: int = Field(default=10, ge=1, le=20)
    prompt: str = ""


class ProductMoodboardRecommendation(BaseModel):
    query: str
    why: str
    category: str


class ProductMoodboardPlan(BaseModel):
    direction: str
    seed_summary: list[str]
    recommendations: list[ProductMoodboardRecommendation]
    planner: str = "fallback"


class ProductMoodboardPlanResponse(BaseModel):
    status: str
    plan: ProductMoodboardPlan
    debug: dict[str, Any] = Field(default_factory=dict)

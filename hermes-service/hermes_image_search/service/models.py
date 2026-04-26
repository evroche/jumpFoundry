from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ImageSearchRequest(BaseModel):
    query: str
    max_results: int = Field(default=20, ge=1, le=50)
    sites: list[str] = Field(default_factory=list)
    site_mode: Literal["prefer", "require"] = "prefer"


class ImageCandidate(BaseModel):
    candidate_id: str
    position: int
    title: str | None = None
    source_domain: str | None = None
    source_page_url: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None
    width: int | None = None
    height: int | None = None


class SearchResultBundle(BaseModel):
    provider: Literal["serpapi_google_images"]
    query: str
    candidates: list[ImageCandidate]
    raw_count: int
    ignored_sites: list[str] = Field(default_factory=list)

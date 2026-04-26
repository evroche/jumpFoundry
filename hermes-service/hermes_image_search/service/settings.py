from __future__ import annotations

import os

from pydantic import BaseModel


class Settings(BaseModel):
    serpapi_api_key: str
    serpapi_base_url: str = "https://serpapi.com/search.json"
    default_google_domain: str = "google.com"
    default_gl: str = "us"
    default_hl: str = "en"
    default_safe: str = "active"


def get_settings() -> Settings:
    key = os.getenv("SERPAPI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("SERPAPI_API_KEY is not set")
    return Settings(serpapi_api_key=key)

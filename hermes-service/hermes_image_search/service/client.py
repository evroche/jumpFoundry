from __future__ import annotations

import httpx

from .settings import get_settings


def fetch_serpapi_google_images(query: str, page: int = 0) -> dict:
    settings = get_settings()
    params = {
        "engine": "google_images",
        "q": query,
        "api_key": settings.serpapi_api_key,
        "google_domain": settings.default_google_domain,
        "gl": settings.default_gl,
        "hl": settings.default_hl,
        "safe": settings.default_safe,
        "ijn": page,
    }

    with httpx.Client(
        timeout=30.0,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
        },
    ) as client:
        response = client.get(settings.serpapi_base_url, params=params)
        response.raise_for_status()
        return response.json()

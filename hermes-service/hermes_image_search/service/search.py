from __future__ import annotations

from .client import fetch_serpapi_google_images
from .models import ImageSearchRequest, SearchResultBundle
from .normalize import normalize_candidates


def search_images(req: ImageSearchRequest) -> SearchResultBundle:
    items: list[dict] = []
    page = 0

    while len(items) < req.max_results:
        raw_page = fetch_serpapi_google_images(req.query, page=page)
        page_items = raw_page.get("images_results", [])
        if not page_items:
            break
        items.extend(page_items)
        if len(page_items) >= req.max_results:
            break
        page += 1

    raw = {"images_results": items}
    candidates = normalize_candidates(raw, req.max_results)

    return SearchResultBundle(
        provider="serpapi_google_images",
        query=req.query,
        candidates=candidates,
        raw_count=len(raw.get("images_results", [])),
        ignored_sites=req.sites,
    )

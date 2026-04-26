from __future__ import annotations

from urllib.parse import urlparse

from .models import ImageCandidate


def _coerce_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_url(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        candidate = value.get("src") or value.get("url")
        if isinstance(candidate, str):
            return candidate
    return None


def normalize_candidates(raw: dict, max_results: int) -> list[ImageCandidate]:
    rows = raw.get("images_results", [])[:max_results]
    out: list[ImageCandidate] = []

    for row in rows:
        source_page_url = row.get("link")
        image_url = _extract_url(row.get("original")) or _extract_url(row.get("image_url"))
        thumbnail_url = _extract_url(row.get("thumbnail")) or image_url
        domain = None
        if source_page_url:
            try:
                domain = urlparse(source_page_url).netloc
            except Exception:
                domain = None

        out.append(
            ImageCandidate(
                candidate_id=f"img_{len(out) + 1}",
                position=len(out) + 1,
                title=row.get("title"),
                source_domain=domain,
                source_page_url=source_page_url,
                thumbnail_url=thumbnail_url,
                image_url=image_url,
                width=_coerce_int(row.get("original_width") or row.get("width")),
                height=_coerce_int(row.get("original_height") or row.get("height")),
            )
        )

    return out

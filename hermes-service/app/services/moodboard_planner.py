from __future__ import annotations

import json
import logging
import re
import time

import httpx
from pydantic import ValidationError

from app.schemas import (
    MoodboardPlan,
    MoodboardPlanRequest,
    MoodboardReferenceBucket,
    MoodboardSearchTarget,
)
from app.services.hermes_client import HermesClient

logger = logging.getLogger(__name__)


PLANNER_PROMPT = """
You are a visual research planner for a moodboard builder.

Return only valid JSON matching this shape:
{
  "theme": "...",
  "direction": "...",
  "aesthetic_keywords": ["..."],
  "reference_buckets": [
    {
      "bucket": "fashion",
      "rationale": "...",
      "targets": [
        {
          "query": "specific search query",
          "why": "why this target supports the theme",
          "optional_cutout_targets": ["woman", "shoe"]
        }
      ]
    }
  ],
  "search_targets": ["..."],
  "must_have_assets": ["..."],
  "optional_assets": ["..."],
  "composition_intent": "...",
  "max_asset_count": 8
}

Rules:
- Prefer named products, brands, designers, artists, eras, subcultures, and materials.
- Include at least 3 named references.
- Include at least 2 named objects/products.
- Include at least 1 brand/designer/artist reference.
- Include at least 1 era/subculture/style signal.
- Include at least 1 material/finish/surface-language set.
- Produce 4 to 6 reference buckets.
- Produce 1 to 3 search targets per bucket.
- Do not search the web. Generate a research plan only.
""".strip()


class MoodboardPlanner:
    def __init__(self, hermes: HermesClient) -> None:
        self._hermes = hermes

    def generate(self, req: MoodboardPlanRequest) -> tuple[MoodboardPlan, dict]:
        hermes_plan, debug = self._generate_with_hermes(req)
        if hermes_plan is not None:
            hermes_plan = _normalize_plan(hermes_plan, req)
            hermes_plan.planner = "hermes"
            logger.info("moodboard planner used Hermes: %s", debug)
            return hermes_plan, debug
        if req.force_hermes:
            logger.warning("moodboard planner forced Hermes failed: %s", debug)
            raise RuntimeError(f"Hermes planner failed: {debug.get('reason', 'unknown')}")
        fallback = _fallback_plan(req)
        debug["used_fallback"] = True
        logger.warning("moodboard planner fell back: %s", debug)
        return fallback, debug

    def _generate_with_hermes(self, req: MoodboardPlanRequest) -> tuple[MoodboardPlan | None, dict]:
        started = time.monotonic()
        debug = {
            "attempted_hermes": True,
            "used_fallback": False,
            "reason": None,
            "latency_ms": None,
        }
        status = self._hermes.status()
        debug["status"] = {
            "configured": status.configured,
            "reachable": status.reachable,
            "detail": status.detail,
        }
        if not status.configured or not status.reachable:
            debug["reason"] = "hermes_status_unavailable"
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug

        payload = {
            "model": self._hermes.settings.hermes_model_name,
            "messages": [
                {"role": "system", "content": PLANNER_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "theme": req.theme,
                            "max_asset_count": req.max_asset_count,
                        }
                    ),
                },
            ],
            "stream": False,
        }
        try:
            with self._hermes.client(timeout=45.0) as client:
                response = client.post("/chat/completions", json=payload)
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
        except httpx.TimeoutException as exc:
            debug["reason"] = "hermes_timeout"
            debug["error"] = str(exc)
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug
        except httpx.HTTPStatusError as exc:
            debug["reason"] = "hermes_http_error"
            debug["status_code"] = exc.response.status_code
            debug["error"] = exc.response.text[:500]
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            debug["reason"] = "hermes_response_error"
            debug["error"] = str(exc)
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug

        parsed = _extract_json(content)
        if not isinstance(parsed, dict):
            debug["reason"] = "hermes_non_json"
            debug["raw_preview"] = content[:500]
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug

        parsed["max_asset_count"] = req.max_asset_count
        try:
            plan = MoodboardPlan.model_validate(parsed)
        except ValidationError as exc:
            debug["reason"] = "hermes_validation_error"
            debug["error"] = str(exc)
            debug["raw_preview"] = content[:500]
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug

        debug["reason"] = "hermes_ok"
        debug["latency_ms"] = _elapsed_ms(started)
        return _normalize_plan(plan, req), debug


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    try:
        payload = json.loads(text)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
    try:
        payload = json.loads(match.group(0))
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        return None


def _fallback_plan(req: MoodboardPlanRequest) -> MoodboardPlan:
    theme = req.theme.strip()
    theme_query = re.sub(r"\s+", " ", theme)
    keywords = _fallback_keywords(theme)
    buckets = [
        MoodboardReferenceBucket(
            bucket="fashion",
            rationale="Anchor the board with a recognizable styling language rather than generic fashion imagery.",
            targets=[
                MoodboardSearchTarget(
                    query=f"Miu Miu office campaign {theme_query}",
                    why="Named brand reference for sharp, contemporary office styling.",
                    optional_cutout_targets=["woman", "shoe", "bag"],
                ),
                MoodboardSearchTarget(
                    query=f"Mugler tailoring editorial {theme_query}",
                    why="Named designer reference for aggressive silhouette and body architecture.",
                    optional_cutout_targets=["silhouette", "jacket"],
                ),
            ],
        ),
        MoodboardReferenceBucket(
            bucket="products",
            rationale="Use named objects so the board has concrete, collectible anchors.",
            targets=[
                MoodboardSearchTarget(
                    query=f"Vertu phone product photo {theme_query}",
                    why="Recognizable luxury tech object with metal-and-status language.",
                    optional_cutout_targets=["phone"],
                ),
                MoodboardSearchTarget(
                    query=f"Braun ET66 calculator product photo {theme_query}",
                    why="Specific Dieter Rams-era tech object for disciplined industrial contrast.",
                    optional_cutout_targets=["calculator"],
                ),
            ],
        ),
        MoodboardReferenceBucket(
            bucket="materials",
            rationale="Surface language gives the board texture and mood beyond objects.",
            targets=[
                MoodboardSearchTarget(
                    query=f"chrome hardware closeup patent leather texture {theme_query}",
                    why="Material/finish target for reflective, hard, luxury surfaces.",
                    optional_cutout_targets=["texture", "hardware"],
                ),
                MoodboardSearchTarget(
                    query=f"mirrored acrylic metallic surface editorial {theme_query}",
                    why="Adds a crisp reflective surface system for layering.",
                    optional_cutout_targets=["surface"],
                ),
            ],
        ),
        MoodboardReferenceBucket(
            bucket="graphics",
            rationale="Logo/type details make the board feel researched and specific.",
            targets=[
                MoodboardSearchTarget(
                    query=f"Y2K luxury technology advertisement typography {theme_query}",
                    why="Era signal and graphic language for commercial tension.",
                    optional_cutout_targets=["logo", "type"],
                )
            ],
        ),
    ]
    search_targets = [target.query for bucket in buckets for target in bucket.targets]
    return MoodboardPlan(
        theme=theme,
        direction=f"Research-led editorial moodboard for {theme}",
        aesthetic_keywords=keywords,
        reference_buckets=buckets,
        search_targets=search_targets,
        must_have_assets=[
            "one fashion/editorial silhouette",
            "one recognizable product or technology object",
            "one material or surface texture",
        ],
        optional_assets=[
            "one graphic/type/logo reference",
            "one close crop detail",
            "one archival or advertising reference",
        ],
        composition_intent="Pinned layered editorial board with mixed scale, loose overlap, and one clear visual anchor.",
        max_asset_count=req.max_asset_count,
        planner="fallback",
    )


def _normalize_plan(plan: MoodboardPlan, req: MoodboardPlanRequest) -> MoodboardPlan:
    min_targets = _minimum_target_count(req.max_asset_count)
    deduped_buckets = _dedupe_buckets(plan.reference_buckets)
    bucket_queries = [target.query for bucket in deduped_buckets for target in bucket.targets]
    search_targets = _dedupe_queries([*bucket_queries, *plan.search_targets])

    if len(search_targets) < min_targets:
        fallback_queries = _dedupe_queries(
            [target.query for bucket in _fallback_plan(req).reference_buckets for target in bucket.targets]
        )
        for query in fallback_queries:
            if len(search_targets) >= min_targets:
                break
            if query.casefold() not in {existing.casefold() for existing in search_targets}:
                search_targets.append(query)

    if len(bucket_queries) < min_targets:
        additions = []
        existing_bucket_queries = {query.casefold() for query in bucket_queries}
        for query in search_targets:
            if len(bucket_queries) + len(additions) >= min_targets:
                break
            if query.casefold() in existing_bucket_queries:
                continue
            additions.append(
                MoodboardSearchTarget(
                    query=query,
                    why="Supplemental search target added to ensure the plan has enough executable references.",
                    optional_cutout_targets=[],
                )
            )
        if additions:
            deduped_buckets.append(
                MoodboardReferenceBucket(
                    bucket="supplemental",
                    rationale="Additional executable search targets added to keep the board generation sufficiently populated.",
                    targets=additions,
                )
            )

    return plan.model_copy(
        update={
            "reference_buckets": deduped_buckets,
            "search_targets": search_targets,
            "max_asset_count": req.max_asset_count,
        }
    )


def _minimum_target_count(max_asset_count: int) -> int:
    return max(4, min(max_asset_count, 8))


def _dedupe_buckets(buckets: list[MoodboardReferenceBucket]) -> list[MoodboardReferenceBucket]:
    deduped = []
    seen_queries: set[str] = set()
    for bucket in buckets:
        bucket_targets = []
        for target in bucket.targets:
            normalized = target.query.strip().casefold()
            if not normalized or normalized in seen_queries:
                continue
            seen_queries.add(normalized)
            bucket_targets.append(target)
        if bucket_targets:
            deduped.append(bucket.model_copy(update={"targets": bucket_targets}))
    return deduped


def _dedupe_queries(queries: list[str]) -> list[str]:
    out = []
    seen: set[str] = set()
    for query in queries:
        normalized = query.strip().casefold()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(query.strip())
    return out


def _fallback_keywords(theme: str) -> list[str]:
    tokens = [token for token in re.findall(r"[a-z0-9]+", theme.lower()) if len(token) > 2]
    defaults = ["specific references", "material contrast", "editorial layering", "visual provenance"]
    return [*tokens[:6], *defaults][:10]

from __future__ import annotations

import json
import re
import time

import httpx

from app.schemas import (
    SemanticSwapFeature,
    SemanticSwapPlan,
    SemanticSwapPlanRequest,
    SemanticSwapPlanResponse,
    SemanticSwapSuggestion,
)
from app.services.hermes_client import HermesClient


SWAP_PROMPT = """
You are a visual ideation planner for a semantic image-swap tool.

Return only valid JSON matching this shape:
{
  "theme": "...",
  "direction": "...",
  "suggestions": [
    {
      "feature_id": "left_eye",
      "feature_label": "left eye",
      "swap_object": "blueberry",
      "search_query": "blueberry isolated macro",
      "reason": "why this object supports the theme and feature",
      "placement_note": "how it should sit in the original image"
    }
  ]
}

Rules:
- Work from the provided theme and detected features only.
- Produce 5 to 10 suggestions when possible.
- Prefer specific, image-searchable replacement objects.
- Match the object to the region semantically and visually.
- Keep suggestions playful, concrete, and visually legible.
- Do not search the web.
""".strip()


class SemanticSwapPlanner:
    def __init__(self, hermes: HermesClient) -> None:
        self._hermes = hermes

    def generate(self, req: SemanticSwapPlanRequest) -> tuple[SemanticSwapPlan, dict]:
        plan, debug = self._generate_with_hermes(req)
        if plan is not None:
            plan = _normalize_swap_plan(plan, req)
            plan.planner = "hermes"
            return plan, debug

        fallback = _fallback_swap_plan(req)
        debug["used_fallback"] = True
        return fallback, debug

    def _generate_with_hermes(self, req: SemanticSwapPlanRequest) -> tuple[SemanticSwapPlan | None, dict]:
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
                {"role": "system", "content": SWAP_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "theme": req.theme,
                            "features": [feature.model_dump() for feature in req.features],
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
        except Exception as exc:
            debug["reason"] = "hermes_response_error"
            debug["error"] = str(exc)
            debug["latency_ms"] = _elapsed_ms(started)
            return None, debug

        parsed = _extract_json(content)
        if not isinstance(parsed, dict):
            debug["reason"] = "hermes_non_json"
            debug["latency_ms"] = _elapsed_ms(started)
            debug["raw_preview"] = content[:500]
            return None, debug

        try:
            plan = SemanticSwapPlan.model_validate(parsed)
        except Exception as exc:
            debug["reason"] = "hermes_validation_error"
            debug["latency_ms"] = _elapsed_ms(started)
            debug["error"] = str(exc)
            debug["raw_preview"] = content[:500]
            return None, debug

        debug["reason"] = "hermes_ok"
        debug["latency_ms"] = _elapsed_ms(started)
        return plan, debug


def _normalize_swap_plan(plan: SemanticSwapPlan, req: SemanticSwapPlanRequest) -> SemanticSwapPlan:
    features = {feature.feature_id: feature for feature in req.features}
    suggestions = []
    seen: set[str] = set()
    for suggestion in plan.suggestions:
        if suggestion.feature_id not in features:
            continue
        if suggestion.feature_id in seen:
            continue
        seen.add(suggestion.feature_id)
        suggestions.append(suggestion)

    if len(suggestions) < min(5, len(req.features)):
        fallback = _fallback_swap_plan(req)
        for suggestion in fallback.suggestions:
            if suggestion.feature_id in seen:
                continue
            suggestions.append(suggestion)
            seen.add(suggestion.feature_id)
            if len(suggestions) >= min(8, len(req.features)):
                break

    return plan.model_copy(update={"theme": req.theme, "suggestions": suggestions})


def _fallback_swap_plan(req: SemanticSwapPlanRequest) -> SemanticSwapPlan:
    theme = req.theme.strip()
    theme_pool = _theme_object_pool(theme)
    suggestions = []
    for index, feature in enumerate(req.features[: min(8, len(req.features))]):
        obj = theme_pool[index % len(theme_pool)]
        suggestions.append(
            SemanticSwapSuggestion(
                feature_id=feature.feature_id,
                feature_label=feature.label,
                swap_object=obj["object"],
                search_query=obj["query"],
                reason=f"{obj['object'].title()} reinforces the '{theme}' direction while staying legible at the {feature.label} region.",
                placement_note=f"Fit the replacement into the {feature.label} bounds and preserve the original orientation.",
            )
        )
    return SemanticSwapPlan(
        theme=theme,
        direction=f"Playful semantic swap direction for '{theme}' built around a single hero image and themed object replacements.",
        suggestions=suggestions,
        planner="fallback",
    )


def _theme_object_pool(theme: str) -> list[dict[str, str]]:
    lowered = theme.lower()
    if "summer" in lowered:
        return [
            {"object": "blueberry", "query": "blueberry isolated macro"},
            {"object": "hibiscus petal", "query": "hibiscus petal isolated"},
            {"object": "lemon slice", "query": "lemon slice isolated"},
            {"object": "seashell", "query": "seashell isolated white background"},
            {"object": "cherry", "query": "cherry isolated glossy"},
            {"object": "sea glass", "query": "sea glass isolated macro"},
        ]
    if "winter" in lowered:
        return [
            {"object": "icicle", "query": "icicle isolated"},
            {"object": "frost crystal", "query": "frost crystal macro isolated"},
            {"object": "silver ornament", "query": "silver ornament isolated"},
            {"object": "cranberry", "query": "cranberry isolated glossy"},
            {"object": "white feather", "query": "white feather isolated"},
            {"object": "snowflake charm", "query": "snowflake charm isolated"},
        ]
    return [
        {"object": "chrome bead", "query": "chrome bead isolated macro"},
        {"object": "flower petal", "query": "flower petal isolated"},
        {"object": "pearl", "query": "pearl isolated glossy"},
        {"object": "glass droplet", "query": "glass droplet isolated"},
        {"object": "berry cluster", "query": "berry cluster isolated"},
        {"object": "ribbon curl", "query": "ribbon curl isolated"},
    ]


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
    try:
        payload = json.loads(match.group(0))
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        return None


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)

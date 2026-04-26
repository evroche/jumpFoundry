from __future__ import annotations

import json
import re
import time

import httpx

from app.schemas import (
    ProductMoodboardEnhanceRequest,
    ProductMoodboardPlan,
    ProductMoodboardRecommendation,
)
from app.services.hermes_client import HermesClient


PRODUCT_MOODBOARD_PROMPT = """
You are a product recommendation planner for a consumer-goods moodboard builder.

Return only valid JSON matching this shape:
{
  "direction": "...",
  "seed_summary": ["..."],
  "recommendations": [
    {
      "query": "specific product image search query",
      "why": "why this product complements the supplied products",
      "category": "bags"
    }
  ]
}

Rules:
- Work only from the supplied product seeds.
- This is for consumer goods and products, not general editorial moodboards.
- Recommend complementary or adjacent purchasable products the user might like.
- Prioritize designer, luxury, and premium contemporary fashion or beauty products over mass-market basics.
- Prefer specific designer brands, product families, luxury retailers, and recognizable object types.
- Bias toward current-season or current-collection items unless the prompt explicitly asks for vintage, archival, resale, or a past season.
- Prefer queries that are likely to surface designer ecommerce/editorial results from sources like SSENSE, Mytheresa, Farfetch, Net-a-Porter, Bergdorf Goodman, Moda Operandi, or the brand's own site.
- Avoid broad marketplace or low-signal sources such as Amazon, Etsy, eBay, Poshmark, Depop, Walmart, AliExpress, or discount aggregators.
- Avoid recommendations that feel cheap, generic, dupe-like, stale, outlet-driven, or leftover from an old sale cycle.
- For apparel and accessories, favor current luxury labels, strong product families, runway-adjacent ecommerce, and recognizable seasonal buys.
- Respect any supplied enhancement prompt or stylistic direction such as "make it goth" or "only vintage items".
- Produce 6 to 12 recommendations when possible.
- Keep queries image-searchable and concrete.
- When relevant, add cues like "designer", "current season", "resort 2026", "spring summer 2026", or "fall winter 2025 2026".
- Do not search the web.
""".strip()


class ProductMoodboardPlanner:
    def __init__(self, hermes: HermesClient) -> None:
        self._hermes = hermes

    def generate(self, req: ProductMoodboardEnhanceRequest) -> tuple[ProductMoodboardPlan, dict]:
        plan, debug = self._generate_with_hermes(req)
        if plan is not None:
            plan = _normalize_product_plan(plan, req)
            plan.planner = "hermes"
            return plan, debug

        fallback = _fallback_product_plan(req)
        debug["used_fallback"] = True
        return fallback, debug

    def _generate_with_hermes(self, req: ProductMoodboardEnhanceRequest) -> tuple[ProductMoodboardPlan | None, dict]:
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
                {"role": "system", "content": PRODUCT_MOODBOARD_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "products": [product.model_dump() for product in req.products],
                            "max_asset_count": req.max_asset_count,
                            "prompt": req.prompt,
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
            plan = ProductMoodboardPlan.model_validate(parsed)
        except Exception as exc:
            debug["reason"] = "hermes_validation_error"
            debug["latency_ms"] = _elapsed_ms(started)
            debug["error"] = str(exc)
            debug["raw_preview"] = content[:500]
            return None, debug

        debug["reason"] = "hermes_ok"
        debug["latency_ms"] = _elapsed_ms(started)
        return plan, debug


def _normalize_product_plan(plan: ProductMoodboardPlan, req: ProductMoodboardEnhanceRequest) -> ProductMoodboardPlan:
    recommendations: list[ProductMoodboardRecommendation] = []
    seen: set[str] = set()
    for recommendation in plan.recommendations:
        normalized = recommendation.query.strip().casefold()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        recommendations.append(_apply_prompt_to_recommendation(recommendation, req.prompt))

    minimum = max(6, min(req.max_asset_count, 12))
    if len(recommendations) < minimum:
        fallback = _fallback_product_plan(req)
        for recommendation in fallback.recommendations:
            normalized = recommendation.query.strip().casefold()
            if normalized in seen:
                continue
            seen.add(normalized)
            recommendations.append(_apply_prompt_to_recommendation(recommendation, req.prompt))
            if len(recommendations) >= minimum:
                break

    seed_summary = [item for item in plan.seed_summary if item]
    if not seed_summary:
        seed_summary = _seed_summary(req)
    direction = plan.direction
    if req.prompt.strip():
        direction = f"{direction} Enhancement direction: {req.prompt.strip()}."
    return plan.model_copy(update={"direction": direction, "seed_summary": seed_summary, "recommendations": recommendations})


def _fallback_product_plan(req: ProductMoodboardEnhanceRequest) -> ProductMoodboardPlan:
    seeds = _seed_summary(req)
    categories = _detect_categories(req)
    minimum = max(6, min(req.max_asset_count, 12))
    recommendations: list[ProductMoodboardRecommendation] = []
    seen: set[str] = set()
    ordered_categories = categories + [category for category in ["bags", "footwear", "beauty", "accessories", "apparel"] if category not in categories]
    for category in ordered_categories:
        for recommendation in _category_recommendations(category):
            normalized = recommendation.query.casefold()
            if normalized in seen:
                continue
            seen.add(normalized)
            recommendations.append(recommendation)
            if len(recommendations) >= minimum:
                break
        if len(recommendations) >= minimum:
            break

    if not recommendations:
        recommendations = [
            ProductMoodboardRecommendation(
                query="designer leather shoulder bag product photo",
                why="A structured bag is an easy adjacent product anchor for fashion or beauty-led consumer boards.",
                category="bags",
            ),
            ProductMoodboardRecommendation(
                query="pointed toe leather heel product photo",
                why="Footwear adds a complementary silhouette when the seed set is product-led.",
                category="footwear",
            ),
            ProductMoodboardRecommendation(
                query="luxury face cream jar product photo",
                why="Beauty packaging helps broaden the board into adjacent consumer goods.",
                category="beauty",
            ),
            ProductMoodboardRecommendation(
                query="designer sunglasses product photo studio",
                why="Accessories diversify the product set while staying highly shoppable.",
                category="accessories",
            ),
        ][: req.max_asset_count]

    return ProductMoodboardPlan(
        direction=_fallback_direction(req),
        seed_summary=seeds,
        recommendations=[_apply_prompt_to_recommendation(recommendation, req.prompt) for recommendation in recommendations],
        planner="fallback",
    )


def _fallback_direction(req: ProductMoodboardEnhanceRequest) -> str:
    base = (
        "A consumer-goods product moodboard built from supplied seed products, then expanded "
        "with adjacent designer or luxury items that share their visual language, price signal, "
        "and styling world while avoiding cheap marketplace noise."
    )
    if req.prompt.strip():
        return f"{base} Enhancement direction: {req.prompt.strip()}."
    return base


def _apply_prompt_to_recommendation(
    recommendation: ProductMoodboardRecommendation,
    prompt: str,
) -> ProductMoodboardRecommendation:
    query = recommendation.query
    prompt_lower = prompt.strip().casefold()
    query = _shape_product_query(query, prompt_lower)
    why = recommendation.why
    if prompt_lower and prompt_lower not in why.casefold():
        why = f"{why} Tuned to the requested direction: {prompt.strip()}."
    return recommendation.model_copy(update={"query": query, "why": why})


def _shape_product_query(query: str, prompt_lower: str) -> str:
    shaped = query.strip()
    lowered = shaped.casefold()
    prefixes: list[str] = []
    suffixes: list[str] = []
    wants_vintage = any(token in prompt_lower for token in ("vintage", "archival", "archive", "resale", "pre-owned"))

    if "designer" not in lowered:
        prefixes.append("designer")

    if wants_vintage:
        if "vintage" not in lowered and "archival" not in lowered:
            prefixes.append("vintage")
    else:
        if not any(token in lowered for token in ("current season", "spring summer", "fall winter", "resort")):
            suffixes.append("current season")
        if not any(token in lowered for token in ("ssense", "mytheresa", "farfetch", "net-a-porter", "bergdorf", "moda operandi")):
            suffixes.append("ssense mytheresa farfetch")

    if prompt_lower and prompt_lower not in lowered:
        prefixes.append(prompt_lower)

    parts = prefixes + [shaped] + suffixes
    compact = " ".join(part.strip() for part in parts if part.strip())
    return re.sub(r"\s+", " ", compact).strip()


def _seed_summary(req: ProductMoodboardEnhanceRequest) -> list[str]:
    out: list[str] = []
    for product in req.products:
        title = _compact_text(product.title) or _compact_text(product.description) or product.source_domain or product.url
        out.append(title[:120])
    return out[:8]


def _detect_categories(req: ProductMoodboardEnhanceRequest) -> list[str]:
    joined = " ".join(f"{product.title} {product.description}".lower() for product in req.products)
    categories: list[str] = []
    rules = [
        ("bags", ["bag", "tote", "purse", "clutch", "shoulder bag"]),
        ("footwear", ["shoe", "heel", "sandal", "boot", "loafer", "sneaker"]),
        ("beauty", ["cream", "serum", "lip", "beauty", "makeup", "moisturizer"]),
        ("apparel", ["dress", "coat", "jacket", "skirt", "shirt", "top"]),
        ("accessories", ["sunglasses", "belt", "watch", "wallet", "earring", "necklace"]),
    ]
    for category, keywords in rules:
        if any(keyword in joined for keyword in keywords):
            categories.append(category)
    return categories or ["bags", "footwear", "beauty", "accessories"]


def _category_recommendations(category: str) -> list[ProductMoodboardRecommendation]:
    mapping: dict[str, list[ProductMoodboardRecommendation]] = {
        "bags": [
            ProductMoodboardRecommendation(
                query="Saint Laurent Le 5 a 7 shoulder bag product photo",
                why="A sharply branded shoulder bag complements other high-signal fashion accessories.",
                category="bags",
            ),
            ProductMoodboardRecommendation(
                query="Bottega Veneta Andiamo bag product photo",
                why="Woven leather adds texture while staying squarely in the luxury product world.",
                category="bags",
            ),
        ],
        "footwear": [
            ProductMoodboardRecommendation(
                query="Manolo Blahnik pointed slingback heel product photo",
                why="A refined heel broadens the board with another recognizable fashion product silhouette.",
                category="footwear",
            ),
            ProductMoodboardRecommendation(
                query="The Row leather sandal product photo",
                why="A minimal luxury shoe balances louder statement products with cleaner lines.",
                category="footwear",
            ),
        ],
        "beauty": [
            ProductMoodboardRecommendation(
                query="La Mer moisturizer jar product photo",
                why="Prestige skincare packaging expands a beauty or luxury consumer board naturally.",
                category="beauty",
            ),
            ProductMoodboardRecommendation(
                query="Chanel lip gloss packaging product photo",
                why="Beauty packaging introduces high-gloss surfaces and a recognizably shoppable object.",
                category="beauty",
            ),
        ],
        "apparel": [
            ProductMoodboardRecommendation(
                query="Khaite black dress product photo studio",
                why="A clean apparel anchor keeps the board rooted in a wearable styling world.",
                category="apparel",
            ),
            ProductMoodboardRecommendation(
                query="Toteme leather jacket product photo",
                why="Outerwear adds a substantial fashion product silhouette without leaving the consumer goods lane.",
                category="apparel",
            ),
        ],
        "accessories": [
            ProductMoodboardRecommendation(
                query="Cartier Tank watch product photo",
                why="A recognizable luxury accessory adds precision and status to the product mix.",
                category="accessories",
            ),
            ProductMoodboardRecommendation(
                query="Celine Triomphe sunglasses product photo",
                why="Sunglasses give the board another compact, iconic consumer object.",
                category="accessories",
            ),
        ],
    }
    return mapping.get(category, [])


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


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

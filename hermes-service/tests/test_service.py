from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.hermes_client import _parse_chat_plan
from app.services.moodboard_planner import _normalize_plan
from app.services.product_moodboard_planner import _fallback_product_plan, _shape_product_query
from app.services.semantic_swap_planner import _fallback_swap_plan
from hermes_image_search.service.normalize import normalize_candidates
from hermes_image_search.service.models import SearchResultBundle
from app.schemas import (
    MoodboardPlan,
    MoodboardPlanRequest,
    MoodboardReferenceBucket,
    MoodboardSearchTarget,
    ProductMoodboardEnhanceRequest,
    SemanticSwapFeature,
    SemanticSwapPlanRequest,
)


def test_health_and_status_endpoints_work_without_keys():
    app = create_app(settings=Settings())
    client = TestClient(app)

    health = client.get("/health")
    status = client.get("/api/status")
    hello = client.get("/api/hello")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    assert status.status_code == 200
    assert status.json()["configured"] is False

    assert hello.status_code == 200
    assert hello.json()["status"] == "error"


def test_chat_endpoint_returns_structured_error_without_keys():
    app = create_app(settings=Settings())
    client = TestClient(app)

    response = client.post("/api/chat", json={"session_id": "sess_1", "message": "hello", "history": []})

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "The Hermes gateway is not configured yet."
    assert payload["history"] == []
    assert payload["ui_actions"] == []


def test_parse_chat_plan_extracts_actions_from_json():
    payload = _parse_chat_plan(
        '{"reply":"Done. I cut out the front lizard.","ui_actions":[{"type":"cutout_candidate","candidate_id":"c1"},{"type":"place_cutout_in_frame","candidate_id":"c1","frame_id":"frame_main"}]}'
    )

    assert payload["reply"] == "Done. I cut out the front lizard."
    assert payload["ui_actions"][0]["type"] == "cutout_candidate"
    assert payload["ui_actions"][1]["type"] == "place_cutout_in_frame"


def test_image_search_route_returns_shared_package_shape(monkeypatch):
    app = create_app(settings=Settings())
    client = TestClient(app)

    def fake_search(req):
        assert req.query == "blue lizard on rock"
        return SearchResultBundle(
            provider="serpapi_google_images",
            query=req.query,
            raw_count=1,
            ignored_sites=[],
            candidates=[
                {
                    "candidate_id": "img_1",
                    "position": 1,
                    "title": "Blue Lizard",
                    "source_domain": "example.com",
                    "source_page_url": "https://example.com/page",
                    "thumbnail_url": "https://example.com/thumb.jpg",
                    "image_url": "https://example.com/image.jpg",
                    "width": 1200,
                    "height": 800,
                }
            ],
        )

    monkeypatch.setattr("app.routes.api.search_images", fake_search)

    response = client.post("/api/image-search", json={"query": "blue lizard on rock", "max_results": 20})

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "serpapi_google_images"
    assert payload["query"] == "blue lizard on rock"
    assert payload["candidates"][0]["candidate_id"] == "img_1"


def test_moodboard_plan_route_returns_specific_fallback_without_keys():
    app = create_app(settings=Settings())
    client = TestClient(app)

    response = client.post(
        "/api/moodboard/plan",
        json={"theme": "aggressive feminine luxury tech", "max_asset_count": 8},
    )

    assert response.status_code == 200
    payload = response.json()
    plan = payload["plan"]
    assert payload["status"] == "ok"
    assert plan["theme"] == "aggressive feminine luxury tech"
    assert plan["planner"] == "fallback"
    assert payload["debug"]["attempted_hermes"] is True
    assert payload["debug"]["reason"] == "hermes_status_unavailable"
    assert len(plan["reference_buckets"]) >= 3
    assert "Vertu phone product photo aggressive feminine luxury tech" in plan["search_targets"]


def test_normalize_plan_backfills_sparse_bucket_targets():
    req = MoodboardPlanRequest(theme="feminine luxury tech", max_asset_count=8)
    plan = MoodboardPlan(
        theme="feminine luxury tech",
        direction="test",
        aesthetic_keywords=["gloss"],
        reference_buckets=[
            MoodboardReferenceBucket(
                bucket="art-photography",
                rationale="test",
                targets=[
                    MoodboardSearchTarget(
                        query="Hajime Sorayama silver chrome feminine robot sculpture",
                        why="artist",
                        optional_cutout_targets=[],
                    ),
                    MoodboardSearchTarget(
                        query="Nick Knight beauty technology editorial metallic pink",
                        why="editorial",
                        optional_cutout_targets=[],
                    ),
                ],
            )
        ],
        search_targets=[
            "Hajime Sorayama silver chrome feminine robot sculpture",
            "Prada nylon hardware closeup pink",
            "Apple iMac G3 translucent pink product photo",
            "Shu Uemura compact mirrored makeup packaging",
            "Jony Ive aluminum hardware macro",
            "rose gold compact mirror luxury product shot",
        ],
        must_have_assets=["one object"],
        optional_assets=["one texture"],
        composition_intent="test",
        max_asset_count=8,
        planner="hermes",
    )

    normalized = _normalize_plan(plan, req)

    bucket_queries = [target.query for bucket in normalized.reference_buckets for target in bucket.targets]
    assert len(bucket_queries) >= 4
    assert len(normalized.search_targets) >= 6
    assert "Prada nylon hardware closeup pink" in bucket_queries


def test_semantic_swap_route_returns_fallback_plan_without_keys():
    app = create_app(settings=Settings())
    client = TestClient(app)

    response = client.post(
        "/api/semantic-swap/plan",
        json={
            "theme": "summer",
            "features": [
                {"feature_id": "left_eye", "label": "left eye", "bbox": [10, 10, 30, 20]},
                {"feature_id": "right_eye", "label": "right eye", "bbox": [40, 10, 60, 20]},
                {"feature_id": "mouth", "label": "mouth", "bbox": [20, 40, 50, 55]},
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["plan"]["theme"] == "summer"
    assert len(payload["plan"]["suggestions"]) == 3


def test_product_moodboard_enhance_route_returns_fallback_plan_without_keys():
    app = create_app(settings=Settings())
    client = TestClient(app)

    response = client.post(
        "/api/product-moodboard/enhance",
        json={
            "products": [
                {
                    "url": "https://www.instagram.com/p/demo1/",
                    "title": "Leather shoulder bag",
                    "description": "Black leather bag with gold hardware",
                    "source_domain": "instagram.com",
                }
            ],
            "max_asset_count": 6,
            "prompt": "make it goth",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert len(payload["plan"]["recommendations"]) >= 4
    assert "goth" in payload["plan"]["direction"].lower()
    assert any("goth" in recommendation["query"].lower() for recommendation in payload["plan"]["recommendations"])


def test_fallback_product_plan_uses_seed_products():
    req = ProductMoodboardEnhanceRequest(
        products=[
            {
                "url": "https://www.instagram.com/p/demo1/",
                "title": "Leather shoulder bag",
                "description": "Black leather bag with gold hardware",
                "source_domain": "instagram.com",
            }
        ],
        max_asset_count=6,
        prompt="only vintage items",
    )

    plan = _fallback_product_plan(req)

    assert plan.seed_summary
    assert len(plan.recommendations) >= 4
    assert any(recommendation.category for recommendation in plan.recommendations)
    assert "only vintage items" in plan.direction.lower()


def test_shape_product_query_biases_current_season_luxury_retailers():
    shaped = _shape_product_query("Khaite black dress product photo", "")

    assert "designer" in shaped.lower()
    assert "current season" in shaped.lower()
    assert "ssense mytheresa farfetch" in shaped.lower()


def test_fallback_swap_plan_uses_detected_features():
    req = SemanticSwapPlanRequest(
        theme="summer",
        features=[
            SemanticSwapFeature(feature_id="left_eye", label="left eye", bbox=[0, 0, 10, 10]),
            SemanticSwapFeature(feature_id="right_eye", label="right eye", bbox=[10, 0, 20, 10]),
            SemanticSwapFeature(feature_id="mouth", label="mouth", bbox=[5, 10, 15, 20]),
        ],
    )

    plan = _fallback_swap_plan(req)

    assert plan.theme == "summer"
    assert {suggestion.feature_id for suggestion in plan.suggestions} == {"left_eye", "right_eye", "mouth"}


def test_normalize_candidates_extracts_fields_from_serpapi_shape():
    result = normalize_candidates(
        {
            "images_results": [
                {
                    "title": "Agama lizard on rock",
                    "link": "https://example.com/page",
                    "thumbnail": "https://cdn.example.com/thumb.jpg",
                    "original": "https://cdn.example.com/original.jpg",
                    "original_width": 1200,
                    "original_height": 800,
                }
            ]
        },
        max_results=5,
    )

    assert len(result) == 1
    assert result[0].thumbnail_url == "https://cdn.example.com/thumb.jpg"
    assert result[0].image_url == "https://cdn.example.com/original.jpg"
    assert result[0].source_domain == "example.com"

from __future__ import annotations

import httpx
from fastapi import APIRouter, Request
from fastapi import HTTPException

from app.schemas import (
    ChatRequest,
    ChatResponse,
    MoodboardPlanRequest,
    MoodboardPlanResponse,
    ProductMoodboardEnhanceRequest,
    ProductMoodboardPlanResponse,
    SemanticSwapPlanRequest,
    SemanticSwapPlanResponse,
)
from hermes_image_search.service.models import ImageSearchRequest
from hermes_image_search.service.search import search_images

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/status")
def status(request: Request) -> dict:
    hermes = request.app.state.hermes
    hermes_status = hermes.status()
    settings = request.app.state.settings
    return {
        "service": "collage-service",
        "gateway_base_url": settings.hermes_api_base_url,
        "configured": hermes_status.configured,
        "reachable": hermes_status.reachable,
        "detail": hermes_status.detail,
        "model": settings.hermes_model_name,
    }


@router.get("/hello")
def hello(request: Request) -> dict:
    hermes = request.app.state.hermes
    return hermes.hello()


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request) -> ChatResponse:
    hermes = request.app.state.hermes
    result = hermes.chat(message=req.message, history=req.history, context=req.context)
    return ChatResponse(
        reply=result["reply"],
        history=result.get("history", []),
        ui_actions=result.get("ui_actions", []),
    )


@router.post("/image-search")
def image_search(payload: ImageSearchRequest) -> dict:
    try:
        result = search_images(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        detail = {
            "message": "SerpApi Google Images request failed",
            "status_code": exc.response.status_code,
            "body": exc.response.text[:500],
        }
        raise HTTPException(status_code=502, detail=detail) from exc

    return result.model_dump()


@router.post("/moodboard/plan", response_model=MoodboardPlanResponse)
def moodboard_plan(payload: MoodboardPlanRequest, request: Request) -> MoodboardPlanResponse:
    planner = request.app.state.moodboard_planner
    try:
        plan, debug = planner.generate(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return MoodboardPlanResponse(status="ok", plan=plan, debug=debug)


@router.post("/semantic-swap/plan", response_model=SemanticSwapPlanResponse)
def semantic_swap_plan(payload: SemanticSwapPlanRequest, request: Request) -> SemanticSwapPlanResponse:
    planner = request.app.state.semantic_swap_planner
    plan, debug = planner.generate(payload)
    return SemanticSwapPlanResponse(status="ok", plan=plan, debug=debug)


@router.post("/product-moodboard/enhance", response_model=ProductMoodboardPlanResponse)
def product_moodboard_enhance(
    payload: ProductMoodboardEnhanceRequest,
    request: Request,
) -> ProductMoodboardPlanResponse:
    planner = request.app.state.product_moodboard_planner
    plan, debug = planner.generate(payload)
    return ProductMoodboardPlanResponse(status="ok", plan=plan, debug=debug)

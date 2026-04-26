from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.routes.api import router as api_router
from app.routes.health import router as health_router
from app.services.hermes_client import HermesClient
from app.services.moodboard_planner import MoodboardPlanner
from app.services.product_moodboard_planner import ProductMoodboardPlanner
from app.services.semantic_swap_planner import SemanticSwapPlanner


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    app = FastAPI(title="collage-service")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.settings = resolved_settings
    app.state.hermes = HermesClient(resolved_settings)
    app.state.moodboard_planner = MoodboardPlanner(app.state.hermes)
    app.state.product_moodboard_planner = ProductMoodboardPlanner(app.state.hermes)
    app.state.semantic_swap_planner = SemanticSwapPlanner(app.state.hermes)

    app.include_router(health_router)
    app.include_router(api_router)
    return app

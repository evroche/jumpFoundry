from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(slots=True)
class Settings:
    app_host: str = "127.0.0.1"
    app_port: int = 8100
    hermes_api_base_url: str = "http://127.0.0.1:8642/v1"
    hermes_api_key: str = ""
    hermes_model_name: str = "hermes-agent"
    version: str = "0.1.0"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_host=os.getenv("APP_HOST", "127.0.0.1"),
            app_port=int(os.getenv("APP_PORT", "8100")),
            hermes_api_base_url=os.getenv("HERMES_API_BASE_URL", "http://127.0.0.1:8642/v1"),
            hermes_api_key=os.getenv("HERMES_API_KEY", ""),
            hermes_model_name=os.getenv("HERMES_MODEL_NAME", "hermes-agent"),
        )

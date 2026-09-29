from functools import lru_cache
from pathlib import Path
import subprocess

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(default="development", alias="APP_ENV")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8200, alias="APP_PORT")
    app_cors_origins: list[str] = Field(
        default=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ],
        alias="APP_CORS_ORIGINS",
    )
    runs_dir: Path = Field(default=Path("runs"), alias="RUNS_DIR")

    hermes_api_base_url: str = Field(default="http://127.0.0.1:8642/v1", alias="HERMES_API_BASE_URL")
    hermes_model_name: str = Field(default="hermes-agent", alias="HERMES_MODEL_NAME")
    hermes_api_key: str = Field(default="", alias="HERMES_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_base_url: str = Field(default="https://api.openai.com/v1", alias="OPENAI_BASE_URL")
    openai_image_model: str = Field(default="gpt-image-1", alias="OPENAI_IMAGE_MODEL")
    openai_image_size: str = Field(default="1024x1024", alias="OPENAI_IMAGE_SIZE")
    openai_image_quality: str = Field(default="low", alias="OPENAI_IMAGE_QUALITY")
    openai_input_fidelity: str = Field(default="low", alias="OPENAI_INPUT_FIDELITY")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_backend_version() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parents[2],
            capture_output=True,
            text=True,
            check=True,
        )
        version = result.stdout.strip()
        if version:
            return version
    except Exception:
        pass
    return "dev"

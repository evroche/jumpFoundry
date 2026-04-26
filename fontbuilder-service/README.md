# fontbuilder-service

Minimal backend kernel for generating one new glyph image from one drawn reference glyph.

## What this includes

- FastAPI app with a health route and a single glyph-generation endpoint
- Run-oriented artifact storage under `runs/`
- Hermes-first reasoning and analysis, with a narrow image-edit provider call for raster generation
- Deployment-oriented env structure that matches the EC2 plan

## Local development

1. Create a virtualenv.
2. Install dependencies from `pyproject.toml`.
3. Copy `.env.example` to `.env`.
4. Run:

```bash
uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8200
```

## API

- `GET /healthz`
- `POST /api/v1/generate`

The service stores the uploaded reference image, analysis JSON, provider response, and generated PNG inside `runs/`.

# service

`service` is the backend-side project for the collage stack. It is intended to become the long-running Hermes-facing service that can be deployed to AWS while `workbench` remains the UI shell.

For now this repo is intentionally small:

- FastAPI app
- health/config status endpoints
- a minimal Hermes gateway client
- a simple `hello` endpoint for proving that the service can talk to Hermes over HTTP
- a lightweight `/api/chat` endpoint so `workbench` can forward chat traffic to Hermes

## Local shape

This project does not need your provider secrets checked into git.

Expected runtime environment:

- `HERMES_API_BASE_URL`
- `HERMES_API_KEY`
- optionally `HERMES_MODEL_NAME`

If Hermes is not reachable, the hello endpoint returns structured error JSON instead of crashing.

## Quickstart

```bash
cd service
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:create_app --factory --reload --port 8100
```

Then open:

- `http://127.0.0.1:8100/health`
- `http://127.0.0.1:8100/api/status`
- `http://127.0.0.1:8100/api/hello`
- `POST http://127.0.0.1:8100/api/chat`

Example chat request:

```bash
curl http://127.0.0.1:8100/api/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess_1","message":"hello","history":[]}'
```

## Intended future role

This repo is the natural place for:

- Hermes gateway deployment config
- plugin installation/bootstrap logic
- AWS process management
- auth between the UI shell and Hermes-backed service

The `workbench` app can eventually point at this service instead of talking directly to Hermes.

## AWS persistence with systemd

Checked-in unit files live under [deploy/systemd](/Users/evanroche/PycharmProjects/0collage/service/deploy/systemd).

On the EC2 box:

```bash
sudo cp /opt/service/deploy/systemd/collage-hermes.service /etc/systemd/system/
sudo cp /opt/service/deploy/systemd/collage-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now collage-hermes
sudo systemctl enable --now collage-service
```

Useful commands:

```bash
sudo systemctl status collage-hermes
sudo systemctl status collage-service
sudo journalctl -u collage-hermes -f
sudo journalctl -u collage-service -f
```

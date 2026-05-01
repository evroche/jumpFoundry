from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 8765
PATH = "/fontsketch-event"

ALLOWED_EVENTS = {
    "draw_confirmed": "done",
    "single_glyph_approved": "done",
    "alphabet_confirmed": "continue",
    "alphabet_redo_requested": "I'm ready with some changes.",
}

ALLOWED_ORIGINS = {
    "http://127.0.0.1:5174",
    "http://localhost:5174",
}

_seen_event_ids: set[str] = set()
_seen_lock = threading.Lock()
_started = False
_start_lock = threading.Lock()


def _build_injected_message(event_type: str, payload: dict) -> str:
    message = ALLOWED_EVENTS.get(event_type)
    if message:
        return message

    return (
        f"JumpFoundry event: {event_type}\n\n"
        f"Event payload:\n{json.dumps(payload, indent=2, sort_keys=True)}"
    )


def _origin_for_request(handler: BaseHTTPRequestHandler) -> str:
    origin = handler.headers.get("Origin", "")
    return origin if origin in ALLOWED_ORIGINS else "null"


def _start_server(ctx) -> None:
    global _started

    cli = getattr(getattr(ctx, "_manager", None), "_cli_ref", None)
    if cli is None:
        return

    with _start_lock:
        if _started:
            return
        _started = True

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def _send_json(self, status: int, obj: dict):
            data = json.dumps(obj).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", _origin_for_request(self))
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", _origin_for_request(self))
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                return self._send_json(403, {"error": "loopback only"})

            if self.path != PATH:
                return self._send_json(404, {"error": "not found"})

            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0:
                    return self._send_json(400, {"error": "empty body"})
                if content_length > 256_000:
                    return self._send_json(413, {"error": "payload too large"})

                body = json.loads(self.rfile.read(content_length))
                event_id = str(body["event_id"])
                event_type = str(body["event_type"])
                payload = body.get("payload") or {}

                if event_type not in ALLOWED_EVENTS:
                    return self._send_json(400, {"error": f"unsupported event_type: {event_type}"})

                with _seen_lock:
                    if event_id in _seen_event_ids:
                        return self._send_json(200, {"status": "duplicate_ignored"})
                    _seen_event_ids.add(event_id)
                    if len(_seen_event_ids) > 4096:
                        _seen_event_ids.clear()
                        _seen_event_ids.add(event_id)

                queued = ctx.inject_message(_build_injected_message(event_type, payload), role="user")
                if not queued:
                    return self._send_json(
                        503,
                        {
                            "error": "message_not_queued",
                            "detail": "Hermes CLI is not available for message injection.",
                        },
                    )

                return self._send_json(200, {"status": "queued"})
            except KeyError as exc:
                return self._send_json(400, {"error": f"missing field: {exc.args[0]}"})
            except json.JSONDecodeError:
                return self._send_json(400, {"error": "invalid json"})
            except Exception as exc:
                return self._send_json(500, {"error": str(exc)})

    def serve():
        try:
            server = ThreadingHTTPServer((HOST, PORT), Handler)
            print(f"[jumpfoundry-events] listening on http://{HOST}:{PORT}{PATH}")
            server.serve_forever()
        except Exception as exc:
            print(f"[jumpfoundry-events] failed to start server: {exc}")

    threading.Thread(target=serve, daemon=True).start()


def register(ctx) -> None:
    def on_session_start(**_kwargs):
        _start_server(ctx)

    ctx.register_hook("on_session_start", on_session_start)

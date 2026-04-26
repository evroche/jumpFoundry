from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx

from app.config import Settings
from app.system_prompt import SYSTEM_PROMPT


@dataclass(slots=True)
class HermesStatus:
    configured: bool
    reachable: bool
    detail: object


class HermesClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def settings(self) -> Settings:
        return self._settings

    def status(self) -> HermesStatus:
        if not self._settings.hermes_api_key:
            return HermesStatus(configured=False, reachable=False, detail="HERMES_API_KEY is not configured")

        try:
            with self._client() as client:
                response = client.get("/health")
                response.raise_for_status()
                return HermesStatus(configured=True, reachable=True, detail=response.json())
        except Exception as exc:
            return HermesStatus(configured=True, reachable=False, detail=str(exc))

    def hello(self) -> dict:
        status = self.status()
        if not status.configured:
            return {"status": "error", "message": "Hermes API key is not configured", "detail": status.detail}
        if not status.reachable:
            return {"status": "error", "message": "Hermes gateway is unreachable", "detail": status.detail}

        payload = {
            "model": self._settings.hermes_model_name,
            "messages": [{"role": "user", "content": "Reply with exactly: hello from hermes"}],
            "stream": False,
        }
        try:
            with self._client() as client:
                response = client.post("/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return {"status": "error", "message": "Hermes request failed", "detail": str(exc)}

        try:
            reply = data["choices"][0]["message"]["content"]
        except Exception:
            return {"status": "error", "message": "Unexpected Hermes response shape", "detail": data}

        return {"status": "ok", "reply": reply}

    def chat(self, *, message: str, history: list[dict] | None = None, context: dict | None = None) -> dict:
        status = self.status()
        if not status.configured:
            return {
                "status": "error",
                "message": "Hermes API key is not configured",
                "detail": status.detail,
                "reply": "The Hermes gateway is not configured yet.",
                "history": history or [],
                "ui_actions": [],
            }
        if not status.reachable:
            return {
                "status": "error",
                "message": "Hermes gateway is unreachable",
                "detail": status.detail,
                "reply": "I can't reach the Hermes gateway right now.",
                "history": history or [],
                "ui_actions": [],
            }

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(history or [])
        user_payload = {
            "user_message": message,
            "app_context": context or {},
        }
        messages.append({"role": "user", "content": json.dumps(user_payload, indent=2)})

        payload = {
            "model": self._settings.hermes_model_name,
            "messages": messages,
            "stream": False,
        }
        try:
            with self._client() as client:
                response = client.post("/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            return {
                "status": "error",
                "message": "Hermes request failed",
                "detail": str(exc),
                "reply": "The Hermes request failed.",
                "history": history or [],
                "ui_actions": [],
            }

        try:
            raw_reply = data["choices"][0]["message"]["content"]
        except Exception:
            return {
                "status": "error",
                "message": "Unexpected Hermes response shape",
                "detail": data,
                "reply": "Hermes returned an unexpected response.",
                "history": history or [],
                "ui_actions": [],
            }

        parsed = _parse_chat_plan(raw_reply)
        reply = parsed["reply"]
        next_history = list(history or [])
        next_history.append({"role": "user", "content": message})
        next_history.append({"role": "assistant", "content": reply})
        return {"status": "ok", "reply": reply, "history": next_history, "ui_actions": parsed["ui_actions"]}

    def _client(self, timeout: float = 30.0) -> httpx.Client:
        return httpx.Client(
            base_url=self._settings.hermes_api_base_url,
            headers={
                "Authorization": f"Bearer {self._settings.hermes_api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def client(self, timeout: float = 30.0) -> httpx.Client:
        return self._client(timeout=timeout)


def _parse_chat_plan(raw_reply: str) -> dict:
    text = raw_reply.strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None

    if payload is None:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                payload = json.loads(match.group(0))
            except json.JSONDecodeError:
                payload = None

    if not isinstance(payload, dict):
        return {"reply": text or "I couldn't understand that request.", "ui_actions": []}

    reply = payload.get("reply")
    ui_actions = payload.get("ui_actions")
    if not isinstance(reply, str):
        reply = text or "I couldn't understand that request."
    if not isinstance(ui_actions, list):
        ui_actions = []

    normalized_actions = []
    for action in ui_actions:
        if isinstance(action, dict) and isinstance(action.get("type"), str):
            normalized_actions.append(action)
    return {"reply": reply.strip(), "ui_actions": normalized_actions}

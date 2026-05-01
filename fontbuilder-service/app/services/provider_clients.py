import base64
from concurrent.futures import Future, ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import time

import httpx
from PIL import Image

from app.core.config import get_settings
from app.schemas.glyph import GlyphAnalysis


class HermesClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.hermes_api_base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {self.settings.hermes_api_key}",
            "Content-Type": "application/json",
        }
        self._analysis_cache: dict[str, GlyphAnalysis] = {}

    def analyze_glyph(self, image_bytes: bytes, image_media_type: str) -> GlyphAnalysis:
        cache_key = hashlib.sha256(image_bytes).hexdigest()
        cached = self._analysis_cache.get(cache_key)
        if cached is not None:
            return cached

        data_url = _to_data_url(image_bytes, image_media_type)
        payload = {
            "model": self.settings.hermes_model_name,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You analyze hand-drawn glyph images for a glyph-generation pipeline. "
                        "Return strict JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze this glyph image and return JSON with keys: "
                                "detected_character, confidence, style_summary, must_preserve, must_avoid. "
                                "This is for style transfer, so focus on specific visible line and contour behavior, "
                                "not generic font adjectives. Describe the stroke rhythm, waviness, wobble pattern, "
                                "edge softness or sharpness, thickness variation, roundness, and contour cadence. "
                                "Prioritize local traits that can transfer from one letter to another, such as "
                                "squiggly perimeter behavior or repeated bulges, more than global shape description. "
                                "must_preserve should be a list of concrete visual traits from the contour and stroke. "
                                "must_avoid should include over-regularizing, smoothing, balancing, standardizing, "
                                "or replacing the handmade line quality with a normal font outline. "
                                "Return strict JSON only."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            "response_format": {"type": "json_object"},
        }
        response = self._post("/chat/completions", payload, timeout=180.0)
        content = response["choices"][0]["message"]["content"]
        analysis = GlyphAnalysis.model_validate(json.loads(_extract_json_block(content)))
        self._analysis_cache[cache_key] = analysis
        return analysis

    def _post(self, path: str, payload: dict, timeout: float = 60.0) -> dict:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(f"{self.base_url}{path}", headers=self.headers, json=payload)
        if response.is_error:
            raise RuntimeError(f"Hermes API error {response.status_code}: {response.text}")
        return response.json()


class OpenAIImagesClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.openai_base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {self.settings.openai_api_key}"}

    def edit_glyph(
        self,
        image_bytes: bytes,
        image_media_type: str,
        prompt: str,
        additional_reference_images: list[tuple[bytes, str]] | None = None,
        previous_generated_image_bytes: bytes | None = None,
        previous_generated_image_media_type: str = "image/png",
    ) -> tuple[bytes, dict]:
        data_url = _to_data_url(image_bytes, image_media_type)
        images = [{"image_url": data_url}]
        for additional_bytes, additional_media_type in additional_reference_images or []:
            images.append({"image_url": _to_data_url(additional_bytes, additional_media_type)})
        if previous_generated_image_bytes:
            images.append({"image_url": _to_data_url(previous_generated_image_bytes, previous_generated_image_media_type)})
        payload = {
            "model": self.settings.openai_image_model,
            "images": images,
            "prompt": prompt,
            "size": self.settings.openai_image_size,
            "quality": self.settings.openai_image_quality,
            "background": "transparent",
            "output_format": "png",
            "input_fidelity": self.settings.openai_input_fidelity,
        }
        last_transport_error: httpx.HTTPError | None = None
        last_runtime_error: RuntimeError | None = None
        for attempt in range(3):
            try:
                with httpx.Client(timeout=180.0) as client:
                    response = client.post(
                        f"{self.base_url}/images/edits",
                        headers={**self.headers, "Content-Type": "application/json"},
                        json=payload,
                    )
            except httpx.HTTPError as exc:
                last_transport_error = exc
                if attempt >= 2:
                    raise RuntimeError(f"OpenAI Images transport error: {exc}") from exc
                time.sleep(0.8 * (attempt + 1))
                continue

            if response.is_error:
                last_runtime_error = RuntimeError(f"OpenAI Images API error {response.status_code}: {response.text}")
                if attempt >= 2 or response.status_code not in {408, 409, 429, 500, 502, 503, 504}:
                    raise last_runtime_error
                time.sleep(0.8 * (attempt + 1))
                continue

            body = response.json()
            image_base64 = body["data"][0]["b64_json"]
            image_bytes = base64.b64decode(image_base64)
            dark_pixel_count = _significant_dark_pixel_count(image_bytes)
            if dark_pixel_count < 1000:
                last_runtime_error = RuntimeError(
                    f"OpenAI Images returned a near-empty image (dark_pixels={dark_pixel_count})."
                )
                if attempt >= 2:
                    raise last_runtime_error
                time.sleep(0.8 * (attempt + 1))
                continue
            return image_bytes, body

        if last_runtime_error is not None:
            raise last_runtime_error
        if last_transport_error is not None:
            raise RuntimeError(f"OpenAI Images transport error: {last_transport_error}") from last_transport_error
        raise RuntimeError("OpenAI Images request failed for an unknown reason")


def _to_data_url(image_bytes: bytes, image_media_type: str) -> str:
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{image_media_type};base64,{image_b64}"


def _significant_dark_pixel_count(image_bytes: bytes) -> int:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    dark_pixels = 0
    for r, g, b, a in image.getdata():
        if a and (r + g + b) < 720:
            dark_pixels += 1
    return dark_pixels


def _extract_json_block(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not contain JSON")
    return text[start : end + 1]


def _glyph_label(character: str) -> str:
    normalized = (character[:1] or "").upper()
    if normalized == "\\":
        return 'the backslash character ("\\\\")'
    if normalized == ".":
        return 'the period character (".")'
    if normalized == '"':
        return 'the quotation mark character ("\\"")'
    return f'the letter "{normalized}"'


def _glyph_noun(character: str) -> str:
    normalized = (character[:1] or "").upper()
    if normalized in {'\\', ".", '"'}:
        return "character"
    return "letter"


def build_generation_prompt(
    source_character: str,
    target_character: str,
    correction: str = "",
    has_previous_generated_image: bool = False,
    generation_mode: str = "final",
    additional_source_characters: list[str] | None = None,
) -> str:
    source_label = _glyph_label(source_character)
    target_label = _glyph_label(target_character)
    target_noun = _glyph_noun(target_character)
    normalized_additional_sources = [character[:1].upper() for character in (additional_source_characters or []) if character]
    if has_previous_generated_image:
        prompt = (
            "A second image is provided showing the previous draft of the target glyph. "
            f"Revise that draft so it loosely represents {target_label}. "
            "Revise that draft to address the user's requested revisions. "
            f"Prioritize implementing the user's revisions, even if it means it looks less like a standard printed form of that {target_noun}. "
            "One isolated glyph only. No words, no extra symbols, no texture, no shadows, no border, no scene."
        )
        if correction:
            prompt += f" User revision: {correction}."
        return prompt

    if normalized_additional_sources:
        source_list = [source_character.upper(), *normalized_additional_sources]
        source_labels = [_glyph_label(character) for character in source_list]
        if len(source_list) == 2:
            source_description = f"Two reference images are provided depicting {source_labels[0]} and {source_labels[1]}. "
        else:
            source_description = (
                "Reference images are provided depicting "
                + ", ".join(source_labels[:-1])
                + f", and {source_labels[-1]}. "
            )
        prompt = (
            "Your job is to create the next image in the series, based on the reference images provided. "
            + source_description +
            f"Your job is to produce a new image that loosely represents {target_label}. "
            "The output does not need to follow the rules of font design. "
            "Use the reference images together to infer the shared style system. "
            "Retain the line width and its consistency or variability. "
            "Retain the contour rhythm, slant of the letter, and any decorative appendages. "
            "Do not smooth the outline into a generic font letter. "
            f"Prioritize emphasizing the distinctive qualities of the reference drawings even if it means it looks less like a standard printed form of that {target_noun}. "
            "One isolated glyph only. No words, no extra symbols, no texture, no shadows, no border, no scene."
        )
        if correction:
            prompt += f" User revision: {correction}."
        return prompt

    prompt = (
        "Your job is to create the next image in the series, based on the image provided. "
        f"The image provided is a drawing that loosely depicts {source_label}. "
        f"Your job is to produce a new image that loosely represents {target_label}. "
        "The output does not need to follow the rules of font design. "
        "It should be legible as the new character to the same degree the input image is legible in its original form. "
        "Retain the line width and its consistency or variability. "
        "Retain the contour rhythm, slant of the letter, and any decorative appendages. "
        "Do not smooth the outline into a generic font letter. "
        f"Prioritize emphasizing the distinctive qualities of the source drawing even if it means it looks less like a standard printed form of that {target_noun}. "
        "One isolated glyph only. No words, no extra symbols, no texture, no shadows, no border, no scene."
    )
    if correction:
        prompt += f" User revision: {correction}."
    return prompt


def build_suggested_revision(analysis: GlyphAnalysis) -> str:
    if analysis.must_preserve:
        lead = analysis.must_preserve[0]
        return f"Preserve {lead}. Do not smooth it into a normal font outline."
    return "Keep the line quality closer to the source drawing. Do not smooth it into a normal font outline."


def run_parallel_image_and_analysis(
    hermes: HermesClient,
    images: OpenAIImagesClient,
    image_bytes: bytes,
    image_media_type: str,
    prompt: str,
    previous_generated_image_bytes: bytes | None = None,
    analyze_reference: bool = True,
) -> tuple[tuple[bytes, dict], GlyphAnalysis | None, str]:
    with ThreadPoolExecutor(max_workers=2) as executor:
        image_future: Future[tuple[bytes, dict]] = executor.submit(
            images.edit_glyph,
            image_bytes,
            image_media_type,
            prompt,
            previous_generated_image_bytes,
            "image/png",
        )
        analysis_future: Future[GlyphAnalysis] | None = None
        if analyze_reference:
            analysis_future = executor.submit(
                hermes.analyze_glyph,
                image_bytes,
                image_media_type,
            )

        generated = image_future.result()
        if analysis_future is None:
            analysis = None
            suggested_revision = ""
        else:
            try:
                analysis = analysis_future.result()
                suggested_revision = build_suggested_revision(analysis)
            except Exception:
                analysis = None
                suggested_revision = ""

    return generated, analysis, suggested_revision


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

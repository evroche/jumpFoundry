from __future__ import annotations

import io
from typing import Iterable

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

from app.services.outline_export import decode_data_url, normalize_outline_loops, raster_to_outline_loops


UPM = 1024
ASCENT = 824
DESCENT = -200
SIDE_BEARING = 36
TOP_PADDING = 24


def build_partial_ttf(glyphs: list[dict[str, str]], family_name: str = "Fontsketch Test") -> bytes:
    glyph_map = {".notdef": _build_notdef_glyph()}
    metrics = {".notdef": (UPM, 0)}
    cmap: dict[int, str] = {}

    ordered_items = sorted(
        [((glyph.get("character") or "?")[:1].upper(), glyph["image_data_url"]) for glyph in glyphs],
        key=lambda item: item[0],
    )

    for character, image_data_url in ordered_items:
        image_bytes, _ = decode_data_url(image_data_url)
        loops = raster_to_outline_loops(image_bytes)
        normalized_loops, width, height = normalize_outline_loops(loops)
        glyph_map[character] = _build_outline_glyph(normalized_loops, width, height)
        metrics[character] = (_advance_width(width, height), 0)
        cmap[ord(character)] = character
        if character.isalpha():
            cmap[ord(character.lower())] = character

    glyph_order = [".notdef"] + [character for character, _ in ordered_items]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyph_map)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable(
        {
            "familyName": family_name,
            "styleName": "Regular",
            "fullName": f"{family_name} Regular",
            "psName": family_name.replace(" ", "") + "-Regular",
        }
    )
    fb.setupOS2(
        sTypoAscender=ASCENT,
        sTypoDescender=DESCENT,
        usWinAscent=ASCENT,
        usWinDescent=abs(DESCENT),
    )
    fb.setupPost()
    fb.setupMaxp()
    output = io.BytesIO()
    fb.save(output)
    return output.getvalue()


def _build_notdef_glyph():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((924, 0))
    pen.lineTo((924, 824))
    pen.lineTo((100, 824))
    pen.closePath()
    pen.moveTo((220, 120))
    pen.lineTo((804, 120))
    pen.lineTo((804, 704))
    pen.lineTo((220, 704))
    pen.closePath()
    return pen.glyph()


def _build_outline_glyph(
    loops: list[list[tuple[float, float]]],
    source_width: float,
    source_height: float,
):
    pen = TTGlyphPen(None)
    for loop in loops:
        transformed = list(_transform_loop(loop, source_width, source_height))
        if len(transformed) < 3:
            continue
        pen.moveTo(transformed[0])
        for point in transformed[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def _transform_loop(
    loop: list[tuple[float, float]],
    source_width: float,
    source_height: float,
) -> Iterable[tuple[int, int]]:
    drawable_height = ASCENT - TOP_PADDING
    scale = drawable_height / max(source_height, 1.0)
    for x, y in loop:
        transformed_x = int(round(SIDE_BEARING + x * scale))
        transformed_y = int(round((source_height - y) * scale))
        yield transformed_x, transformed_y


def _advance_width(source_width: float, source_height: float) -> int:
    drawable_height = ASCENT - TOP_PADDING
    scale = drawable_height / max(source_height, 1.0)
    return max(240, int(round(SIDE_BEARING * 2 + source_width * scale)))

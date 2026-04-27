from __future__ import annotations

import base64
import io
import json
from math import hypot
from urllib.parse import unquote_to_bytes
import zipfile

from PIL import Image


Point = tuple[float, float]


def build_outline_svg_zip(glyphs: list[dict[str, str]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        manifest: list[dict[str, str]] = []
        for glyph in glyphs:
            character = (glyph.get("character") or "?")[:1].upper()
            image_bytes, _ = decode_data_url(glyph["image_data_url"])
            loops = raster_to_outline_loops(image_bytes)
            normalized_loops, width, height = normalize_outline_loops(loops)
            svg_markup = loops_to_outline_svg(normalized_loops, width=width, height=height)
            archive.writestr(f"{character}.svg", svg_markup)
            manifest.append({"character": character, "filename": f"{character}.svg"})
        archive.writestr("manifest.json", json.dumps({"glyphs": manifest}, indent=2))
    return buffer.getvalue()


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    header, payload = data_url.split(",", 1)
    mime_type = header[5:].split(";", 1)[0] if header.startswith("data:") else "application/octet-stream"
    if ";base64" in header:
        return base64.b64decode(payload), mime_type
    return unquote_to_bytes(payload), mime_type


def raster_to_outline_loops(image_bytes: bytes, output_size: int = 1024) -> list[list[Point]]:
    image = Image.open(io.BytesIO(image_bytes)).convert("L")
    image = image.resize((output_size, output_size))
    binary = _binarize(image)
    loops = _trace_outline_loops(binary)
    return [_rdp(loop, epsilon=1.5) for loop in loops if len(loop) > 2]


def normalize_outline_loops(loops: list[list[Point]], padding: float = 0.0) -> tuple[list[list[Point]], float, float]:
    if not loops:
        return [], 0.0, 0.0

    all_points = [point for loop in loops for point in loop]
    min_x = min(point[0] for point in all_points)
    max_x = max(point[0] for point in all_points)
    min_y = min(point[1] for point in all_points)
    max_y = max(point[1] for point in all_points)
    normalized = [
        [(x - min_x + padding, y - min_y + padding) for x, y in loop]
        for loop in loops
    ]
    width = (max_x - min_x) + padding * 2
    height = (max_y - min_y) + padding * 2
    return normalized, width, height


def loops_to_outline_svg(loops: list[list[Point]], width: float = 1024, height: float = 1024) -> str:
    path_data = " ".join(_loop_to_path(loop) for loop in loops if len(loop) > 2)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.2f}" height="{height:.2f}" viewBox="0 0 {width:.2f} {height:.2f}">'
        f'<path d="{path_data}" fill="#111111" fill-rule="evenodd" />'
        "</svg>"
    )


def _binarize(image: Image.Image) -> list[list[int]]:
    width, height = image.size
    pixels = image.load()
    return [[1 if pixels[x, y] < 220 else 0 for x in range(width)] for y in range(height)]


def _trace_outline_loops(binary: list[list[int]]) -> list[list[Point]]:
    height = len(binary)
    width = len(binary[0]) if height else 0
    edges: dict[Point, list[Point]] = {}

    def add_edge(start: Point, end: Point) -> None:
        edges.setdefault(start, []).append(end)

    for y in range(height):
        for x in range(width):
            if binary[y][x] != 1:
                continue
            if y == 0 or binary[y - 1][x] == 0:
                add_edge((x, y), (x + 1, y))
            if x == width - 1 or binary[y][x + 1] == 0:
                add_edge((x + 1, y), (x + 1, y + 1))
            if y == height - 1 or binary[y + 1][x] == 0:
                add_edge((x + 1, y + 1), (x, y + 1))
            if x == 0 or binary[y][x - 1] == 0:
                add_edge((x, y + 1), (x, y))

    loops: list[list[Point]] = []
    while edges:
        start = next(iter(edges))
        current = start
        loop = [start]
        while True:
            next_points = edges.get(current)
            if not next_points:
                break
            nxt = next_points.pop()
            if not next_points:
                edges.pop(current, None)
            current = nxt
            if current == start:
                loop.append(start)
                break
            loop.append(current)
        if len(loop) > 2:
            loops.append(loop)
    return loops


def _loop_to_path(loop: list[Point]) -> str:
    return " ".join(
        f'{"M" if index == 0 else "L"} {x:.2f} {y:.2f}'
        for index, (x, y) in enumerate(loop)
    ) + " Z"


def _rdp(points: list[Point], epsilon: float) -> list[Point]:
    if len(points) < 3:
        return points

    start = points[0]
    end = points[-1]
    max_distance = -1.0
    split_index = -1
    for index in range(1, len(points) - 1):
        distance = _perpendicular_distance(points[index], start, end)
        if distance > max_distance:
            max_distance = distance
            split_index = index

    if max_distance <= epsilon:
        return [start, end]

    left = _rdp(points[: split_index + 1], epsilon)
    right = _rdp(points[split_index:], epsilon)
    return left[:-1] + right


def _perpendicular_distance(point: Point, start: Point, end: Point) -> float:
    if start == end:
        return hypot(point[0] - start[0], point[1] - start[1])

    x0, y0 = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
    denominator = hypot(y2 - y1, x2 - x1)
    return numerator / denominator

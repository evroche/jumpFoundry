from __future__ import annotations

import base64
from collections import defaultdict
import io
from math import hypot

from PIL import Image, ImageDraw


Point = tuple[float, float]
Pixel = tuple[int, int]

MAX_TOTAL_POLYLINE_POINTS = 12000
MAX_POINTS_PER_POLYLINE = 600
MAX_VECTOR_DATA_URL_CHARS = 2_000_000


def vectorize_centerline_and_render(
    image_bytes: bytes,
    *,
    brush_size: int,
    output_size: int = 1024,
) -> tuple[str, str]:
    image = _prepare_grayscale_image(image_bytes)
    image = image.resize((output_size, output_size))
    binary = _binarize(image)
    skeleton = _zhang_suen_thinning(binary)
    polylines = _trace_polylines(skeleton)
    simplified = [_rdp(polyline, epsilon=2.4) for polyline in polylines if len(polyline) > 1]
    simplified = _cap_polyline_complexity(simplified)

    vector_data_url = _vector_svg_data_url(simplified, output_size)
    final_data_url = _render_final_png_data_url(simplified, output_size, brush_size)
    return vector_data_url, final_data_url


def _binarize(image: Image.Image) -> list[list[int]]:
    width, height = image.size
    pixels = image.load()
    return [
        [1 if pixels[x, y] < 220 else 0 for x in range(width)]
        for y in range(height)
    ]


def _prepare_grayscale_image(image_bytes: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(image_bytes))
    if "A" not in image.getbands():
        return image.convert("L")

    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    composited = Image.alpha_composite(background, rgba)
    return composited.convert("L")


def _zhang_suen_thinning(binary: list[list[int]]) -> list[list[int]]:
    height = len(binary)
    width = len(binary[0]) if height else 0
    grid = [row[:] for row in binary]
    changed = True

    while changed:
        changed = False
        to_remove: list[Pixel] = []
        for step in (0, 1):
            to_remove.clear()
            for y in range(1, height - 1):
                for x in range(1, width - 1):
                    if grid[y][x] != 1:
                        continue
                    neighbors = _neighbors(grid, x, y)
                    count = sum(neighbors)
                    transitions = _transitions(neighbors)
                    if count < 2 or count > 6 or transitions != 1:
                        continue
                    p2, p3, p4, p5, p6, p7, p8, p9 = neighbors
                    if step == 0:
                        if p2 * p4 * p6 != 0 or p4 * p6 * p8 != 0:
                            continue
                    else:
                        if p2 * p4 * p8 != 0 or p2 * p6 * p8 != 0:
                            continue
                    to_remove.append((x, y))
            if to_remove:
                changed = True
                for x, y in to_remove:
                    grid[y][x] = 0
    return grid


def _neighbors(grid: list[list[int]], x: int, y: int) -> list[int]:
    return [
        grid[y - 1][x],
        grid[y - 1][x + 1],
        grid[y][x + 1],
        grid[y + 1][x + 1],
        grid[y + 1][x],
        grid[y + 1][x - 1],
        grid[y][x - 1],
        grid[y - 1][x - 1],
    ]


def _transitions(neighbors: list[int]) -> int:
    wrapped = neighbors + [neighbors[0]]
    return sum(1 for current, nxt in zip(wrapped, wrapped[1:]) if current == 0 and nxt == 1)


def _trace_polylines(grid: list[list[int]]) -> list[list[Point]]:
    nodes = {(x, y) for y, row in enumerate(grid) for x, value in enumerate(row) if value == 1}
    if not nodes:
        return []

    adjacency: dict[Pixel, set[Pixel]] = defaultdict(set)
    for x, y in nodes:
        for neighbor in _pixel_neighbors(x, y):
            if neighbor in nodes:
                adjacency[(x, y)].add(neighbor)

    important = {node for node, neighbors in adjacency.items() if len(neighbors) != 2}
    visited_edges: set[tuple[Pixel, Pixel]] = set()
    polylines: list[list[Point]] = []

    for node in important:
        for neighbor in adjacency[node]:
            edge = _edge_key(node, neighbor)
            if edge in visited_edges:
                continue
            polylines.append(_walk_path(node, neighbor, adjacency, visited_edges))

    for node in nodes:
        for neighbor in adjacency[node]:
            edge = _edge_key(node, neighbor)
            if edge in visited_edges:
                continue
            polylines.append(_walk_loop(node, neighbor, adjacency, visited_edges))

    return [polyline for polyline in polylines if len(polyline) > 1]


def _walk_path(
    start: Pixel,
    next_node: Pixel,
    adjacency: dict[Pixel, set[Pixel]],
    visited_edges: set[tuple[Pixel, Pixel]],
) -> list[Point]:
    path = [start, next_node]
    visited_edges.add(_edge_key(start, next_node))
    prev = start
    current = next_node

    while len(adjacency[current]) == 2:
        candidates = [neighbor for neighbor in adjacency[current] if neighbor != prev]
        if not candidates:
            break
        nxt = candidates[0]
        edge = _edge_key(current, nxt)
        if edge in visited_edges:
            break
        visited_edges.add(edge)
        path.append(nxt)
        prev, current = current, nxt

    return [(x + 0.5, y + 0.5) for x, y in path]


def _walk_loop(
    start: Pixel,
    next_node: Pixel,
    adjacency: dict[Pixel, set[Pixel]],
    visited_edges: set[tuple[Pixel, Pixel]],
) -> list[Point]:
    path = [start, next_node]
    visited_edges.add(_edge_key(start, next_node))
    prev = start
    current = next_node

    while True:
        candidates = [neighbor for neighbor in adjacency[current] if neighbor != prev]
        if not candidates:
            break
        nxt = candidates[0]
        edge = _edge_key(current, nxt)
        if edge in visited_edges:
            break
        visited_edges.add(edge)
        path.append(nxt)
        prev, current = current, nxt
        if current == start:
            break

    return [(x + 0.5, y + 0.5) for x, y in path]


def _pixel_neighbors(x: int, y: int) -> list[Pixel]:
    return [
        (x - 1, y - 1),
        (x, y - 1),
        (x + 1, y - 1),
        (x - 1, y),
        (x + 1, y),
        (x - 1, y + 1),
        (x, y + 1),
        (x + 1, y + 1),
    ]


def _edge_key(a: Pixel, b: Pixel) -> tuple[Pixel, Pixel]:
    return (a, b) if a <= b else (b, a)


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


def _vector_svg_data_url(polylines: list[list[Point]], size: int) -> str:
    stroke_width = max(2.0, size / 220)
    paths = []
    for polyline in polylines:
        path_data = " ".join(
            f'{"M" if index == 0 else "L"} {x:.2f} {y:.2f}'
            for index, (x, y) in enumerate(polyline)
        )
        paths.append(
            f'<path d="{path_data}" fill="none" stroke="#111111" stroke-width="{stroke_width:.2f}" stroke-linecap="round" stroke-linejoin="round" />'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'{"".join(paths)}'
        "</svg>"
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    data_url = f"data:image/svg+xml;base64,{encoded}"
    if len(data_url) > MAX_VECTOR_DATA_URL_CHARS:
        return ""
    return data_url


def _render_final_png_data_url(polylines: list[list[Point]], size: int, brush_size: int) -> str:
    oversample = 4
    render_size = size * oversample
    image = Image.new("RGBA", (render_size, render_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    stroke_width = max(2, int(round(brush_size * (size / 720) * oversample)))
    radius = max(1.0, stroke_width / 2)
    step = max(1.0, radius * 0.22)

    for polyline in polylines:
        if len(polyline) == 1:
            x, y = polyline[0]
            scaled_x = x * oversample
            scaled_y = y * oversample
            draw.ellipse(
                (
                    scaled_x - radius,
                    scaled_y - radius,
                    scaled_x + radius,
                    scaled_y + radius,
                ),
                fill=(17, 17, 17, 255),
            )
            continue

        scaled = [(x * oversample, y * oversample) for x, y in polyline]
        for start, end in zip(scaled, scaled[1:]):
            _stamp_brush_segment(draw, start, end, radius, step)

        for x, y in scaled:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(17, 17, 17, 255))

    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image = _crop_transparent_image(image, padding=max(8, round(size * 0.03)))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _stamp_brush_segment(
    draw: ImageDraw.ImageDraw,
    start: Point,
    end: Point,
    radius: float,
    step: float,
) -> None:
    x1, y1 = start
    x2, y2 = end
    distance = hypot(x2 - x1, y2 - y1)
    if distance == 0:
        draw.ellipse((x1 - radius, y1 - radius, x1 + radius, y1 + radius), fill=17)
        return

    steps = max(1, int(distance / step))
    for index in range(steps + 1):
        t = index / steps
        x = x1 + (x2 - x1) * t
        y = y1 + (y2 - y1) * t
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(17, 17, 17, 255))


def _crop_transparent_image(image: Image.Image, padding: int) -> Image.Image:
    bbox = image.getbbox()
    if bbox is None:
        return image

    left, top, right, bottom = bbox
    return image.crop(
        (
            max(0, left - padding),
            max(0, top - padding),
            min(image.width, right + padding),
            min(image.height, bottom + padding),
        )
    )


def _cap_polyline_complexity(polylines: list[list[Point]]) -> list[list[Point]]:
    if not polylines:
        return polylines

    capped_polylines = [_downsample_polyline(polyline, MAX_POINTS_PER_POLYLINE) for polyline in polylines]
    total_points = sum(len(polyline) for polyline in capped_polylines)
    if total_points <= MAX_TOTAL_POLYLINE_POINTS:
        return capped_polylines

    reduction_ratio = MAX_TOTAL_POLYLINE_POINTS / max(total_points, 1)
    return [
        _downsample_polyline(polyline, max(2, int(len(polyline) * reduction_ratio)))
        for polyline in capped_polylines
    ]


def _downsample_polyline(polyline: list[Point], max_points: int) -> list[Point]:
    if len(polyline) <= max_points:
        return polyline
    if max_points <= 2:
        return [polyline[0], polyline[-1]]

    step = (len(polyline) - 1) / (max_points - 1)
    sampled = [polyline[0]]
    for index in range(1, max_points - 1):
        sampled.append(polyline[round(index * step)])
    sampled.append(polyline[-1])
    return sampled

from __future__ import annotations

import base64
from html import escape

from app.schemas.glyph import StructuralMode, VectorDrawingData


def render_skeleton_preview(
    drawing: VectorDrawingData,
    *,
    structural_mode: StructuralMode,
    output_size: int = 1024,
) -> str:
    strokes = [stroke for stroke in drawing.strokes if stroke.points]
    if not strokes:
        raise ValueError("Drawing must include at least one stroke")

    source_canvas_size = max(float(drawing.canvas_size), 1.0)
    scale = output_size / source_canvas_size

    base_brush = max(drawing.brush_size, 1)
    if structural_mode == "contour-outline":
        line_width = max(4.0, base_brush * 0.42)
    else:
        line_width = max(2.0, base_brush * 0.2)

    svg_paths: list[str] = []
    for stroke in strokes:
        normalized_points = [
            (
                point.x * scale,
                point.y * scale,
            )
            for point in stroke.points
        ]
        if len(normalized_points) == 1:
            x, y = normalized_points[0]
            radius = line_width / 2
            svg_paths.append(
                f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.2f}" fill="#111111" />'
            )
            continue

        path_data = " ".join(
            [
                f"M {normalized_points[0][0]:.2f} {normalized_points[0][1]:.2f}",
                *[
                    f"L {point_x:.2f} {point_y:.2f}"
                    for point_x, point_y in normalized_points[1:]
                ],
            ]
        )
        svg_paths.append(
            (
                f'<path d="{escape(path_data)}" fill="none" stroke="#111111" '
                f'stroke-width="{line_width:.2f}" stroke-linecap="round" '
                'stroke-linejoin="round" />'
            )
        )

    svg_markup = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{output_size}" height="{output_size}" '
        f'viewBox="0 0 {output_size} {output_size}">'
        f'<rect width="{output_size}" height="{output_size}" fill="#ffffff" />'
        f'{"".join(svg_paths)}'
        "</svg>"
    )
    encoded = base64.b64encode(svg_markup.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"

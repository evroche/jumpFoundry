from __future__ import annotations

from pathlib import Path

from . import schemas, tools


def register(ctx) -> None:
    ctx.register_tool(
        name="search_images",
        toolset="jumpfoundry",
        schema=schemas.SEARCH_IMAGES,
        handler=tools.search_images,
    )
    ctx.register_tool(
        name="start_jumpfoundry_session",
        toolset="jumpfoundry",
        schema=schemas.START_FONTSKETCH_SESSION,
        handler=tools.start_fontsketch_session,
    )
    ctx.register_tool(
        name="get_jumpfoundry_session_status",
        toolset="jumpfoundry",
        schema=schemas.GET_FONTSKETCH_SESSION_STATUS,
        handler=tools.get_fontsketch_session_status,
    )
    ctx.register_tool(
        name="advance_jumpfoundry_session",
        toolset="jumpfoundry",
        schema=schemas.ADVANCE_FONTSKETCH_SESSION,
        handler=tools.advance_fontsketch_session,
    )
    ctx.register_tool(
        name="generate_review_glyph",
        toolset="jumpfoundry",
        schema=schemas.GENERATE_FONTSKETCH_REVIEW_GLYPH,
        handler=tools.generate_fontsketch_review_glyph,
    )
    ctx.register_tool(
        name="generate_alphabet",
        toolset="jumpfoundry",
        schema=schemas.GENERATE_FONTSKETCH_ALPHABET_BATCH,
        handler=tools.generate_fontsketch_alphabet_batch,
    )
    ctx.register_tool(
        name="export_outline_svgs",
        toolset="jumpfoundry",
        schema=schemas.EXPORT_FONTSKETCH_OUTLINE_SET,
        handler=tools.export_fontsketch_outline_set,
    )
    ctx.register_tool(
        name="normalize_glyphs",
        toolset="jumpfoundry",
        schema=schemas.NORMALIZE_FONTSKETCH_GLYPHS,
        handler=tools.normalize_fontsketch_glyphs,
    )
    ctx.register_tool(
        name="set_font_name",
        toolset="jumpfoundry",
        schema=schemas.SET_FONTSKETCH_FONT_NAME,
        handler=tools.set_fontsketch_font_name,
    )
    ctx.register_tool(
        name="build_font_file",
        toolset="jumpfoundry",
        schema=schemas.BUILD_FONTSKETCH_FONT,
        handler=tools.build_fontsketch_font,
    )
    ctx.register_tool(
        name="apply_revision",
        toolset="jumpfoundry",
        schema=schemas.SUBMIT_FONTSKETCH_REVISION,
        handler=tools.submit_fontsketch_revision,
    )

    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.exists():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                ctx.register_skill(child.name, skill_md)

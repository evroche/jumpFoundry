from __future__ import annotations

from pathlib import Path

from . import schemas, tools


def register(ctx) -> None:
    ctx.register_tool(
        name="search_images",
        toolset="fontsketch",
        schema=schemas.SEARCH_IMAGES,
        handler=tools.search_images,
    )
    ctx.register_tool(
        name="start_fontsketch_session",
        toolset="fontsketch",
        schema=schemas.START_FONTSKETCH_SESSION,
        handler=tools.start_fontsketch_session,
    )
    ctx.register_tool(
        name="get_fontsketch_session_status",
        toolset="fontsketch",
        schema=schemas.GET_FONTSKETCH_SESSION_STATUS,
        handler=tools.get_fontsketch_session_status,
    )
    ctx.register_tool(
        name="submit_fontsketch_revision",
        toolset="fontsketch",
        schema=schemas.SUBMIT_FONTSKETCH_REVISION,
        handler=tools.submit_fontsketch_revision,
    )

    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.exists():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                ctx.register_skill(child.name, skill_md)

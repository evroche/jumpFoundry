SEARCH_IMAGES = {
    "name": "search_images",
    "description": (
        "Search Google Images via SerpApi and return image candidates. "
        "Use when the user asks to find images by text query. "
        "For v0, this performs a raw search with no ranking or filtering."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query for Google Images.",
            },
            "max_results": {
                "type": "integer",
                "description": "Maximum number of normalized image candidates to return.",
                "default": 20,
                "minimum": 1,
                "maximum": 50,
            },
            "sites": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Reserved for future site scoping. "
                    "Accepted now for forward compatibility but ignored in v0."
                ),
                "default": [],
            },
            "site_mode": {
                "type": "string",
                "enum": ["prefer", "require"],
                "description": (
                    "Reserved for future site scoping. "
                    "Accepted now for forward compatibility but ignored in v0."
                ),
                "default": "prefer",
            },
        },
        "required": ["query"],
    },
}


START_FONTSKETCH_SESSION = {
    "name": "start_fontsketch_session",
    "description": (
        "Create a new local Fontsketch session and open the browser. "
        "Use when the user wants to create a font using Fontsketch. "
        "After calling this tool, Hermes should use the returned startup_message verbatim instead of paraphrasing it."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "frontend_base_url": {
                "type": "string",
                "description": "Frontend base URL for the local Fontsketch app.",
                "default": "http://127.0.0.1:5174",
            },
            "backend_base_url": {
                "type": "string",
                "description": "Backend base URL for the local Fontsketch API.",
                "default": "http://127.0.0.1:8200",
            },
            "open_browser": {
                "type": "boolean",
                "description": "Whether to open the session URL in the local browser.",
                "default": True,
            },
        },
        "required": [],
    },
}


GET_FONTSKETCH_SESSION_STATUS = {
    "name": "get_fontsketch_session_status",
    "description": (
        "Read the current local Fontsketch session and return the instruction for the user. "
        "Use when the user asks what to do next in Fontsketch or says they finished a step."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


ADVANCE_FONTSKETCH_SESSION = {
    "name": "advance_fontsketch_session",
    "description": (
        "Advance the current local Fontsketch session to its next step. "
        "Use when the user says they are done with the current step and wants Hermes to move Fontsketch forward."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


GENERATE_FONTSKETCH_REVIEW_GLYPH = {
    "name": "generate_review_glyph",
    "description": (
        "Generate the first review glyph for the current Fontsketch session from the two drawn seed letters. "
        "Use when the user finishes drawing the second seed letter and wants the review glyph generated. "
        "Before calling this tool, Hermes should tell the user in first person that it is now generating the first letter for review."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


GENERATE_FONTSKETCH_ALPHABET_BATCH = {
    "name": "generate_alphabet",
    "description": (
        "Generate the next batch of alphabet glyphs for the current Fontsketch session after the first review glyph is approved. "
        "Before calling this tool, Hermes should tell the user in first person that it is now generating the alphabet for review."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


EXPORT_FONTSKETCH_OUTLINE_SET = {
    "name": "export_outline_svgs",
    "description": (
        "Convert the current Fontsketch glyph set into outline SVGs and save the outline archive for the current session."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


NORMALIZE_FONTSKETCH_GLYPHS = {
    "name": "normalize_glyphs",
    "description": (
        "Trim and normalize the current Fontsketch glyph set so it is ready to be compiled into a font."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
        },
        "required": [],
    },
}


SET_FONTSKETCH_FONT_NAME = {
    "name": "set_font_name",
    "description": (
        "Save the user's chosen font name for the current Fontsketch session and open the final preview. "
        "Use when Fontsketch asks what name to give the font."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
            "font_name": {
                "type": "string",
                "description": "The font name chosen by the user.",
            },
        },
        "required": ["font_name"],
    },
}


BUILD_FONTSKETCH_FONT = {
    "name": "build_font_file",
    "description": (
        "Compile the normalized Fontsketch glyphs into a downloadable font file for the current session."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
            "font_name": {
                "type": "string",
                "description": "The font name chosen by the user.",
            },
        },
        "required": ["font_name"],
    },
}


SUBMIT_FONTSKETCH_REVISION = {
    "name": "apply_revision",
    "description": (
        "Save a revision request for the current Fontsketch glyph review session. "
        "Use after the user has clicked edit and described what should change."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "session_id": {
                "type": "string",
                "description": "Optional specific Fontsketch session id. If omitted, use the most recently updated local session.",
                "default": "",
            },
            "correction": {
                "type": "string",
                "description": "The user's requested revision for the current glyph.",
            },
        },
        "required": ["correction"],
    },
}

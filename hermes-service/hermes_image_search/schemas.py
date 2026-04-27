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
        "Use when the user wants to create a font using Fontsketch."
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


SUBMIT_FONTSKETCH_REVISION = {
    "name": "submit_fontsketch_revision",
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

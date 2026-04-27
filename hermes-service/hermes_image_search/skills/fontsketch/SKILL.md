---
name: fontsketch
description: Use when the user wants to create a font using Fontsketch, launch a new local font session, or open the Fontsketch drawing app from Hermes.
metadata:
  hermes:
    requires_toolsets: [fontsketch]
---

# Fontsketch

When the user says they want to create a font using Fontsketch, start a new session with `start_fontsketch_session`.

Default behavior:
- use the local frontend at `http://127.0.0.1:5174`
- use the local backend at `http://127.0.0.1:8200`
- open the browser unless the user asks not to

After the tool returns, respond with the returned URL and tell the user:

`We'll draw two letters and use this to generate the rest of the typeface.`

`Start by drawing the letter "E".`

If the user says they finished a step, asks what to do next, asks for the next instruction, or asks what Hermes wants them to do in Fontsketch, call `get_fontsketch_session_status` and restate the returned instruction clearly.

Use the session instruction as the source of truth for the current stage.

If the user has clicked edit and then tells you what they want changed about the glyph, call `submit_fontsketch_revision` with their requested correction. After the tool returns, tell them the revision has been sent and the glyph is regenerating.

If the tool returns an error, explain that Fontsketch may not be running locally and ask the user to start the local stack.

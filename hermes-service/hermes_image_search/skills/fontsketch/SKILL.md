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

`Start by drawing one letter. We'll use this to generate the rest of the typeface.`

If the tool returns an error, explain that Fontsketch may not be running locally and ask the user to start the local stack.

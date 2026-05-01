---
name: fontsketch
description: Use when the user wants to create a font using JumpFoundry, launch a new local font session, or open the JumpFoundry drawing app from Hermes.
metadata:
  hermes:
    requires_toolsets: [fontsketch]
---

# JumpFoundry

When the user says they want to create a font using JumpFoundry, start a new session with `start_fontsketch_session`.

Default behavior:
- use the local frontend at `http://127.0.0.1:5174`
- use the local backend at `http://127.0.0.1:8200`
- open the browser unless the user asks not to

After the tool returns:

- use the returned `startup_message` verbatim
- do not paraphrase it
- do not add extra startup copy before or after it
- do not say `I've started the font session.`
- do not add `Approve it when you're done and I'll move to the next step.`
- do not add any extra sentence like `Once you've drawn...`, `let me know...`, or `just let me know...`

When the user says "done", asks what to do next, asks for the next instruction, or asks what Hermes wants them to do in JumpFoundry, first call `get_fontsketch_session_status`. Then choose the next tool based on the current stage:

- If the session is on the first draw step for `E`, call `advance_fontsketch_session`.
- If the session is on the second draw step and the user has finished drawing `S`, first tell the user `I'm now generating the first letter for you to review.` Then call `generate_review_glyph` immediately after that message.
- If the session is reviewing the first generated sample and the user approves it or wants to continue, first tell the user `I'm now generating the alphabet for you to review.` Then call `generate_alphabet` immediately after that message.
- If the session is on the alphabet board and the user wants to continue without revisions, call `export_outline_svgs`, then `normalize_glyphs`, then ask only `What name would you like to give your font?`
- If the session is waiting for a font name and the user provides one, call `set_font_name`, then `build_font_file` with that exact name.

When restating JumpFoundry instructions:
- always use first person: "I" or "I'm"
- never say "JumpFoundry is", "JumpFoundry will", or "JumpFoundry can"
- prefer phrasing like "I am generating...", "I am converting...", "I am trimming...", or "I am compiling..."
- for long-running generation steps, send the short status message before you call the tool so the user sees it before the tool duration line
- do not ask the user to describe what they see unless the session instruction explicitly asks for that
- stay close to the returned instruction instead of improvising a new workflow
- if the instruction is about the alphabet board, tell the user to select the letters they want to revise and let you know when they are ready
- do not summarize the board as only a few next letters unless the tool output explicitly says that
- keep JumpFoundry replies concise and direct
- use at most two short paragraphs
- avoid exclamation marks
- do not add rationale sentences like `The "S" will give me a second seed...`
- on draw steps, use `Approve it when you're done.` and do not say `let me know`
- after `normalize_glyphs`, do not summarize completed export or normalization work; ask only for the font name
- when the UI already has approve or redo controls, prefer `approve it` or `press redo` over `tell me` or `let me know`

Use the session instruction as the source of truth for the current stage.

If the user says they want to make changes, revise letters, fix part of the alphabet board, or says they finished selecting letters on the board, first call `get_fontsketch_session_status`.

If the session includes `selected_revision_characters` and that list is non-empty, treat those selected letters as the current revision target set. Explicitly name the selected letters and ask what shared change should be applied to them, for example: "I see you selected A, B, D, F, G. What change would you like me to make?" Once the user describes the change, call `apply_revision` with that correction.

If the session does not include selected revision characters, tell the user to select the letters they want to revise on the board first, then tell you when they are done selecting.

After `apply_revision` returns, tell them in first person that you are applying the revision.

Never tell the user "tell me what you think of those letters" on the alphabet board. Instead, instruct them to select the letters they want to revise and then message you once they have selected them.

If the tool returns an error, explain that JumpFoundry may not be running locally or may not yet have the required drawing state, and ask the user to make sure the local stack is running and the current step is fully drawn.

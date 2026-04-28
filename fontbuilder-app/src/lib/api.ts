const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8200";

export type StructuralMode = "stroke-path" | "contour-outline";

export type VectorPoint = {
  x: number;
  y: number;
};

export type VectorStroke = {
  points: VectorPoint[];
  brush_size: number;
  brush_label: string;
};

export type VectorDrawingData = {
  canvas_size: number;
  brush_size: number;
  brush_label: string;
  strokes: VectorStroke[];
};

export type SessionResponse = {
  session_id: string;
  backend_version: string;
  frontend_url: string;
  status: string;
  stage: "draw" | "skeleton_preview" | "review";
  instruction: string;
  source_character: string;
  target_character: string;
  correction: string;
  latest_run_id: string;
  skeleton_image_data_url: string;
  structural_mode: StructuralMode;
};

export type RunResponse = {
  run_id: string;
  backend_version: string;
  source_character: string;
  target_character: string;
  correction: string;
  suggested_revision: string;
  generated_image_data_url: string;
  interpreted_vector_data_url: string;
  final_render_data_url: string;
  debug: Array<{ step: string; payload: Record<string, unknown> }>;
  analysis: {
    detected_character: string;
    confidence: number;
    style_summary: string;
    must_preserve: string[];
    must_avoid: string[];
  } | null;
};

export type BatchResponse = {
  backend_version: string;
  source_character: string;
  target_characters: string[];
  accepted_run_id: string;
  items: RunResponse[];
};

export type SkeletonPreviewResponse = {
  backend_version: string;
  session_id: string;
  stage: "skeleton_preview";
  structural_mode: StructuralMode;
  source_character: string;
  target_character: string;
  skeleton_image_data_url: string;
  stroke_count: number;
  point_count: number;
};

export type GlyphOutlineExportItem = {
  character: string;
  image_data_url: string;
};

export type GlyphNormalizationResponse = {
  backend_version: string;
  session_id: string;
  glyphs: GlyphOutlineExportItem[];
};

export type AdditionalReferenceInput = {
  blob: Blob;
  character: string;
};

export async function submitGlyphGeneration(
  blob: Blob,
  sourceCharacter: string,
  targetCharacter: string,
  correction: string,
  previousRunId: string,
  sessionId = "",
  generationMode: "final" | "skeleton" = "final",
  brushSize = 16,
  additionalReferences: AdditionalReferenceInput[] = [],
): Promise<RunResponse> {
  const formData = new FormData();
  formData.append("reference_glyph", blob, "reference_glyph.png");
  const secondReference = additionalReferences[0];
  if (secondReference) {
    formData.append("second_reference_glyph", secondReference.blob, "second_reference_glyph.png");
    formData.append("second_source_character", secondReference.character);
  }
  formData.append("source_character", sourceCharacter);
  formData.append("target_character", targetCharacter);
  formData.append("correction", correction);
  formData.append("previous_run_id", previousRunId);
  formData.append("session_id", sessionId);
  formData.append("generation_mode", generationMode);
  formData.append("brush_size", String(brushSize));

  console.groupCollapsed("[fontbuilder] generate");
  console.log({
    endpoint: `${API_BASE_URL}/api/v1/generate`,
    sourceCharacter,
    targetCharacter,
    correction,
    previousRunId,
    sessionId,
    generationMode,
    brushSize,
    referenceImage: {
      type: blob.type,
      size: blob.size,
    },
    additionalReferences: additionalReferences.map((reference) => ({
      character: reference.character,
      type: reference.blob.type,
      size: reference.blob.size,
    })),
  });

  const response = await fetch(`${API_BASE_URL}/api/v1/generate`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let message = "Failed to generate glyph";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      const errorText = await response.text();
      message = errorText || message;
    }
    console.error("[fontbuilder] generate failed", { message });
    console.groupEnd();
    throw new Error(message);
  }

  const payload = await response.json();
  console.log("[fontbuilder] generate response", payload);
  console.log("[fontbuilder] generate prompt", payload.debug?.[0]?.payload?.prompt);
  console.log("[fontbuilder] generate context", payload.debug?.[0]?.payload);
  console.groupEnd();
  return payload;
}

export async function fetchSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }
  return response.json();
}

export async function fetchRun(runId: string, signal?: AbortSignal): Promise<RunResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/runs/${runId}`, { signal });
  if (!response.ok) {
    throw new Error("Failed to load run");
  }
  return response.json();
}

export async function submitSkeletonPreview(payload: {
  session_id: string;
  source_character: string;
  target_character: string;
  structural_mode: StructuralMode;
  drawing: VectorDrawingData;
}): Promise<SkeletonPreviewResponse> {
  console.groupCollapsed("[fontbuilder] skeleton-preview");
  console.log({
    endpoint: `${API_BASE_URL}/api/v1/skeleton-preview`,
    sessionId: payload.session_id,
    sourceCharacter: payload.source_character,
    targetCharacter: payload.target_character,
    structuralMode: payload.structural_mode,
    drawing: {
      canvasSize: payload.drawing.canvas_size,
      brushSize: payload.drawing.brush_size,
      brushLabel: payload.drawing.brush_label,
      strokeCount: payload.drawing.strokes.length,
      pointCount: payload.drawing.strokes.reduce((count, stroke) => count + stroke.points.length, 0),
    },
  });
  const response = await fetch(`${API_BASE_URL}/api/v1/skeleton-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = "Failed to build skeleton preview";
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {
      const text = await response.text();
      message = text || message;
    }
    console.error("[fontbuilder] skeleton-preview failed", { message });
    console.groupEnd();
    throw new Error(message);
  }

  const nextPayload = await response.json();
  console.log("[fontbuilder] skeleton-preview response", nextPayload);
  console.groupEnd();
  return nextPayload;
}

export async function requestSessionApprove(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}/approve`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to approve glyph");
  }
  return response.json();
}

export async function updateSession(
  sessionId: string,
  payload: Partial<Pick<SessionResponse, "stage" | "instruction" | "source_character" | "target_character">> & {
    correction?: string;
    latest_run_id?: string;
    skeleton_image_data_url?: string;
    structural_mode?: StructuralMode;
    status?: string;
  },
): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to update session");
  }
  return response.json();
}

export async function requestSessionEdit(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}/edit-request`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to request edit");
  }
  return response.json();
}

export async function submitManyGlyphs(
  blob: Blob,
  sourceCharacter: string,
  targetCharacters: string[],
  acceptedRunId: string,
  correction: string,
): Promise<BatchResponse> {
  const formData = new FormData();
  formData.append("reference_glyph", blob, "reference_glyph.png");
  formData.append("source_character", sourceCharacter);
  formData.append("target_characters", targetCharacters.join(","));
  formData.append("accepted_run_id", acceptedRunId);
  formData.append("correction", correction);

  console.groupCollapsed("[fontbuilder] generate-many");
  const expectedPrompt = (targetCharacter: string) =>
    [
      "Your job is to create the next image in the series, based on the image provided.",
      `The image provided is a drawing that loosely depicts the letter character "${sourceCharacter.toUpperCase()}".`,
      `Your job is to produce a new image that loosely represents the character "${targetCharacter.toUpperCase()}".`,
      "The output does not need to follow the rules of font design.",
      `It should be legible as the new letter to the same degree the input image is legible as "${sourceCharacter.toUpperCase()}".`,
      "Retain the line width and its consistency or variability.",
      "Retain the contour rhythm, slant of the letter, and any decorative appendages.",
      "Do not smooth the outline into a generic font letter.",
      `Prioritize emphasizing the distinctive qualities of the source drawing even if it means it looks less like a traditional letter "${targetCharacter.toUpperCase()}".`,
      "One isolated glyph only. No words, no extra symbols, no texture, no shadows, no border, no scene.",
      correction ? `User revision: ${correction}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  console.log({
    endpoint: `${API_BASE_URL}/api/v1/generate-many`,
    sourceCharacter,
    targetCharacters,
    acceptedRunId,
    correction,
    referenceImage: {
      type: blob.type,
      size: blob.size,
    },
  });
  console.log(
    "[fontbuilder] generate-many expected-prompts",
    targetCharacters.map((targetCharacter) => ({
      sourceCharacter,
      targetCharacter,
      prompt: expectedPrompt(targetCharacter),
    })),
  );

  const response = await fetch(`${API_BASE_URL}/api/v1/generate-many`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let message = "Failed to generate glyphs";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      const errorText = await response.text();
      message = errorText || message;
    }
    console.error("[fontbuilder] generate-many failed", { message });
    console.groupEnd();
    throw new Error(message);
  }

  const payload = await response.json();
  console.log("[fontbuilder] generate-many response", payload);
  console.log(
    "[fontbuilder] generate-many prompts",
    payload.items?.map((item: RunResponse) => ({
      targetCharacter: item.target_character,
      prompt: item.debug?.[0]?.payload?.prompt,
      context: item.debug?.[0]?.payload,
    })),
  );
  console.groupEnd();
  return payload;
}

export async function exportOutlineSet(sessionId: string, glyphs: GlyphOutlineExportItem[]): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/v1/export-outline-set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      glyphs,
    }),
  });

  if (!response.ok) {
    let message = "Failed to export outline SVG set";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      const errorText = await response.text();
      message = errorText || message;
    }
    throw new Error(message);
  }

  return response.blob();
}

export async function normalizeGlyphSet(
  sessionId: string,
  glyphs: GlyphOutlineExportItem[],
): Promise<GlyphNormalizationResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/normalize-glyph-set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      glyphs,
    }),
  });

  if (!response.ok) {
    let message = "Failed to normalize glyph set";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      const errorText = await response.text();
      message = errorText || message;
    }
    throw new Error(message);
  }

  return response.json();
}

export async function exportPartialFont(sessionId: string, glyphs: GlyphOutlineExportItem[]): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}/api/v1/export-partial-font`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      glyphs,
    }),
  });

  if (!response.ok) {
    let message = "Failed to export partial font";
    try {
      const payload = await response.json();
      message = payload.detail ?? message;
    } catch {
      const errorText = await response.text();
      message = errorText || message;
    }
    throw new Error(message);
  }

  return response.blob();
}

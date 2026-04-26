const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8200";

export type SessionResponse = {
  session_id: string;
  backend_version: string;
  frontend_url: string;
  status: string;
  stage: "draw" | "review";
  instruction: string;
  source_character: string;
  target_character: string;
};

export type RunResponse = {
  run_id: string;
  backend_version: string;
  source_character: string;
  target_character: string;
  correction: string;
  suggested_revision: string;
  generated_image_data_url: string;
  debug: Array<{ step: string; payload: Record<string, unknown> }>;
  analysis: {
    detected_character: string;
    confidence: number;
    style_summary: string;
    must_preserve: string[];
    must_avoid: string[];
  };
};

export type BatchResponse = {
  backend_version: string;
  source_character: string;
  target_characters: string[];
  accepted_run_id: string;
  items: RunResponse[];
};

export async function submitGlyphGeneration(
  blob: Blob,
  sourceCharacter: string,
  targetCharacter: string,
  correction: string,
  previousRunId: string,
  sessionId = "",
): Promise<RunResponse> {
  const formData = new FormData();
  formData.append("reference_glyph", blob, "reference_glyph.png");
  formData.append("source_character", sourceCharacter);
  formData.append("target_character", targetCharacter);
  formData.append("correction", correction);
  formData.append("previous_run_id", previousRunId);
  formData.append("session_id", sessionId);

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
    throw new Error(message);
  }

  return response.json();
}

export async function fetchSession(sessionId: string): Promise<SessionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }
  return response.json();
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
    throw new Error(message);
  }

  return response.json();
}

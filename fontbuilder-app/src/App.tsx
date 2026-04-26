import { useEffect, useRef, useState } from "react";
import clearIcon from "./assets/material-icons/clear.svg";
import approveIcon from "./assets/material-icons/approve.svg";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type DrawingVectorData,
} from "./components/DrawingCanvas";
import letterDownIcon from "./assets/material-icons/letter-down.svg";
import letterUpIcon from "./assets/material-icons/letter-up.svg";
import sendIcon from "./assets/material-icons/send.svg";
import undoIcon from "./assets/material-icons/undo.svg";
import {
  fetchSession,
  requestSessionApprove,
  requestSessionEdit,
  submitSkeletonPreview,
  submitGlyphGeneration,
  submitManyGlyphs,
  updateSession,
  type BatchResponse,
  type RunResponse,
  type SkeletonPreviewResponse,
  type SessionResponse,
} from "./lib/api";

const SESSION_CANVAS_SIZE = 720;
const BRUSH_OPTIONS = [
  { value: 32, label: "Large" },
  { value: 20, label: "Medium" },
  { value: 10, label: "Small" },
] as const;

export default function App() {
  const sessionId = readSessionIdFromPath();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [sourceCharacter, setSourceCharacter] = useState("A");
  const [targetCharacter, setTargetCharacter] = useState("B");
  const [correction, setCorrection] = useState("");
  const [referenceBlob, setReferenceBlob] = useState<Blob | null>(null);
  const [drawingData, setDrawingData] = useState<DrawingVectorData | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [skeletonPreview, setSkeletonPreview] = useState<SkeletonPreviewResponse | null>(null);
  const [skeletonPreviewSignature, setSkeletonPreviewSignature] = useState("");
  const [batchResult, setBatchResult] = useState<BatchResponse | null>(null);
  const [debugHistory, setDebugHistory] = useState<Array<{ at: string; data: unknown }>>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brushSize, setBrushSize] = useState(16);
  const [drawStageTab, setDrawStageTab] = useState<"draw" | "vector" | "skeleton">("draw");
  const [reviewTab, setReviewTab] = useState<"skeleton" | "vector" | "final">("skeleton");
  const [interpretedVectorImage, setInterpretedVectorImage] = useState("");
  const [finalRenderImage, setFinalRenderImage] = useState("");
  const [isPreparingReviewArtifacts, setIsPreparingReviewArtifacts] = useState(false);
  const sessionCanvasRef = useRef<DrawingCanvasHandle | null>(null);
  const isAwaitingApproveFollowup = session?.status === "awaiting_hermes_batch_confirmation";
  const isAwaitingEditPrompt = session?.status === "awaiting_hermes_edit_prompt";
  const skeletonPreviewImage = skeletonPreview?.skeleton_image_data_url || session?.skeleton_image_data_url || "";
  const strokeCount = drawingData?.strokes.length ?? 0;
  const pointCount = drawingData?.strokes.reduce((count, stroke) => count + stroke.points.length, 0) ?? 0;

  const drawStageTabs = (
    <div className="session-frame-tabs">
      <button
        type="button"
        className={`session-view-toggle-button${drawStageTab === "draw" ? " is-active" : ""}`}
        onClick={() => handleDrawStageTabChange("draw")}
      >
        Draw
      </button>
      <button
        type="button"
        className={`session-view-toggle-button${drawStageTab === "vector" ? " is-active" : ""}`}
        onClick={() => handleDrawStageTabChange("vector")}
      >
        Vector
      </button>
      <button
        type="button"
        className={`session-view-toggle-button${drawStageTab === "skeleton" ? " is-active" : ""}`}
        onClick={() => handleDrawStageTabChange("skeleton")}
      >
        Skeleton
      </button>
    </div>
  );

  const reviewTabs = (
    <div className="session-frame-tabs">
      <button
        type="button"
        className={`session-view-toggle-button${reviewTab === "skeleton" ? " is-active" : ""}`}
        onClick={() => setReviewTab("skeleton")}
      >
        AI Generated
      </button>
      <button
        type="button"
        className={`session-view-toggle-button${reviewTab === "vector" ? " is-active" : ""}`}
        onClick={() => setReviewTab("vector")}
      >
        Interpreted Vector
      </button>
      <button
        type="button"
        className={`session-view-toggle-button${reviewTab === "final" ? " is-active" : ""}`}
        onClick={() => setReviewTab("final")}
      >
        Final
      </button>
    </div>
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let isActive = true;
    void fetchSession(sessionId)
      .then((nextSession) => {
        if (!isActive) {
          return;
        }
        setSession(nextSession);
        setSourceCharacter(nextSession.source_character);
        setTargetCharacter(nextSession.target_character);
        setSkeletonPreview(
          nextSession.skeleton_image_data_url
            ? {
                backend_version: nextSession.backend_version,
                session_id: nextSession.session_id,
                stage: "skeleton_preview",
                structural_mode: nextSession.structural_mode,
                source_character: nextSession.source_character,
                target_character: nextSession.target_character,
                skeleton_image_data_url: nextSession.skeleton_image_data_url,
                stroke_count: 0,
                point_count: 0,
              }
            : null,
        );
        setSkeletonPreviewSignature("");
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        setSessionError(error instanceof Error ? error.message : "Failed to load session");
      });

    return () => {
      isActive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!drawingData) {
      return;
    }
    setSkeletonPreview(null);
    setSkeletonPreviewSignature("");
    if (drawStageTab === "skeleton") {
      setDrawStageTab("draw");
    }
  }, [drawingData?.strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!result?.generated_image_data_url) {
      setInterpretedVectorImage("");
      setFinalRenderImage("");
      setIsPreparingReviewArtifacts(false);
      return;
    }

    if (result.interpreted_vector_data_url || result.final_render_data_url) {
      setInterpretedVectorImage(result.interpreted_vector_data_url);
      setFinalRenderImage(result.final_render_data_url);
      setIsPreparingReviewArtifacts(false);
      return;
    }

    let isActive = true;
    setIsPreparingReviewArtifacts(true);
    void buildReviewArtifacts(
      result.generated_image_data_url,
      drawingData?.brush_size ?? brushSize,
      drawingData?.canvas_size ?? SESSION_CANVAS_SIZE,
    )
      .then((artifacts) => {
        if (!isActive) {
          return;
        }
        setInterpretedVectorImage(artifacts.vectorImageDataUrl);
        setFinalRenderImage(artifacts.finalImageDataUrl);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Failed to prepare review artifacts");
        setInterpretedVectorImage("");
        setFinalRenderImage("");
      })
      .finally(() => {
        if (isActive) {
          setIsPreparingReviewArtifacts(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [result?.generated_image_data_url, drawingData?.brush_size, drawingData?.canvas_size, brushSize]);

  async function handleGenerate() {
    if (sessionId) {
      if (drawStageTab !== "skeleton") {
        const preview = await buildSkeletonPreview(false);
        if (!preview) {
          return;
        }
        await generateFromReference(preview.skeleton_image_data_url);
        return;
      }

      await generateFromReference();
      return;
    }

    if (!referenceBlob) {
      setErrorMessage("Draw a glyph first so the service has a reference image.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const effectiveTargetCharacter = sessionId && session?.stage === "draw"
        ? nextAlphabetCharacter(sourceCharacter)
        : targetCharacter;
      const nextResult = await submitGlyphGeneration(
        referenceBlob,
        sourceCharacter,
        effectiveTargetCharacter,
        correction,
        result?.run_id ?? "",
        sessionId,
        "final",
        drawingData?.brush_size ?? brushSize,
      );
      setTargetCharacter(effectiveTargetCharacter);
      setResult(nextResult);
      setBatchResult(null);
      setDebugHistory((current) => [
        { at: new Date().toISOString(), data: nextResult.debug },
        ...current,
      ].slice(0, 12));
      if (sessionId) {
        const nextSession = await fetchSession(sessionId);
        setSession(nextSession);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function buildSkeletonPreview(revealTab = true): Promise<SkeletonPreviewResponse | null> {
    if (!sessionId) {
      return null;
    }
    if (!drawingData || drawingData.strokes.length === 0) {
      setErrorMessage("Draw a glyph first so the service has vector stroke data.");
      return null;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const preview = await submitSkeletonPreview({
        session_id: sessionId,
        source_character: sourceCharacter,
        target_character: nextAlphabetCharacter(sourceCharacter),
        structural_mode: "stroke-path",
        drawing: drawingData,
      });
      setSkeletonPreview(preview);
      setSkeletonPreviewSignature(buildDrawingSignature(drawingData));
      if (revealTab) {
        setDrawStageTab("skeleton");
      }
      const nextSession = await fetchSession(sessionId);
      setSession(nextSession);
      setTargetCharacter(preview.target_character);
      return preview;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateFromReference(previewImage = skeletonPreviewImage) {
    if (!sessionId) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const effectiveTargetCharacter = nextAlphabetCharacter(sourceCharacter);
      const referenceForGeneration = referenceBlob
        ? referenceBlob
        : previewImage
          ? await rasterizeDataUrlToPngBlob(previewImage, 1024)
          : null;

      if (!referenceForGeneration) {
        setErrorMessage("Draw a glyph first so the service has a reference image.");
        return;
      }

      const nextResult = await submitGlyphGeneration(
        referenceForGeneration,
        sourceCharacter,
        effectiveTargetCharacter,
        correction,
        result?.run_id ?? "",
        sessionId,
        "final",
        drawingData?.brush_size ?? brushSize,
      );
      setTargetCharacter(effectiveTargetCharacter);
      setResult(nextResult);
      setReviewTab("skeleton");
      setBatchResult(null);
      setDebugHistory((current) => [
        { at: new Date().toISOString(), data: nextResult.debug },
        ...current,
      ].slice(0, 12));
      const nextSession = await fetchSession(sessionId);
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReturnToDrawing() {
    if (!sessionId) {
      return;
    }

    setErrorMessage("");
    try {
      const nextSession = await updateSession(sessionId, {
        stage: "draw",
        status: "ready",
        instruction: "Start by drawing one letter. We'll use it to generate the rest of the typeface.",
        skeleton_image_data_url: "",
      });
      setSession(nextSession);
      setSkeletonPreview(null);
      setSkeletonPreviewSignature("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  function handleDrawStageTabChange(nextTab: "draw" | "vector" | "skeleton") {
    if (nextTab === "skeleton") {
      if (
        skeletonPreviewImage &&
        drawingData &&
        skeletonPreviewSignature === buildDrawingSignature(drawingData)
      ) {
        setDrawStageTab("skeleton");
        return;
      }
      void buildSkeletonPreview(true);
      return;
    }
    setDrawStageTab(nextTab);
  }

  async function handleApprove() {
    if (!sessionId) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const nextSession = await requestSessionApprove(sessionId);
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditRequest() {
    if (!sessionId) {
      return;
    }

    setErrorMessage("");

    try {
      const nextSession = await requestSessionEdit(sessionId);
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  async function handleGenerateMore() {
    if (!referenceBlob || !result) {
      setErrorMessage("Generate and keep one accepted glyph first.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const nextBatch = await submitManyGlyphs(referenceBlob, sourceCharacter, ["C", "D", "E", "F", "G", "H"], result.run_id, correction);
      setBatchResult(nextBatch);
      setDebugHistory((current) => [
        { at: new Date().toISOString(), data: nextBatch.items.map((item) => item.debug) },
        ...current,
      ].slice(0, 12));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sessionId) {
    return (
      <main className="page-shell page-shell-session">
        {sessionError ? <p className="error-text">{sessionError}</p> : null}
        {session ? (
          isSubmitting || isAwaitingApproveFollowup ? (
            <section className="session-loading-layout">
              <div className="session-loading-dots" aria-label="Loading">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </div>
            </section>
          ) : session.stage === "review" && result ? (
            <section className="session-review-layout">
              <section className="session-review-frame">
                {reviewTabs}
                {reviewTab === "skeleton" ? (
                  <img className="session-result-image" src={result.generated_image_data_url} alt={`Generated ${result.target_character}`} />
                ) : reviewTab === "vector" ? (
                  interpretedVectorImage ? (
                    <img className="session-result-image" src={interpretedVectorImage} alt={`Interpreted vector for ${result.target_character}`} />
                  ) : (
                    <div className="session-preview-placeholder">
                      {isPreparingReviewArtifacts ? "Preparing vector..." : "Vector interpretation unavailable."}
                    </div>
                  )
                ) : (
                  finalRenderImage ? (
                    <img className="session-result-image" src={finalRenderImage} alt={`Final render for ${result.target_character}`} />
                  ) : (
                    <div className="session-preview-placeholder">
                      {isPreparingReviewArtifacts ? "Preparing final render..." : "Final render unavailable."}
                    </div>
                  )
                )}
              </section>

              {!isAwaitingEditPrompt ? (
                <div className="session-review-actions">
                  <button
                    type="button"
                    className="session-icon-button session-review-edit-button"
                    aria-label="Edit"
                    title="Edit"
                    onClick={handleEditRequest}
                  >
                    <img src={clearIcon} alt="" className="session-icon-image" />
                  </button>
                  <button
                    type="button"
                    className="button session-submit-button session-review-approve-button"
                    aria-label="Approve"
                    title="Approve"
                    onClick={handleApprove}
                  >
                    <img src={approveIcon} alt="" className="session-submit-icon" />
                  </button>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="session-draw-layout">
              {drawStageTab === "vector" ? (
                <div className="session-stage-meta">
                  {drawingData?.brush_label ?? brushLabelForSize(brushSize)} · {strokeCount} strokes · {pointCount} pts
                </div>
              ) : null}
              {drawStageTab === "skeleton" && skeletonPreviewImage ? (
                <>
                  <section className="session-review-frame session-inline-skeleton-frame">
                    {drawStageTabs}
                    <img className="session-result-image" src={skeletonPreviewImage} alt={`Skeleton preview for ${targetCharacter}`} />
                  </section>
                </>
              ) : (
                <DrawingCanvas
                  ref={sessionCanvasRef}
                  onExportReady={setReferenceBlob}
                  onVectorChange={setDrawingData}
                  initialDrawing={drawingData}
                  size={SESSION_CANVAS_SIZE}
                  brushSize={brushSize}
                  showToolbar={false}
                  showActions={false}
                  viewMode={drawStageTab === "vector" ? "vector" : "draw"}
                  overlay={drawStageTabs}
                />
              )}

              <div className="session-draw-controls">
                {BRUSH_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`session-brush-button session-brush-button-${option.label.toLowerCase()}${brushSize === option.value ? " is-active" : ""}`}
                    onClick={() => setBrushSize(option.value)}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <span
                      className="session-brush-dot"
                      style={{ width: option.value, height: option.value }}
                    />
                  </button>
                ))}

                <button type="button" className="session-icon-button" onClick={() => sessionCanvasRef.current?.undo()} aria-label="Undo" title="Undo">
                  <img src={undoIcon} alt="" className="session-icon-image" />
                </button>

                <button type="button" className="session-icon-button" onClick={() => sessionCanvasRef.current?.clear()} aria-label="Clear" title="Clear">
                  <img src={clearIcon} alt="" className="session-icon-image" />
                </button>

                <div className="session-seed-control">
                  <input
                    className="session-letter-input"
                    value={sourceCharacter}
                    maxLength={1}
                    onChange={(event) => setSourceCharacter(normalizeLetter(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSourceCharacter(nextAlphabetCharacter(sourceCharacter));
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSourceCharacter(previousAlphabetCharacter(sourceCharacter));
                      }
                    }}
                  />
                  <div className="session-letter-stepper">
                    <button type="button" className="session-step-button" onClick={() => setSourceCharacter(nextAlphabetCharacter(sourceCharacter))}>
                      <img src={letterUpIcon} alt="" className="session-step-icon" />
                    </button>
                    <button type="button" className="session-step-button" onClick={() => setSourceCharacter(previousAlphabetCharacter(sourceCharacter))}>
                      <img src={letterDownIcon} alt="" className="session-step-icon" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="button session-submit-button"
                  disabled={isSubmitting || (drawStageTab === "skeleton" ? !skeletonPreviewImage : strokeCount === 0)}
                  onClick={handleGenerate}
                >
                  {isSubmitting ? "..." : <img src={sendIcon} alt="" className="session-submit-icon" />}
                </button>
              </div>

              {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
            </section>
          )
        ) : (
          <p>Loading session...</p>
        )}
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="workspace-grid">
        <DrawingCanvas onExportReady={setReferenceBlob} brushSize={brushSize} onBrushSizeChange={setBrushSize} />

        <div className="control-panel">
          <label className="field">
            <span>Source</span>
            <input
              value={sourceCharacter}
              maxLength={1}
              onChange={(event) => setSourceCharacter(event.target.value.toUpperCase() || "A")}
            />
          </label>

          <label className="field">
            <span>Target</span>
            <input
              value={targetCharacter}
              maxLength={1}
              onChange={(event) => setTargetCharacter(event.target.value.toUpperCase() || "B")}
            />
          </label>

          <label className="field">
            <span>
              Correction
              <button type="button" className="inline-clear" onClick={() => setCorrection("")}>
                x
              </button>
            </span>
            <textarea
              rows={5}
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
              placeholder={result?.suggested_revision || "Keep the top edge wobblier. Preserve the squiggle rhythm."}
            />
          </label>

          <button type="button" className="button" disabled={isSubmitting} onClick={handleGenerate}>
            {isSubmitting ? "Generating..." : result ? "Regenerate" : "Generate"}
          </button>

          <button type="button" className="button button-secondary" disabled={isSubmitting || !result} onClick={handleGenerateMore}>
            Generate CDEFGH
          </button>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          {result ? <p className="version-text">backend {result.backend_version}</p> : null}
        </div>
      </section>

      <section className="result-grid">
        <section className="result-panel">
          {result ? (
            <img className="result-image" src={result.generated_image_data_url} alt={`Generated ${result.target_character}`} />
          ) : (
            <div className="result-placeholder" />
          )}
        </section>
      </section>

      {batchResult ? (
        <section className="batch-panel">
          {batchResult.items.map((item) => (
            <figure key={item.run_id} className="batch-item">
              <img className="batch-image" src={item.generated_image_data_url} alt={item.target_character} />
              <figcaption>{item.target_character}</figcaption>
            </figure>
          ))}
        </section>
      ) : null}

      <section className="debug-panel">
        {debugHistory.map((entry, index) => (
          <pre key={`${entry.at}-${index}`} className="debug-entry">
            {JSON.stringify(entry, null, 2)}
          </pre>
        ))}
      </section>
    </main>
  );
}

function readSessionIdFromPath(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const match = window.location.pathname.match(/^\/session\/([^/]+)$/);
  return match?.[1] ?? "";
}

function nextAlphabetCharacter(character: string): string {
  const normalized = normalizeLetter(character);
  if (normalized < "A" || normalized > "Z") {
    return "B";
  }
  if (normalized === "Z") {
    return "A";
  }
  return String.fromCharCode(normalized.charCodeAt(0) + 1);
}

function previousAlphabetCharacter(character: string): string {
  const normalized = normalizeLetter(character);
  if (normalized < "A" || normalized > "Z") {
    return "A";
  }
  if (normalized === "A") {
    return "Z";
  }
  return String.fromCharCode(normalized.charCodeAt(0) - 1);
}

function normalizeLetter(value: string): string {
  const next = value.toUpperCase().slice(0, 1);
  return next || "A";
}

function brushLabelForSize(brushSize: number): string {
  if (brushSize >= 28) {
    return "Large";
  }
  if (brushSize >= 16) {
    return "Medium";
  }
  return "Small";
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function rasterizeDataUrlToPngBlob(dataUrl: string, size: number): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const nextImage = new Image();
    nextImage.onload = () => resolve(nextImage);
    nextImage.onerror = () => reject(new Error("Failed to load skeleton preview image"));
    nextImage.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare skeleton preview canvas");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Failed to rasterize skeleton preview image");
  }
  return blob;
}

function buildDrawingSignature(drawing: DrawingVectorData): string {
  return JSON.stringify(
    drawing.strokes.map((stroke) => ({
      brush_size: stroke.brush_size,
      points: stroke.points.map((point) => [Math.round(point.x), Math.round(point.y)]),
    })),
  );
}

type ReviewArtifacts = {
  vectorImageDataUrl: string;
  finalImageDataUrl: string;
};

type VectorPathPoint = {
  x: number;
  y: number;
};

type VectorTrace = {
  size: number;
  paths: VectorPathPoint[][];
};

async function buildReviewArtifacts(
  dataUrl: string,
  brushSize: number,
  sourceCanvasSize: number,
): Promise<ReviewArtifacts> {
  const trace = await traceVectorPathsFromDataUrl(dataUrl);
  return {
    vectorImageDataUrl: buildVectorSvgDataUrl(trace),
    finalImageDataUrl: await renderBrushPreview(trace, brushSize, sourceCanvasSize),
  };
}

async function traceVectorPathsFromDataUrl(dataUrl: string): Promise<VectorTrace> {
  const image = await loadImage(dataUrl);
  const size = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare vector interpretation canvas");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);

  const { data } = context.getImageData(0, 0, size, size);
  const sampleStep = Math.max(4, Math.round(size / 170));
  const maxJoinDistance = sampleStep * 5.5;
  const minRunLength = Math.max(2, Math.round(sampleStep * 0.65));

  type ActivePath = {
    points: VectorPathPoint[];
    lastX: number;
    matched: boolean;
  };

  const completedPaths: VectorPathPoint[][] = [];
  let activePaths: ActivePath[] = [];

  for (let y = 0; y < size; y += sampleStep) {
    const centers = collectDarkRunCenters(data, size, y, sampleStep, minRunLength);
    const nextActive: ActivePath[] = [];
    for (const path of activePaths) {
      path.matched = false;
    }

    for (const center of centers) {
      let bestMatchIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < activePaths.length; index += 1) {
        const candidate = activePaths[index];
        if (candidate.matched) {
          continue;
        }
        const distance = Math.abs(candidate.lastX - center.x);
        const joinLimit = Math.max(maxJoinDistance, center.width * 0.8);
        if (distance <= joinLimit && distance < bestDistance) {
          bestDistance = distance;
          bestMatchIndex = index;
        }
      }

      if (bestMatchIndex >= 0) {
        const matchedPath = activePaths[bestMatchIndex];
        matchedPath.points.push({ x: center.x, y: center.y });
        matchedPath.lastX = center.x;
        matchedPath.matched = true;
        nextActive.push(matchedPath);
      } else {
        nextActive.push({
          points: [{ x: center.x, y: center.y }],
          lastX: center.x,
          matched: true,
        });
      }
    }

    for (const path of activePaths) {
      if (!path.matched && path.points.length > 1) {
        completedPaths.push(path.points);
      }
    }

    activePaths = nextActive;
  }

  for (const path of activePaths) {
    if (path.points.length > 1) {
      completedPaths.push(path.points);
    }
  }

  if (completedPaths.length === 0) {
    completedPaths.push([
      { x: size * 0.3, y: size * 0.5 },
      { x: size * 0.7, y: size * 0.5 },
    ]);
  }

  return { size, paths: completedPaths };
}

function collectDarkRunCenters(
  data: Uint8ClampedArray,
  size: number,
  y: number,
  sampleStep: number,
  minRunLength: number,
): Array<{ x: number; y: number; width: number }> {
  const rowY = Math.min(size - 1, y + Math.floor(sampleStep / 2));
  const centers: Array<{ x: number; y: number; width: number }> = [];
  let runStart = -1;

  for (let x = 0; x <= size; x += 1) {
    const isDark = x < size ? pixelIsDark(data, size, x, rowY) : false;
    if (isDark && runStart < 0) {
      runStart = x;
      continue;
    }
    if (!isDark && runStart >= 0) {
      const runEnd = x - 1;
      const width = runEnd - runStart + 1;
      if (width >= minRunLength) {
        centers.push({
          x: runStart + width / 2,
          y: rowY,
          width,
        });
      }
      runStart = -1;
    }
  }

  return centers;
}

function pixelIsDark(data: Uint8ClampedArray, size: number, x: number, y: number): boolean {
  const offset = (y * size + x) * 4;
  const alpha = data[offset + 3];
  if (alpha < 16) {
    return false;
  }
  const luminance = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  return luminance < 210;
}

function buildVectorSvgDataUrl(trace: VectorTrace): string {
  const strokeWidth = Math.max(4, trace.size / 180);
  const paths = trace.paths
    .map((path) => {
      const pathData = path
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
      return `<path d="${pathData}" fill="none" stroke="#111111" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${trace.size}" height="${trace.size}" viewBox="0 0 ${trace.size} ${trace.size}"><rect width="${trace.size}" height="${trace.size}" fill="#ffffff" />${paths}</svg>`,
  )}`;
}

async function renderBrushPreview(
  trace: VectorTrace,
  brushSize: number,
  sourceCanvasSize: number,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = trace.size;
  canvas.height = trace.size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare final render canvas");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, trace.size, trace.size);
  context.strokeStyle = "#111111";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, brushSize * (trace.size / Math.max(sourceCanvasSize, 1)));

  for (const path of trace.paths) {
    if (path.length === 0) {
      continue;
    }
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (const point of path.slice(1)) {
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  }

  return canvas.toDataURL("image/png");
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load generated glyph image"));
    image.src = dataUrl;
  });
}

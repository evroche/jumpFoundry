import { useEffect, useRef, useState } from "react";
import clearIcon from "./assets/material-icons/clear.svg";
import approveIcon from "./assets/material-icons/approve.svg";
import { DrawingCanvas, type DrawingCanvasHandle } from "./components/DrawingCanvas";
import letterDownIcon from "./assets/material-icons/letter-down.svg";
import letterUpIcon from "./assets/material-icons/letter-up.svg";
import sendIcon from "./assets/material-icons/send.svg";
import undoIcon from "./assets/material-icons/undo.svg";
import {
  fetchSession,
  requestSessionApprove,
  requestSessionEdit,
  submitGlyphGeneration,
  submitManyGlyphs,
  type BatchResponse,
  type RunResponse,
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
  const [result, setResult] = useState<RunResponse | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResponse | null>(null);
  const [debugHistory, setDebugHistory] = useState<Array<{ at: string; data: unknown }>>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brushSize, setBrushSize] = useState(16);
  const sessionCanvasRef = useRef<DrawingCanvasHandle | null>(null);
  const isAwaitingApproveFollowup = session?.status === "awaiting_hermes_batch_confirmation";
  const isAwaitingEditPrompt = session?.status === "awaiting_hermes_edit_prompt";

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

  async function handleGenerate() {
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
                <img className="session-result-image" src={result.generated_image_data_url} alt={`Generated ${result.target_character}`} />
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
              <DrawingCanvas
                ref={sessionCanvasRef}
                onExportReady={setReferenceBlob}
                size={SESSION_CANVAS_SIZE}
                brushSize={brushSize}
                showToolbar={false}
                showActions={false}
              />

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

                <button type="button" className="button session-submit-button" disabled={isSubmitting || !referenceBlob} onClick={handleGenerate}>
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

import { useEffect, useRef, useState } from "react";
import biggerIcon from "./assets/material-icons/bigger.svg";
import clearIcon from "./assets/material-icons/clearCOMPACT.svg";
import downloadIcon from "./assets/material-icons/download.svg";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type DrawingVectorData,
} from "./components/DrawingCanvas";
import letterDownIcon from "./assets/material-icons/letter-down.svg";
import letterUpIcon from "./assets/material-icons/letter-up.svg";
import redoIcon from "./assets/material-icons/redoCOMPACT.svg";
import smallerIcon from "./assets/material-icons/smaller.svg";
import undoIcon from "./assets/material-icons/undoCOMPACT.svg";
import {
  exportPartialFont,
  fetchRun,
  fetchSession,
  normalizeGlyphSet,
  submitSkeletonPreview,
  submitGlyphGeneration,
  submitManyGlyphs,
  updateSession,
  type AdditionalReferenceInput,
  type BatchResponse,
  type GlyphOutlineExportItem,
  type RunResponse,
  type SkeletonPreviewResponse,
  type SessionResponse,
} from "./lib/api";

const SESSION_CANVAS_SIZE = 720;
const BRUSH_OPTIONS = [
  { value: 32, label: "Large" },
  { value: 19, label: "Medium" },
  { value: 11, label: "Small" },
] as const;
const FIRST_SEED_CHARACTER = "E";
const SECOND_SEED_CHARACTER = "S";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

type SeedReference = {
  character: string;
  blob: Blob;
  previewUrl: string;
};

export default function App() {
  const sessionId = readSessionIdFromPath();
  const previewFontFamily = "FontsketchPreview";
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [sourceCharacter, setSourceCharacter] = useState(FIRST_SEED_CHARACTER);
  const [targetCharacter, setTargetCharacter] = useState(FIRST_SEED_CHARACTER);
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
  const [loadingMessage, setLoadingMessage] = useState("");
  const [postBatchStage, setPostBatchStage] = useState<"grid" | "preview">("grid");
  const [previewText, setPreviewText] = useState("the quick brown fox jumped over the lazy dog");
  const [previewFontSizeOffset, setPreviewFontSizeOffset] = useState(0);
  const [previewFontBlob, setPreviewFontBlob] = useState<Blob | null>(null);
  const [seedReferences, setSeedReferences] = useState<SeedReference[]>([]);
  const [selectedBatchLetters, setSelectedBatchLetters] = useState<string[]>([]);
  const [pendingBatchLetters, setPendingBatchLetters] = useState<string[]>([]);
  const [normalizedExportGlyphs, setNormalizedExportGlyphs] = useState<GlyphOutlineExportItem[]>([]);
  const [brushSize, setBrushSize] = useState(16);
  const [drawStageTab, setDrawStageTab] = useState<"draw" | "vector" | "skeleton">("draw");
  const [drawTabsOpen, setDrawTabsOpen] = useState(false);
  const [reviewTabsOpen, setReviewTabsOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<"skeleton" | "vector" | "final">("skeleton");
  const [interpretedVectorImage, setInterpretedVectorImage] = useState("");
  const [finalRenderImage, setFinalRenderImage] = useState("");
  const [isPreparingReviewArtifacts, setIsPreparingReviewArtifacts] = useState(false);
  const sessionCanvasRef = useRef<DrawingCanvasHandle | null>(null);
  const previewTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transitionStartedAtRef = useRef<number | null>(null);
  const handledRegenerationRef = useRef("");
  const handledAdvanceRequestRef = useRef(false);
  const handledPreviewRequestRef = useRef(false);
  const syncedSessionAssetsRef = useRef("");
  const hydratedRunIdRef = useRef("");
  const hydratingRunIdRef = useRef("");
  const isAwaitingEditPrompt = session?.status === "awaiting_hermes_edit_prompt";
  const isAwaitingFontName = session?.status === "awaiting_font_name";
  const isSessionWorking = Boolean(session && isWorkingSessionStatus(session.status));
  const sessionBatchRunIdsSignature = JSON.stringify(session?.batch_run_ids ?? []);
  const hydratedBatchRunIdsSignature = JSON.stringify(batchResult?.items.map((item) => item.run_id) ?? []);
  const isInlineBatchRevision = Boolean(
    batchResult &&
    session?.stage === "review" &&
    session?.status === "generating_batch"
  );
  const isHydratingFontNamePreview = Boolean(
    sessionId &&
    isAwaitingFontName &&
    result &&
    batchResult &&
    seedReferences.length >= 2 &&
    postBatchStage !== "preview"
  );
  const shouldShowWorkingLoader = !isInlineBatchRevision && Boolean(
    loadingMessage ||
    isSubmitting ||
    isSessionWorking ||
    isHydratingFontNamePreview
  );
  const isHydratingReviewRun = Boolean(
    sessionId &&
    session?.stage === "review" &&
    session?.latest_run_id &&
    !result,
  );

  function beginTransition(message: string) {
    transitionStartedAtRef.current = Date.now();
    setLoadingMessage(message);
  }

  async function endTransition() {
    const startedAt = transitionStartedAtRef.current;
    const minimumVisibleMs = 2400;
    const elapsed = startedAt ? Date.now() - startedAt : minimumVisibleMs;
    const remaining = Math.max(0, minimumVisibleMs - elapsed);
    if (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
    transitionStartedAtRef.current = null;
    setLoadingMessage("");
  }

  const skeletonPreviewImage = skeletonPreview?.skeleton_image_data_url || session?.skeleton_image_data_url || "";
  const strokeCount = drawingData?.strokes.length ?? 0;
  const pointCount = drawingData?.strokes.reduce((count, stroke) => count + stroke.points.length, 0) ?? 0;
  const batchItems = batchResult
    ? (result ? [result, ...batchResult.items] : batchResult.items)
    : [];
  const normalizedGlyphMap = new Map(
    normalizedExportGlyphs.map((glyph) => [normalizeLetter(glyph.character), glyph.image_data_url]),
  );
  const batchGridItems = ALPHABET.map((character) => {
    const normalizedCharacter = normalizeLetter(character);
    const normalizedImageUrl = normalizedGlyphMap.get(normalizedCharacter) ?? "";
    const isPending = pendingBatchLetters.includes(normalizedCharacter);
    const seedReference = seedReferences.find((reference) => normalizeLetter(reference.character) === normalizedCharacter);
    const generatedItem = batchItems.find((item) => normalizeLetter(item.target_character) === normalizedCharacter);
    if (normalizedImageUrl) {
      return {
        key: `normalized-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl: normalizedImageUrl,
        alt: normalizedCharacter,
        isPending,
      };
    }
    if (generatedItem) {
      return {
        key: generatedItem.run_id,
        character: normalizedCharacter,
        imageUrl: generatedItem.generated_image_data_url,
        alt: normalizedCharacter,
        isPending,
      };
    }
    if (seedReference) {
      return {
        key: `seed-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl: seedReference.previewUrl,
        alt: normalizedCharacter,
        isPending,
      };
    }
    return {
      key: `empty-${normalizedCharacter}`,
      character: normalizedCharacter,
      imageUrl: "",
      alt: normalizedCharacter,
      isPending,
    };
  });

  const drawStageTabs = (
    <div className={`session-frame-tabs-shell ${drawTabsOpen ? "is-open" : "is-collapsed"}`}>
      {drawTabsOpen ? (
        <div className="session-frame-tabs">
          <button
            type="button"
            className={`session-view-toggle-button${drawStageTab === "draw" ? " is-active" : ""}`}
            onClick={() => handleDrawStageTabChange("draw")}
          >
            D
          </button>
          <span className="session-frame-tabs-separator" aria-hidden="true">/</span>
          <button
            type="button"
            className={`session-view-toggle-button${drawStageTab === "vector" ? " is-active" : ""}`}
            onClick={() => handleDrawStageTabChange("vector")}
          >
            V
          </button>
          <span className="session-frame-tabs-separator" aria-hidden="true">/</span>
          <button
            type="button"
            className={`session-view-toggle-button${drawStageTab === "skeleton" ? " is-active" : ""}`}
            onClick={() => handleDrawStageTabChange("skeleton")}
          >
            S
          </button>
          <button
            type="button"
            className="session-frame-toggle-button"
            aria-label="Close view controls"
            onClick={() => setDrawTabsOpen(false)}
          >
            -
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="session-frame-toggle-button"
          aria-label="Open view controls"
          onClick={() => setDrawTabsOpen(true)}
        >
          +
        </button>
      )}
    </div>
  );

  function stepSourceCharacter(direction: "next" | "previous") {
    setSourceCharacter((current) =>
      direction === "next" ? nextAlphabetCharacter(current) : previousAlphabetCharacter(current),
    );
  }

  function handleDrawScreenKeys(
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "preventDefault" | "stopPropagation">,
  ) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      stepSourceCharacter("next");
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      stepSourceCharacter("previous");
      return true;
    }

    if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setSourceCharacter(normalizeLetter(event.key));
      return true;
    }

    return false;
  }

  function handlePreviewScreenKeys(
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "preventDefault" | "stopPropagation">,
  ) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      adjustPreviewFontSize("bigger");
      return true;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      adjustPreviewFontSize("smaller");
      return true;
    }

    return false;
  }

  const reviewTabs = (
    <div className={`session-frame-tabs-shell ${reviewTabsOpen ? "is-open" : "is-collapsed"}`}>
      {reviewTabsOpen ? (
        <div className="session-frame-tabs">
          <button
            type="button"
            className={`session-view-toggle-button${reviewTab === "skeleton" ? " is-active" : ""}`}
            onClick={() => setReviewTab("skeleton")}
          >
            A
          </button>
          <span className="session-frame-tabs-separator" aria-hidden="true">/</span>
          <button
            type="button"
            className={`session-view-toggle-button${reviewTab === "vector" ? " is-active" : ""}`}
            onClick={() => setReviewTab("vector")}
          >
            V
          </button>
          <button
            type="button"
            className="session-frame-toggle-button"
            aria-label="Close view controls"
            onClick={() => setReviewTabsOpen(false)}
          >
            -
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="session-frame-toggle-button"
          aria-label="Open view controls"
          onClick={() => setReviewTabsOpen(true)}
        >
          +
        </button>
      )}
    </div>
  );

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    hydratedRunIdRef.current = "";
    hydratingRunIdRef.current = "";
    handledRegenerationRef.current = "";
    handledAdvanceRequestRef.current = false;
    setResult(null);
    setBatchResult(null);
    setSkeletonPreview(null);
    setSkeletonPreviewSignature("");
    setInterpretedVectorImage("");
    setFinalRenderImage("");
    setSeedReferences([]);
    setSelectedBatchLetters([]);
    setPendingBatchLetters([]);
    setNormalizedExportGlyphs([]);
    setReferenceBlob(null);
    setDrawingData(null);
    setPreviewFontBlob(null);
    setPreviewFontSizeOffset(0);
    setPostBatchStage("grid");
    setReviewTab("skeleton");
    setDrawStageTab("draw");
    setDrawTabsOpen(false);
    setReviewTabsOpen(false);
    setErrorMessage("");
    setSessionError("");
    let isActive = true;
    void fetchSession(sessionId)
      .then((nextSession) => {
        if (!isActive) {
          return;
        }
        setSession(nextSession);
        setSourceCharacter(normalizeLetter(nextSession.source_character || FIRST_SEED_CHARACTER));
        setTargetCharacter(normalizeLetter(nextSession.target_character || FIRST_SEED_CHARACTER));
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
    if (!session) {
      return;
    }

    const sessionSeedSignature = JSON.stringify(
      (session.seed_references ?? []).map((reference) => ({
        character: normalizeLetter(reference.character),
        imageDataUrl: reference.image_data_url,
      })),
    );
    const localSeedSignature = JSON.stringify(
      seedReferences.map((reference) => ({
        character: normalizeLetter(reference.character),
        imageDataUrl: reference.previewUrl,
      })),
    );

    if (
      session.seed_references?.length &&
      sessionSeedSignature !== localSeedSignature
    ) {
      setSeedReferences(hydrateSeedReferences(session.seed_references));
    }

    if (!referenceBlob && session.current_drawing_image_data_url) {
      setReferenceBlob(dataUrlToBlob(session.current_drawing_image_data_url));
    }
  }, [session, seedReferences, referenceBlob]);

  useEffect(() => {
    if (!sessionId) {
      syncedSessionAssetsRef.current = "";
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const seedPayload = await Promise.all(
          seedReferences.map(async (reference) => ({
            character: normalizeLetter(reference.character),
            image_data_url: await blobToDataUrl(reference.blob),
          })),
        );
        const currentDrawingImageDataUrl = referenceBlob ? await blobToDataUrl(referenceBlob) : "";
        const syncPayload = JSON.stringify({
          seedPayload,
          currentDrawingImageDataUrl,
        });
        if (syncPayload === syncedSessionAssetsRef.current) {
          return;
        }
        const sessionSeedPayload = JSON.stringify({
          seedPayload: session?.seed_references ?? [],
          currentDrawingImageDataUrl: session?.current_drawing_image_data_url ?? "",
        });
        if (syncPayload === sessionSeedPayload) {
          syncedSessionAssetsRef.current = syncPayload;
          return;
        }
        try {
          await updateSession(sessionId, {
            seed_references: seedPayload,
            current_drawing_image_data_url: currentDrawingImageDataUrl,
          });
          if (!cancelled) {
            syncedSessionAssetsRef.current = syncPayload;
          }
        } catch {
          // Ignore transient sync failures; the next state change or poll can recover.
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [sessionId, session?.seed_references, session?.current_drawing_image_data_url, seedReferences, referenceBlob]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let isActive = true;
    const intervalId = window.setInterval(() => {
      void fetchSession(sessionId)
        .then((nextSession) => {
          if (!isActive) {
            return;
          }
          setSession((current) => {
            if (!current) {
              return nextSession;
            }
            if (JSON.stringify(current) === JSON.stringify(nextSession)) {
              return current;
            }
            return nextSession;
          });
        })
        .catch(() => {
          // Ignore polling errors; the next tick can recover.
        });
    }, 1000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [sessionId]);

  useEffect(() => {
    if (
      !sessionId ||
      !session ||
      session.stage !== "review" ||
      !session.latest_run_id
    ) {
      return;
    }
    if (
      result?.run_id === session.latest_run_id ||
      hydratedRunIdRef.current === session.latest_run_id ||
      hydratingRunIdRef.current === session.latest_run_id
    ) {
      return;
    }

    hydratingRunIdRef.current = session.latest_run_id;
    let isActive = true;
    const runId = session.latest_run_id;
    const abortController = new AbortController();
    void fetchRun(runId, abortController.signal)
      .then((nextRun) => {
        if (!isActive) {
          return;
        }
        hydratedRunIdRef.current = runId;
        hydratingRunIdRef.current = "";
        setResult(nextRun);
        setReviewTab("skeleton");
      })
      .catch(() => {
        if (abortController.signal.aborted) {
          return;
        }
        if (hydratingRunIdRef.current === runId) {
          hydratingRunIdRef.current = "";
        }
        // Ignore transient load errors; polling will retry through session updates.
      });

    return () => {
      isActive = false;
      abortController.abort();
    };
  }, [sessionId, session?.stage, session?.status, session?.latest_run_id, result?.run_id, batchResult]);

  useEffect(() => {
    if (!session?.batch_run_ids?.length || sessionBatchRunIdsSignature === hydratedBatchRunIdsSignature) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const runs = await Promise.all(session.batch_run_ids.map((runId) => fetchRun(runId)));
        if (cancelled || runs.length === 0) {
          return;
        }
        setBatchResult({
          backend_version: runs[0]?.backend_version ?? session.backend_version,
          source_character: result?.target_character ?? session.source_character,
          target_characters: runs.map((run) => run.target_character),
          accepted_run_id: session.latest_run_id,
          items: runs,
        });
        setPostBatchStage("grid");
      } catch {
        // Ignore transient hydration failures; polling can retry after the next session update.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.batch_run_ids, sessionBatchRunIdsSignature, hydratedBatchRunIdsSignature, session?.backend_version, session?.latest_run_id, session?.source_character, result?.target_character]);

  useEffect(() => {
    const nextPendingLetters = (
      session?.pending_revision_characters?.length
        ? session.pending_revision_characters
        : session?.status === "generating_batch"
          ? (session.selected_revision_characters ?? [])
          : []
    ).map(normalizeLetter);
    setPendingBatchLetters((current) => (
      JSON.stringify(current) === JSON.stringify(nextPendingLetters) ? current : nextPendingLetters
    ));
    if (nextPendingLetters.length > 0) {
      setSelectedBatchLetters((current) =>
        current.filter((character) => !nextPendingLetters.includes(normalizeLetter(character))),
      );
    }
  }, [session?.pending_revision_characters]);

  useEffect(() => {
    if (!session?.font_file_data_url || postBatchStage === "preview") {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const fontBlob = dataUrlToBlob(session.font_file_data_url);
        await loadPreviewFont(fontBlob, previewFontFamily);
        if (cancelled) {
          return;
        }
        setPreviewFontBlob(fontBlob);
        setNormalizedExportGlyphs(session.normalized_glyphs ?? []);
        setPostBatchStage("preview");
      } catch {
        // Ignore transient font hydration failures; polling can retry after the next session update.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.font_file_data_url, session?.normalized_glyphs, postBatchStage]);

  useEffect(() => {
    if (postBatchStage !== "preview") {
      return;
    }

    const textarea = previewTextareaRef.current;
    if (!textarea) {
      return;
    }

    const nextFrame = window.requestAnimationFrame(() => {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });

    return () => {
      window.cancelAnimationFrame(nextFrame);
    };
  }, [postBatchStage]);

  useEffect(() => {
    if (
      !sessionId ||
      !isAwaitingFontName ||
      !result ||
      !batchResult ||
      seedReferences.length < 2 ||
      postBatchStage === "preview"
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const nextNormalizedGlyphs = session?.normalized_glyphs?.length
          ? session.normalized_glyphs
          : normalizedExportGlyphs;
        const fontBlob = previewFontBlob ?? await buildPreviewFontBlob(
          sessionId,
          seedReferences,
          result,
          batchResult,
          nextNormalizedGlyphs,
        );
        await loadPreviewFont(fontBlob, previewFontFamily);
        if (cancelled) {
          return;
        }
        setPreviewFontBlob(fontBlob);
        if (session?.normalized_glyphs?.length) {
          setNormalizedExportGlyphs(session.normalized_glyphs);
        }
        setPostBatchStage("preview");
      } catch {
        // Ignore transient hydration failures; polling can retry after the next session update.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    sessionId,
    isAwaitingFontName,
    result,
    batchResult,
    seedReferences,
    postBatchStage,
    previewFontBlob,
    session?.normalized_glyphs,
    normalizedExportGlyphs,
  ]);

  useEffect(() => {
    const shouldPollSession = Boolean(
      sessionId &&
      (
        isSubmitting ||
        !session ||
        session.status !== "ready"
      ),
    );

    if (!sessionId || !shouldPollSession) {
      return;
    }

    const applySessionUpdate = (nextSession: SessionResponse) => {
      setSession((current) => {
        if (!current) {
          return nextSession;
        }
        if (JSON.stringify(current) === JSON.stringify(nextSession)) {
          return current;
        }
        return nextSession;
      });
    };

    void fetchSession(sessionId)
      .then(applySessionUpdate)
      .catch(() => {
        // Ignore transient polling errors while the local backend restarts.
      });

    const interval = window.setInterval(() => {
      void fetchSession(sessionId)
        .then(applySessionUpdate)
        .catch(() => {
          // Ignore transient polling errors while the local backend restarts.
        });
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [sessionId, isSubmitting, session?.status]);

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
    const isDrawScreen = Boolean(sessionId && session?.stage === "draw" && !result && !batchResult && !isSubmitting);
    if (!isDrawScreen) {
      return;
    }

    function handleGlobalLetterStepper(event: KeyboardEvent) {
      const activeElement = document.activeElement;
      const shouldBlurLetterInput =
        activeElement instanceof HTMLInputElement && activeElement.classList.contains("session-letter-input");

      const didHandle = handleDrawScreenKeys(event);
      if (didHandle && shouldBlurLetterInput) {
        activeElement.blur();
      }
    }

    document.addEventListener("keydown", handleGlobalLetterStepper, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalLetterStepper, true);
    };
  }, [sessionId, session?.stage, result, batchResult, isSubmitting]);

  useEffect(() => {
    const isPreviewScreen = Boolean(sessionId && postBatchStage === "preview");
    if (!isPreviewScreen) {
      return;
    }

    function handleGlobalPreviewSizing(event: KeyboardEvent) {
      handlePreviewScreenKeys(event);
    }

    document.addEventListener("keydown", handleGlobalPreviewSizing, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalPreviewSizing, true);
    };
  }, [sessionId, postBatchStage]);

  useEffect(() => {
    if (!result?.generated_image_data_url) {
      setInterpretedVectorImage("");
      setFinalRenderImage("");
      setIsPreparingReviewArtifacts(false);
      return;
    }

    if (result.interpreted_vector_data_url && result.final_render_data_url) {
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

  useEffect(() => {
    if (!sessionId || !result || !batchResult || seedReferences.length < 2) {
      setNormalizedExportGlyphs([]);
      return;
    }

    let isActive = true;
    void (async () => {
      try {
        const glyphs = await buildExportGlyphs(seedReferences, result, batchResult);
        const normalized = await normalizeGlyphSet(sessionId, glyphs);
        if (!isActive) {
          return;
        }
        setNormalizedExportGlyphs(normalized.glyphs);
      } catch {
        if (!isActive) {
          return;
        }
        setNormalizedExportGlyphs([]);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [sessionId, seedReferences, result, batchResult]);

  useEffect(() => {
    if (!sessionId || !batchResult || session?.status === "generating_batch") {
      return;
    }

    const selectedInSession = (session?.selected_revision_characters ?? []).map(normalizeLetter).sort();
    const selectedLocally = selectedBatchLetters.map(normalizeLetter).sort();
    if (JSON.stringify(selectedInSession) === JSON.stringify(selectedLocally)) {
      return;
    }

    void updateSession(sessionId, {
      selected_revision_characters: selectedLocally,
    })
      .then((nextSession) => {
        setSession(nextSession);
      })
      .catch(() => {
        // Ignore transient sync errors; polling can recover.
      });
  }, [sessionId, session?.selected_revision_characters, session?.status, selectedBatchLetters, batchResult]);

  useEffect(() => {
    if (!session) {
      handledAdvanceRequestRef.current = false;
      return;
    }
    if (session.status !== "advance_requested") {
      handledAdvanceRequestRef.current = false;
      return;
    }
    if (handledAdvanceRequestRef.current || isSubmitting) {
      return;
    }
    if (
      result ||
      batchResult ||
      seedReferences.length > 0 ||
      (session.seed_references?.length ?? 0) > 0
    ) {
      return;
    }

    handledAdvanceRequestRef.current = true;
    void (async () => {
      try {
        await generateFromReference();
      } catch {
        handledAdvanceRequestRef.current = false;
        await endTransition();
      }
    })();
  }, [session, batchResult, result, seedReferences, isSubmitting]);

  useEffect(() => {
    if (!session) {
      handledPreviewRequestRef.current = false;
      return;
    }
    if (session.status !== "preview_requested") {
      handledPreviewRequestRef.current = false;
      return;
    }
    if (!session.font_file_data_url && (!result || !batchResult || seedReferences.length < 2)) {
      return;
    }
    if (handledPreviewRequestRef.current || isSubmitting) {
      return;
    }

    handledPreviewRequestRef.current = true;
    void (async () => {
      try {
        await handleOpenFontPreview();
      } catch {
        handledPreviewRequestRef.current = false;
      }
    })();
  }, [session, isSubmitting, previewFontBlob, batchResult, result, seedReferences, normalizedExportGlyphs]);

  async function handleGenerate() {
    if (sessionId) {
      await generateFromReference();
      return;
    }

    if (!referenceBlob) {
      setErrorMessage("Draw a glyph first so the service has a reference image.");
      return;
    }

    setIsSubmitting(true);
    beginTransition("I’m generating your glyph now. Hang tight while I prepare the review.");
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
      hydratedRunIdRef.current = nextResult.run_id;
      hydratingRunIdRef.current = "";
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
      await endTransition();
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
    beginTransition("I’m building the skeleton preview now.");
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
      await endTransition();
    }
  }

  async function generateFromReference(previewImage = skeletonPreviewImage) {
    if (!sessionId) {
      return;
    }

    if (!referenceBlob) {
      setErrorMessage("Draw a glyph first so the service has a reference image.");
      return;
    }

    if (seedReferences.length === 0) {
      setIsSubmitting(true);
      beginTransition("I’m recording your first letter and moving to the next drawing step now.");
      setErrorMessage("");
      try {
        const firstSeedCharacter = normalizeLetter(sourceCharacter || FIRST_SEED_CHARACTER);
        setSeedReferences([
          {
            character: firstSeedCharacter,
            blob: referenceBlob,
            previewUrl: URL.createObjectURL(referenceBlob),
          },
        ]);
        setSourceCharacter(SECOND_SEED_CHARACTER);
        setTargetCharacter(nextAlphabetCharacter(firstSeedCharacter));
        setSkeletonPreview(null);
        setSkeletonPreviewSignature("");
        setDrawStageTab("draw");
        sessionCanvasRef.current?.clear();
        await updateSession(sessionId, {
          source_character: SECOND_SEED_CHARACTER,
          target_character: nextAlphabetCharacter(firstSeedCharacter),
          instruction: 'I recorded your first letter. Now draw the letter "S".\n\nLet me know when you\'re done and I\'ll generate the first sample character for you to review.',
          skeleton_image_data_url: "",
          current_drawing_image_data_url: "",
          status: "ready",
          stage: "draw",
          selected_revision_characters: [],
          batch_run_ids: [],
          normalized_glyphs: [],
          font_file_data_url: "",
        });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsSubmitting(false);
        await endTransition();
      }
      return;
    }

    const nextLetterToReview = nextAlphabetCharacter(seedReferences[0]?.character ?? sourceCharacter);
    setIsSubmitting(true);
    beginTransition(`I’m generating "${nextLetterToReview}" for review now. Hang tight.`);
    setErrorMessage("");

    try {
      setSession((current) => (
        current
          ? {
              ...current,
              status: "generating_single",
              instruction: `I’m generating "${nextLetterToReview}" for review now. Hang tight.`,
            }
          : current
      ));
      await updateSession(sessionId, {
        status: "generating_single",
        instruction: `I’m generating "${nextLetterToReview}" for review now. Hang tight, and then let me know if you’d like to approve it or request changes.`,
        selected_revision_characters: [],
      });
      const primarySeed = seedReferences[0];
      const secondSeed: SeedReference = seedReferences[1] ?? {
        character: normalizeLetter(sourceCharacter || SECOND_SEED_CHARACTER),
        blob: referenceBlob,
        previewUrl: URL.createObjectURL(referenceBlob),
      };
      const nextSeedReferences = seedReferences[1] ? seedReferences : [primarySeed, secondSeed];
      if (!seedReferences[1]) {
        setSeedReferences(nextSeedReferences);
      }
      const effectiveTargetCharacter = nextAlphabetCharacter(primarySeed.character);
      const referenceForGeneration = primarySeed?.blob
        ? primarySeed.blob
        : previewImage
          ? await rasterizeDataUrlToPngBlob(previewImage, 1024)
          : null;

      if (!referenceForGeneration) {
        setErrorMessage("Draw a glyph first so the service has a reference image.");
        return;
      }

      const nextResult = await submitGlyphGeneration(
        referenceForGeneration,
        primarySeed.character,
        effectiveTargetCharacter,
        correction,
        result?.run_id ?? "",
        sessionId,
        "final",
        drawingData?.brush_size ?? brushSize,
        [toAdditionalReference(nextSeedReferences[1])],
      );
      hydratedRunIdRef.current = nextResult.run_id;
      hydratingRunIdRef.current = "";
      setSourceCharacter(primarySeed.character);
      setTargetCharacter(effectiveTargetCharacter);
      setResult(nextResult);
      setSession((current) => (
        current
          ? {
              ...current,
              status: "ready",
              stage: "review",
              source_character: primarySeed.character,
              target_character: effectiveTargetCharacter,
              latest_run_id: nextResult.run_id,
              instruction: `I generated "${effectiveTargetCharacter}". Approve it if it looks right, or message me back to request changes.`,
              selected_revision_characters: [],
              batch_run_ids: [],
              pending_revision_characters: [],
              normalized_glyphs: [],
              font_file_data_url: "",
              current_drawing_image_data_url: "",
            }
          : current
      ));
      setReviewTab("skeleton");
      setBatchResult(null);
      setDebugHistory((current) => [
        { at: new Date().toISOString(), data: nextResult.debug },
        ...current,
      ].slice(0, 12));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
      await endTransition();
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
        instruction: "I'm ready with Fontsketch. Start by drawing one letter, and I'll use it to help generate the rest of the typeface.",
        skeleton_image_data_url: "",
        selected_revision_characters: [],
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
    if (!sessionId || seedReferences.length < 2 || !result) {
      setErrorMessage("Generate and approve one glyph first.");
      return;
    }

    setIsSubmitting(true);
    beginTransition("I’m going to generate the rest of the alphabet now. Hang tight while I build the full set.");
    setErrorMessage("");

    try {
      const approvedCharacter = result.target_character;
      const nextTargets = nextAlphabetCharacters(approvedCharacter, 3);
      const items: RunResponse[] = [];
      const primarySeed = seedReferences[0];
      const secondarySeed = seedReferences[1];
      setSession((current) => (
        current
          ? {
              ...current,
              status: "generating_batch",
              instruction: "I’m going to generate the rest of the alphabet now. Hang tight while I build the full set.",
            }
          : current
      ));
      await updateSession(sessionId, {
        status: "generating_batch",
        instruction: "I’m going to generate the rest of the alphabet now. Hang tight while I build the full set.",
        selected_revision_characters: [],
      });

      for (const nextTarget of nextTargets) {
        const nextItem = await submitGlyphGeneration(
          primarySeed.blob,
          primarySeed.character,
          nextTarget,
          "",
          "",
          "",
          "final",
          drawingData?.brush_size ?? brushSize,
          [toAdditionalReference(secondarySeed)],
        );
        items.push(nextItem);
      }

      const nextBatch: BatchResponse = {
        backend_version: items[0]?.backend_version ?? result.backend_version,
        source_character: approvedCharacter,
        target_characters: nextTargets,
        accepted_run_id: "",
        items,
      };
      setPostBatchStage("grid");
      setPreviewFontBlob(null);
      const nextSession = await updateSession(sessionId, {
        source_character: approvedCharacter,
        target_character: nextTargets[0] ?? nextAlphabetCharacter(approvedCharacter),
        status: "ready",
        stage: "review",
        instruction: "I generated the next set of letters. If you'd like changes, select the letters you'd like to revise and let me know when you're ready.",
        selected_revision_characters: [],
        batch_run_ids: items.map((item) => item.run_id),
        pending_revision_characters: [],
        current_drawing_image_data_url: "",
      });
      setBatchResult(nextBatch);
      setDebugHistory((current) => [
        { at: new Date().toISOString(), data: nextBatch.items.map((item) => item.debug) },
        ...current,
      ].slice(0, 12));
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
      await endTransition();
    }
  }

  async function handleGenerateMore() {
    if (seedReferences.length < 2 || !result) {
      setErrorMessage("Generate and keep one accepted glyph first.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const nextBatch = await submitManyGlyphs(seedReferences[0].blob, seedReferences[0].character, ["C", "D", "E", "F", "G", "H"], result.run_id, correction);
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

  async function handleExportPartialFont() {
    if (!sessionId || seedReferences.length < 2 || !result || !batchResult) {
      setErrorMessage("Generate the two source letters and the resulting set first so the font export has all glyphs.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const fontBlob = previewFontBlob ?? await buildPreviewFontBlob(sessionId, seedReferences, result, batchResult, normalizedExportGlyphs);
      setPreviewFontBlob(fontBlob);
      const normalizedFontName = (session?.font_name || "").trim();
      const downloadName = normalizedFontName
        ? `${slugifyFontName(normalizedFontName)}.ttf`
        : `fontsketch-partial-${sessionId}.ttf`;
      downloadBlob(fontBlob, downloadName);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePrepareFontPreview() {
    if (!sessionId || seedReferences.length < 2 || !result || !batchResult) {
      setErrorMessage("Generate the two source letters and the resulting set first so I can prepare the font preview.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const fontBlob = previewFontBlob ?? await buildPreviewFontBlob(sessionId, seedReferences, result, batchResult, normalizedExportGlyphs);
      setPreviewFontBlob(fontBlob);
      await loadPreviewFont(fontBlob, previewFontFamily);
      setPostBatchStage("preview");
      const nextSession = await updateSession(sessionId, {
        instruction: "Now I'll compile your font and prepare it for download. What name would you like to give your font?",
        status: "awaiting_font_name",
        stage: "review",
        selected_revision_characters: [],
      });
      setSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOpenFontPreview() {
    if (!sessionId || !session) {
      return;
    }

    if (!session.font_file_data_url && (seedReferences.length < 2 || !result || !batchResult)) {
      setErrorMessage("Generate the two source letters and the resulting set first so the font preview has all glyphs.");
      return;
    }

    setIsSubmitting(true);
    beginTransition(session.instruction || "I’m opening the final preview now.");
    setErrorMessage("");

    try {
      const fontBlob = previewFontBlob
        ?? (
          session.font_file_data_url
            ? dataUrlToBlob(session.font_file_data_url)
            : await buildPreviewFontBlob(sessionId, seedReferences, result as RunResponse, batchResult as BatchResponse, normalizedExportGlyphs)
        );
      setPreviewFontBlob(fontBlob);
      await loadPreviewFont(fontBlob, previewFontFamily);
      const nextSession = await updateSession(sessionId, {
        instruction: `Your font${session?.font_name ? ` "${session.font_name}"` : ""} is ready. Click the download button to download and install it on your computer.`,
        status: "ready",
        stage: "review",
        selected_revision_characters: [],
      });
      setSession(nextSession);
      setPostBatchStage("preview");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
      await endTransition();
    }
  }

  function toggleBatchLetterSelection(character: string) {
    if (pendingBatchLetters.includes(character)) {
      return;
    }
    setSelectedBatchLetters((current) =>
      current.includes(character) ? current.filter((item) => item !== character) : [...current, character],
    );
  }

  function adjustPreviewFontSize(direction: "smaller" | "bigger") {
    setPreviewFontSizeOffset((current) => current + (direction === "bigger" ? 6 : -6));
  }

  if (sessionId) {
    return (
      <main className="page-shell page-shell-session">
        {sessionError ? <p className="error-text">{sessionError}</p> : null}
        {session ? (
          shouldShowWorkingLoader ? (
            <section className="session-loading-layout">
              <div className="session-loading-pulse" role="status" aria-label="Loading" />
            </section>
          ) : batchResult ? (
            <section className="session-review-layout">
              {postBatchStage === "grid" ? (
                <div className="session-stage-stack session-stage-stack-wide">
                  <section className="session-review-frame session-batch-frame">
                    <div className="session-batch-grid">
                      {batchGridItems.map((item) => (
                        <div key={item.key} className="session-batch-cell">
                          <button
                            type="button"
                            className={`session-batch-select${selectedBatchLetters.includes(item.character) ? " is-selected" : ""}${item.isPending ? " is-pending" : ""}`}
                            aria-label={item.isPending ? `Revising ${item.character}` : `Select ${item.character}`}
                            disabled={item.isPending}
                            onClick={() => toggleBatchLetterSelection(item.character)}
                          >
                            <span className="session-batch-select-overlay" aria-hidden="true" />
                          </button>
                          {item.imageUrl && !item.isPending ? (
                            <img className="session-batch-image" src={item.imageUrl} alt={item.alt} />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                  <div className="session-review-actions session-review-actions-centered">
                    <div className="session-review-actions-trailing" aria-hidden="true" />
                  </div>
                </div>
              ) : (
                <div className="session-stage-stack session-stage-stack-wide session-font-preview-stage">
                  <section className="session-review-frame session-font-preview-frame">
                    <textarea
                      ref={previewTextareaRef}
                      className="session-font-preview-textarea"
                      value={previewText}
                      onChange={(event) => setPreviewText(event.target.value)}
                      onBlur={(event) => {
                        const textarea = event.currentTarget;
                        const selectionStart = textarea.selectionStart ?? textarea.value.length;
                        const selectionEnd = textarea.selectionEnd ?? selectionStart;
                        window.requestAnimationFrame(() => {
                          textarea.focus();
                          textarea.setSelectionRange(selectionStart, selectionEnd);
                        });
                      }}
                      style={{
                        fontFamily: `"${previewFontFamily}", serif`,
                        fontSize: `calc(clamp(126px, 19.5vw, 288px) + ${previewFontSizeOffset}px)`,
                      }}
                    />
                  </section>
                  <div className="session-review-actions session-review-actions-centered session-font-preview-actions">
                    <button
                      type="button"
                      className="session-icon-button session-font-preview-action-button"
                      onClick={() => adjustPreviewFontSize("smaller")}
                      aria-label="Smaller"
                    >
                      <img src={smallerIcon} alt="" className="session-icon-image" />
                    </button>
                    <button
                      type="button"
                      className="session-icon-button session-font-preview-action-button"
                      onClick={() => adjustPreviewFontSize("bigger")}
                      aria-label="Bigger"
                    >
                      <img src={biggerIcon} alt="" className="session-icon-image" />
                    </button>
                    <button
                      type="button"
                      className="session-submit-button session-review-approve-button session-font-preview-action-button"
                      onClick={handleExportPartialFont}
                      aria-label="Download Font"
                    >
                      <img src={downloadIcon} alt="" className="session-submit-icon" />
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : isHydratingReviewRun ? (
            <section className="session-loading-layout">
              <div className="session-loading-pulse" role="status" aria-label="Loading" />
            </section>
          ) : result ? (
            <section className="session-review-layout">
              <div className="session-stage-stack">
                <section className="session-review-frame">
                  {reviewTabs}
                  {reviewTab === "skeleton" ? (
                    <img className="session-result-image" src={result.generated_image_data_url} alt={`Generated ${result.target_character}`} />
                  ) : (
                    reviewTab === "vector" ? (
                      interpretedVectorImage ? (
                        <img className="session-result-image" src={interpretedVectorImage} alt={`Interpreted vector for ${result.target_character}`} />
                      ) : (
                        <div className="session-preview-placeholder">
                          {isPreparingReviewArtifacts ? "Preparing vector..." : "Vector interpretation unavailable."}
                        </div>
                      )
                    ) : finalRenderImage ? (
                      <img className="session-result-image" src={finalRenderImage} alt={`Final render for ${result.target_character}`} />
                    ) : (
                      <div className="session-preview-placeholder">
                        {isPreparingReviewArtifacts ? "Preparing final render..." : "Final render unavailable."}
                      </div>
                    )
                  )}
                </section>

                <div className="session-review-actions session-review-actions-centered">
                  <div className="session-review-character" aria-label={`Character ${result.target_character}`}>
                    {result.target_character}
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section
              className="session-draw-layout"
              onKeyDownCapture={(event) => {
                handleDrawScreenKeys(event);
              }}
            >
              <div className="session-stage-stack">
                {drawStageTab === "vector" ? (
                  <div className="session-stage-meta">
                    {drawingData?.brush_label ?? brushLabelForSize(brushSize)} · {strokeCount} strokes · {pointCount} pts
                  </div>
                ) : null}
                {drawStageTab === "skeleton" && skeletonPreviewImage ? (
                  <section className="session-review-frame session-inline-skeleton-frame">
                    {drawStageTabs}
                    <img className="session-result-image" src={skeletonPreviewImage} alt={`Skeleton preview for ${targetCharacter}`} />
                  </section>
                  ) : (
                    <DrawingCanvas
                      key={`${sessionId || "local"}-${sourceCharacter}`}
                      ref={sessionCanvasRef}
                      onExportReady={setReferenceBlob}
                      onVectorChange={setDrawingData}
                      size={SESSION_CANVAS_SIZE}
                      brushSize={brushSize}
                      showToolbar={false}
                      showActions={false}
                      viewMode={drawStageTab === "vector" ? "vector" : "draw"}
                      overlay={drawStageTabs}
                    />
                  )}
                <div className="session-draw-controls">
                  <div className="session-seed-control">
                    <input
                      className="session-letter-input"
                      value={sourceCharacter}
                      maxLength={1}
                      readOnly
                      tabIndex={-1}
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                    />
                    <div className="session-letter-stepper">
                      <button type="button" className="session-step-button" onClick={() => stepSourceCharacter("next")}>
                        <img src={letterUpIcon} alt="" className="session-step-icon" />
                      </button>
                      <button type="button" className="session-step-button" onClick={() => stepSourceCharacter("previous")}>
                        <img src={letterDownIcon} alt="" className="session-step-icon" />
                      </button>
                    </div>
                  </div>

                  <div className="session-controls-separator" aria-hidden="true" />

                  {BRUSH_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`session-brush-button session-brush-button-${option.label.toLowerCase()}${brushSize === option.value ? " is-active" : ""}`}
                      onClick={() => setBrushSize(option.value)}
                      aria-label={option.label}
                    >
                      <span
                        className="session-brush-dot"
                        style={{ width: option.value, height: option.value }}
                      />
                    </button>
                  ))}

                  <div className="session-controls-separator" aria-hidden="true" />

                  <button type="button" className="session-icon-button" onClick={() => sessionCanvasRef.current?.undo()} aria-label="Undo">
                    <img src={undoIcon} alt="" className="session-icon-image" />
                  </button>

                  <button type="button" className="session-icon-button" onClick={() => sessionCanvasRef.current?.clear()} aria-label="Clear">
                    <img src={clearIcon} alt="" className="session-icon-image" />
                  </button>
                </div>
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

function nextAlphabetCharacters(character: string, count: number): string[] {
  const items: string[] = [];
  let current = character;
  for (let index = 0; index < count; index += 1) {
    current = nextAlphabetCharacter(current);
    items.push(current);
  }
  return items;
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
  return next || FIRST_SEED_CHARACTER;
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

function formatCharacterList(characters: string[]): string {
  return characters.map(normalizeLetter).join(", ");
}

function slugifyFontName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "fontsketch-font";
}

function isWorkingSessionStatus(status: string): boolean {
  return [
    "advance_requested",
    "generating_single",
    "generating_batch",
    "regenerate_requested",
    "exporting_outlines",
    "normalizing_glyphs",
    "building_font",
  ].includes(status);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",", 2);
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string") {
        resolve(value);
        return;
      }
      reject(new Error("Failed to convert blob to data URL"));
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function buildExportGlyphs(
  seedReferences: SeedReference[],
  result: RunResponse,
  batchResult: BatchResponse,
): Promise<GlyphOutlineExportItem[]> {
  const normalizedSeeds = await Promise.all(
    seedReferences.map(async (reference) => ({
      character: normalizeLetter(reference.character),
      image_data_url: await blobToDataUrl(reference.blob),
    })),
  );
  const glyphs = [
    ...normalizedSeeds,
    {
      character: result.target_character,
      image_data_url: result.generated_image_data_url,
    },
    ...batchResult.items.map((item) => ({
      character: item.target_character,
      image_data_url: item.generated_image_data_url,
    })),
  ];
  const dedupedGlyphs = new Map<string, GlyphOutlineExportItem>();
  for (const glyph of glyphs) {
    dedupedGlyphs.set(normalizeLetter(glyph.character), {
      character: normalizeLetter(glyph.character),
      image_data_url: glyph.image_data_url,
    });
  }
  return Array.from(dedupedGlyphs.values()).sort(
    (left, right) => ALPHABET.indexOf(normalizeLetter(left.character)) - ALPHABET.indexOf(normalizeLetter(right.character)),
  );
}

async function buildPreviewFontBlob(
  sessionId: string,
  seedReferences: SeedReference[],
  result: RunResponse,
  batchResult: BatchResponse,
  normalizedGlyphs: GlyphOutlineExportItem[],
): Promise<Blob> {
  const glyphs = normalizedGlyphs.length > 0
    ? normalizedGlyphs
    : await buildNormalizedExportGlyphs(sessionId, seedReferences, result, batchResult);
  return exportPartialFont(sessionId, glyphs);
}

async function buildNormalizedExportGlyphs(
  sessionId: string,
  seedReferences: SeedReference[],
  result: RunResponse,
  batchResult: BatchResponse,
): Promise<GlyphOutlineExportItem[]> {
  const glyphs = await buildExportGlyphs(seedReferences, result, batchResult);
  const normalized = await normalizeGlyphSet(sessionId, glyphs);
  return normalized.glyphs;
}

function hydrateSeedReferences(seedReferences: GlyphOutlineExportItem[]): SeedReference[] {
  return seedReferences
    .filter((reference) => Boolean(reference.image_data_url))
    .map((reference) => ({
      character: normalizeLetter(reference.character),
      blob: dataUrlToBlob(reference.image_data_url),
      previewUrl: reference.image_data_url,
    }));
}

function toAdditionalReference(reference: SeedReference): AdditionalReferenceInput {
  return {
    blob: reference.blob,
    character: normalizeLetter(reference.character),
  };
}

async function loadPreviewFont(fontBlob: Blob, familyName: string): Promise<void> {
  const fontUrl = URL.createObjectURL(fontBlob);
  const fontFace = new FontFace(familyName, `url(${fontUrl})`);
  await fontFace.load();
  document.fonts.add(fontFace);
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

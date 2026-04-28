import { useEffect, useRef, useState } from "react";
import clearIcon from "./assets/material-icons/clearCOMPACT.svg";
import approveIcon from "./assets/material-icons/approveCOMPACT.svg";
import backIcon from "./assets/material-icons/back.svg";
import downloadIcon from "./assets/material-icons/download.svg";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type DrawingVectorData,
} from "./components/DrawingCanvas";
import letterDownIcon from "./assets/material-icons/letter-down.svg";
import letterUpIcon from "./assets/material-icons/letter-up.svg";
import redoIcon from "./assets/material-icons/redoCOMPACT.svg";
import undoIcon from "./assets/material-icons/undoCOMPACT.svg";
import {
  exportPartialFont,
  fetchRun,
  fetchSession,
  normalizeGlyphSet,
  requestSessionEdit,
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
  const [postBatchStage, setPostBatchStage] = useState<"grid" | "preview">("grid");
  const [previewText, setPreviewText] = useState("the quick brown fox jumped over the lazy dog");
  const [previewFontBlob, setPreviewFontBlob] = useState<Blob | null>(null);
  const [seedReferences, setSeedReferences] = useState<SeedReference[]>([]);
  const [selectedBatchLetters, setSelectedBatchLetters] = useState<string[]>([]);
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
  const handledRegenerationRef = useRef("");
  const hydratedRunIdRef = useRef("");
  const hydratingRunIdRef = useRef("");
  const isAwaitingEditPrompt = session?.status === "awaiting_hermes_edit_prompt";
  const isHydratingReviewRun = Boolean(
    sessionId &&
    session?.stage === "review" &&
    session?.status === "ready" &&
    session?.latest_run_id &&
    !batchResult &&
    !result,
  );
  const skeletonPreviewImage = skeletonPreview?.skeleton_image_data_url || session?.skeleton_image_data_url || "";
  const strokeCount = drawingData?.strokes.length ?? 0;
  const pointCount = drawingData?.strokes.reduce((count, stroke) => count + stroke.points.length, 0) ?? 0;
  const batchItems = batchResult && result ? [result, ...batchResult.items] : [];
  const normalizedGlyphMap = new Map(
    normalizedExportGlyphs.map((glyph) => [normalizeLetter(glyph.character), glyph.image_data_url]),
  );
  const batchGridItems = ALPHABET.map((character) => {
    const normalizedCharacter = normalizeLetter(character);
    const normalizedImageUrl = normalizedGlyphMap.get(normalizedCharacter) ?? "";
    const seedReference = seedReferences.find((reference) => normalizeLetter(reference.character) === normalizedCharacter);
    const generatedItem = batchItems.find((item) => normalizeLetter(item.target_character) === normalizedCharacter);
    if (normalizedImageUrl) {
      return {
        key: `normalized-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl: normalizedImageUrl,
        alt: normalizedCharacter,
      };
    }
    if (seedReference) {
      return {
        key: `seed-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl: seedReference.previewUrl,
        alt: normalizedCharacter,
      };
    }
    if (generatedItem) {
      return {
        key: generatedItem.run_id,
        character: normalizedCharacter,
        imageUrl: generatedItem.generated_image_data_url,
        alt: normalizedCharacter,
      };
    }
    return {
      key: `empty-${normalizedCharacter}`,
      character: normalizedCharacter,
      imageUrl: "",
      alt: normalizedCharacter,
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
    setResult(null);
    setBatchResult(null);
    setSkeletonPreview(null);
    setSkeletonPreviewSignature("");
    setInterpretedVectorImage("");
    setFinalRenderImage("");
    setSeedReferences([]);
    setSelectedBatchLetters([]);
    setNormalizedExportGlyphs([]);
    setReferenceBlob(null);
    setDrawingData(null);
    setPreviewFontBlob(null);
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
    if (
      !sessionId ||
      !session ||
      session.stage !== "review" ||
      session.status !== "ready" ||
      !session.latest_run_id ||
      batchResult ||
      result
    ) {
      return;
    }
    if (
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
  }, [sessionId, session?.stage, session?.status, session?.latest_run_id, result, batchResult]);

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
      !session ||
      session.stage !== "review" ||
      !session.latest_run_id ||
      !result ||
      batchResult ||
      result.run_id === session.latest_run_id
    ) {
      return;
    }

    setResult(null);
    hydratedRunIdRef.current = "";
    hydratingRunIdRef.current = "";
  }, [session?.stage, session?.latest_run_id, result, batchResult]);

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

    const interval = window.setInterval(() => {
      void fetchSession(sessionId)
        .then((nextSession) => {
          setSession(nextSession);
        })
        .catch(() => {
          // Ignore transient polling errors while the local backend restarts.
        });
    }, 1200);

    return () => {
      window.clearInterval(interval);
    };
  }, [sessionId, session, result, batchResult, isSubmitting]);

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
    if (
      !sessionId ||
      !session ||
      session.status !== "regenerate_requested" ||
      !result ||
      seedReferences.length < 2 ||
      isSubmitting
    ) {
      return;
    }

    const correctionKey = `${session.latest_run_id ?? ""}:${session.correction ?? ""}`;
    if (!session.correction || handledRegenerationRef.current === correctionKey) {
      return;
    }

    handledRegenerationRef.current = correctionKey;
    const primarySeed = seedReferences[0];
    const secondarySeed = seedReferences[1];
    const brushSizeForRevision = drawingData?.brush_size ?? brushSize;

    void (async () => {
      setIsSubmitting(true);
      setErrorMessage("");
      try {
        const nextResult = await submitGlyphGeneration(
          primarySeed.blob,
          primarySeed.character,
          result.target_character,
          session.correction ?? "",
          result.run_id,
          sessionId,
          "final",
          brushSizeForRevision,
          [toAdditionalReference(secondarySeed)],
        );
        hydratedRunIdRef.current = nextResult.run_id;
        hydratingRunIdRef.current = "";
        setResult(nextResult);
        setReviewTab("skeleton");
        const nextSession = await fetchSession(sessionId);
        setSession(nextSession);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [sessionId, session, result, seedReferences, isSubmitting, drawingData?.brush_size, brushSize]);

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

    if (!referenceBlob) {
      setErrorMessage("Draw a glyph first so the service has a reference image.");
      return;
    }

    if (seedReferences.length === 0) {
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
        instruction: 'Now draw the letter "S".',
        skeleton_image_data_url: "",
        status: "ready",
        stage: "draw",
      });
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      await updateSession(sessionId, {
        status: "generating_single",
        instruction: `Generating the letter "${nextAlphabetCharacter(seedReferences[0]?.character ?? sourceCharacter)}" now. Wait for the review screen to load.`,
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
              instruction: `Review the generated "${effectiveTargetCharacter}" glyph. Approve it if it looks right, or choose edit to request changes.`,
            }
          : current
      ));
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
    if (!sessionId || seedReferences.length < 2 || !result) {
      setErrorMessage("Generate and approve one glyph first.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const approvedCharacter = result.target_character;
      const nextTargets = nextAlphabetCharacters(approvedCharacter, 3);
      const items: RunResponse[] = [];
      const primarySeed = seedReferences[0];
      const secondarySeed = seedReferences[1];
      await updateSession(sessionId, {
        status: "generating_batch",
        instruction: `Generating the next letters ${nextTargets.join(", ")} now. Wait for the board to load.`,
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
        instruction: `Review the generated letters ${nextTargets.join(", ")} on the board, then continue to the font preview when you're ready.`,
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
      downloadBlob(fontBlob, `fontsketch-partial-${sessionId}.ttf`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOpenFontPreview() {
    if (!sessionId || seedReferences.length < 2 || !result || !batchResult) {
      setErrorMessage("Generate the two source letters and the resulting set first so the font preview has all glyphs.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const fontBlob = previewFontBlob ?? await buildPreviewFontBlob(sessionId, seedReferences, result, batchResult, normalizedExportGlyphs);
      setPreviewFontBlob(fontBlob);
      await loadPreviewFont(fontBlob, previewFontFamily);
      await updateSession(sessionId, {
        instruction: "Test your font in the preview text area. When it feels right, download the font.",
        status: "ready",
        stage: "review",
      });
      setPostBatchStage("preview");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBackToReviewSet() {
    setPostBatchStage("grid");
  }

  function toggleBatchLetterSelection(character: string) {
    setSelectedBatchLetters((current) =>
      current.includes(character) ? current.filter((item) => item !== character) : [...current, character],
    );
  }

  if (sessionId) {
    return (
      <main className="page-shell page-shell-session">
        {sessionError ? <p className="error-text">{sessionError}</p> : null}
        {session ? (
          isSubmitting ? (
            <section className="session-loading-layout">
              <div className="session-loading-dots" aria-label="Loading">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </div>
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
                            className={`session-batch-select${selectedBatchLetters.includes(item.character) ? " is-selected" : ""}`}
                            aria-label={`Select ${item.character}`}
                            onClick={() => toggleBatchLetterSelection(item.character)}
                          >
                            <span className="session-batch-select-overlay" aria-hidden="true" />
                          </button>
                          {item.imageUrl ? (
                            <img className="session-batch-image" src={item.imageUrl} alt={item.alt} />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                  <div className="session-review-actions session-review-actions-centered">
                    <div className="session-review-actions-trailing">
                      <button
                        type="button"
                        className="session-icon-button session-review-placeholder-button"
                        aria-label="Edit selected letters"
                      >
                        <img src={redoIcon} alt="" className="session-icon-image" />
                      </button>
                      <button
                        type="button"
                        className="session-submit-button session-review-approve-button"
                        onClick={handleOpenFontPreview}
                        aria-label="Preview Font"
                      >
                        <img src={approveIcon} alt="" className="session-submit-icon" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="session-stage-stack session-stage-stack-wide">
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
                      style={{ fontFamily: `"${previewFontFamily}", serif` }}
                    />
                  </section>
                  <div className="session-review-actions session-review-actions-centered session-font-preview-actions">
                    <button
                      type="button"
                      className="session-icon-button session-font-preview-action-button"
                      onClick={handleBackToReviewSet}
                      aria-label="Back"
                    >
                      <img src={backIcon} alt="" className="session-icon-image" />
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
              <div className="session-loading-dots" aria-label="Loading">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </div>
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

                {!isAwaitingEditPrompt ? (
                  <div className="session-review-actions session-review-actions-centered">
                    <div className="session-review-actions-trailing">
                      <button
                        type="button"
                        className="session-icon-button session-review-edit-button"
                        aria-label="Edit"
                        onClick={handleEditRequest}
                      >
                        <img src={redoIcon} alt="" className="session-icon-image" />
                      </button>
                      <button
                        type="button"
                        className="session-submit-button session-review-approve-button"
                        aria-label="Approve"
                        onClick={handleApprove}
                      >
                        <img src={approveIcon} alt="" className="session-submit-icon" />
                      </button>
                    </div>
                  </div>
                ) : null}
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

                  <button
                    type="button"
                    className="session-submit-button"
                    disabled={isSubmitting || (drawStageTab === "skeleton" ? !skeletonPreviewImage : strokeCount === 0)}
                    onClick={handleGenerate}
                  >
                    {isSubmitting ? "..." : <img src={approveIcon} alt="" className="session-submit-icon" />}
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
  return [
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

import { useEffect, useRef, useState } from "react";
import approveIcon from "./assets/material-icons/approveCOMPACT.svg";
import biggerIcon from "./assets/material-icons/biggerCOMPACT.svg";
import clearIcon from "./assets/material-icons/clearCOMPACT.svg";
import downloadIcon from "./assets/material-icons/downloadCOMPACT.svg";
import {
  DrawingCanvas,
  type DrawingCanvasHandle,
  type DrawingVectorData,
} from "./components/DrawingCanvas";
import letterDownIcon from "./assets/material-icons/letter-down.svg";
import letterUpIcon from "./assets/material-icons/letter-up.svg";
import redoIcon from "./assets/material-icons/redoCOMPACT.svg";
import smallerIcon from "./assets/material-icons/smallerCOMPACT.svg";
import undoIcon from "./assets/material-icons/undoCOMPACT.svg";
import {
  exportPartialFont,
  fetchRun,
  fetchSession,
  normalizeGlyphSet,
  postHermesFontsketchEvent,
  submitSkeletonPreview,
  submitGlyphGeneration,
  submitGlyphVectorization,
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
const FINAL_RENDER_BRUSH_SCALE = 2;
const FIRST_SEED_CHARACTER = "E";
const SECOND_SEED_CHARACTER = "S";
const SAMPLE_REVIEW_CHARACTER_OFFSET = 8;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const EXTRA_GLYPHS = ["\\", ".", "\""] as const;
const GLYPH_GRID_ORDER = [...ALPHABET, ...EXTRA_GLYPHS];

type SeedReference = {
  character: string;
  blob: Blob;
  previewUrl: string;
};

type PendingHermesConfirm = {
  kind: "draw" | "single" | "alphabet";
  sourceCharacter: string;
  targetCharacter: string;
  latestRunId: string;
  batchRunIdsSignature: string;
  status: string;
  stage: string;
  seedCount: number;
  postBatchStage: "grid" | "preview";
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
  const [pendingHermesConfirm, setPendingHermesConfirm] = useState<PendingHermesConfirm | null>(null);
  const [postBatchStage, setPostBatchStage] = useState<"grid" | "preview">("grid");
  const [previewText, setPreviewText] = useState("the quick brown fox jumped over the lazy dog");
  const [previewFontSizeOffset, setPreviewFontSizeOffset] = useState(0);
  const [previewFontBlob, setPreviewFontBlob] = useState<Blob | null>(null);
  const [seedReferences, setSeedReferences] = useState<SeedReference[]>([]);
  const [selectedBatchLetters, setSelectedBatchLetters] = useState<string[]>([]);
  const [pendingBatchLetters, setPendingBatchLetters] = useState<string[]>([]);
  const [normalizedExportGlyphs, setNormalizedExportGlyphs] = useState<GlyphOutlineExportItem[]>([]);
  const [seedVectorImages, setSeedVectorImages] = useState<Record<string, string>>({});
  const [seedFinalRenderImages, setSeedFinalRenderImages] = useState<Record<string, string>>({});
  const [brushSize, setBrushSize] = useState(16);
  const [batchRenderBrushSize, setBatchRenderBrushSize] = useState(16);
  const [batchAdjustedFinalImages, setBatchAdjustedFinalImages] = useState<Record<string, string>>({});
  const [drawStageTab, setDrawStageTab] = useState<"draw" | "vector" | "skeleton">("draw");
  const [reviewTab, setReviewTab] = useState<"skeleton" | "vector" | "final">("final");
  const [batchViewTab, setBatchViewTab] = useState<"art" | "vector" | "final">("final");
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
  const isWaitingForFontName = Boolean(
    sessionId &&
    isAwaitingFontName &&
    postBatchStage !== "preview"
  );
  const shouldShowWorkingLoader = !isInlineBatchRevision && Boolean(
    loadingMessage ||
    isSubmitting ||
    pendingHermesConfirm ||
    isSessionWorking ||
    isWaitingForFontName
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
  const batchVectorSourceSignature = JSON.stringify(
    batchItems.map((item) => [
      normalizeLetter(item.target_character),
      item.interpreted_vector_data_url,
    ]),
  );
  const seedVectorSignature = JSON.stringify(seedVectorImages);
  const batchAdjustedFinalImagesSignature = JSON.stringify(batchAdjustedFinalImages);
  const normalizedGlyphMap = new Map(
    normalizedExportGlyphs.map((glyph) => [normalizeLetter(glyph.character), glyph.image_data_url]),
  );
  const batchGridItems = GLYPH_GRID_ORDER.map((character) => {
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
  const batchFinalGridItems = GLYPH_GRID_ORDER.map((character) => {
    const normalizedCharacter = normalizeLetter(character);
    const isPending = pendingBatchLetters.includes(normalizedCharacter);
    const seedReference = seedReferences.find((reference) => normalizeLetter(reference.character) === normalizedCharacter);
    const generatedItem = batchItems.find((item) => normalizeLetter(item.target_character) === normalizedCharacter);
    if (generatedItem) {
      return {
        key: `${generatedItem.run_id}-final`,
        character: normalizedCharacter,
        imageUrl:
          batchAdjustedFinalImages[normalizedCharacter]
          || generatedItem.final_render_data_url
          || generatedItem.generated_image_data_url,
        alt: `${normalizedCharacter} final render`,
        isPending,
      };
    }
    if (seedReference) {
      return {
        key: `seed-final-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl:
          batchAdjustedFinalImages[normalizedCharacter]
          || seedFinalRenderImages[normalizedCharacter]
          || seedReference.previewUrl,
        alt: normalizedCharacter,
        isPending,
      };
    }
    return {
      key: `empty-final-${normalizedCharacter}`,
      character: normalizedCharacter,
      imageUrl: "",
      alt: normalizedCharacter,
      isPending,
    };
  });
  const batchVectorGridItems = GLYPH_GRID_ORDER.map((character) => {
    const normalizedCharacter = normalizeLetter(character);
    const isPending = pendingBatchLetters.includes(normalizedCharacter);
    const seedReference = seedReferences.find((reference) => normalizeLetter(reference.character) === normalizedCharacter);
    const generatedItem = batchItems.find((item) => normalizeLetter(item.target_character) === normalizedCharacter);
    if (generatedItem) {
      return {
        key: `${generatedItem.run_id}-vector`,
        character: normalizedCharacter,
        imageUrl: generatedItem.interpreted_vector_data_url
          ? sanitizeVectorSvgDataUrl(generatedItem.interpreted_vector_data_url)
          : generatedItem.generated_image_data_url,
        alt: `${normalizedCharacter} vector trace`,
        isPending,
      };
    }
    if (seedReference) {
      return {
        key: `seed-vector-${normalizedCharacter}`,
        character: normalizedCharacter,
        imageUrl: seedVectorImages[normalizedCharacter]
          ? sanitizeVectorSvgDataUrl(seedVectorImages[normalizedCharacter])
          : seedReference.previewUrl,
        alt: `${normalizedCharacter} vector trace`,
        isPending,
      };
    }
    return {
      key: `empty-vector-${normalizedCharacter}`,
      character: normalizedCharacter,
      imageUrl: "",
      alt: normalizedCharacter,
      isPending,
    };
  });
  const isSkeletonDrawView = drawStageTab === "skeleton" && Boolean(skeletonPreviewImage);

  const drawStageTabs = null;

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

  const reviewTabs = null;

  const batchViewTabs = null;

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
    setSeedFinalRenderImages({});
    setReferenceBlob(null);
    setDrawingData(null);
    setPreviewFontBlob(null);
    setPreviewFontSizeOffset(0);
    setPostBatchStage("grid");
    setReviewTab("final");
    setBatchViewTab("final");
    setDrawStageTab("draw");
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
    if (!pendingHermesConfirm) {
      return;
    }

    const currentSourceCharacter = normalizeLetter(session?.source_character || sourceCharacter);
    const currentTargetCharacter = normalizeLetter(session?.target_character || targetCharacter);
    const currentLatestRunId = session?.latest_run_id || result?.run_id || "";
    const currentBatchRunIdsSignature = JSON.stringify(session?.batch_run_ids ?? []);
    const currentSeedCount = session?.seed_references?.length ?? seedReferences.length;
    const currentStatus = session?.status ?? "ready";
    const currentStage = session?.stage ?? "draw";

    let hasProgress = false;
    if (pendingHermesConfirm.kind === "draw") {
      hasProgress = Boolean(
        currentSourceCharacter !== pendingHermesConfirm.sourceCharacter ||
        currentTargetCharacter !== pendingHermesConfirm.targetCharacter ||
        currentLatestRunId !== pendingHermesConfirm.latestRunId ||
        currentStatus !== pendingHermesConfirm.status ||
        currentStage !== pendingHermesConfirm.stage ||
        currentSeedCount !== pendingHermesConfirm.seedCount ||
        result ||
        batchResult,
      );
    } else if (pendingHermesConfirm.kind === "single") {
      hasProgress = Boolean(
        currentStatus !== pendingHermesConfirm.status ||
        currentLatestRunId !== pendingHermesConfirm.latestRunId ||
        currentBatchRunIdsSignature !== pendingHermesConfirm.batchRunIdsSignature ||
        postBatchStage !== pendingHermesConfirm.postBatchStage ||
        batchResult,
      );
    } else {
      hasProgress = Boolean(
        currentStatus !== pendingHermesConfirm.status ||
        currentStage !== pendingHermesConfirm.stage ||
        postBatchStage !== pendingHermesConfirm.postBatchStage ||
        session?.font_file_data_url,
      );
    }

    if (!hasProgress) {
      return;
    }

    setPendingHermesConfirm(null);
    void endTransition();
  }, [
    pendingHermesConfirm,
    session?.source_character,
    session?.target_character,
    session?.latest_run_id,
    session?.batch_run_ids,
    session?.seed_references,
    session?.status,
    session?.stage,
    session?.font_file_data_url,
    sourceCharacter,
    targetCharacter,
    result,
    batchResult,
    seedReferences.length,
    postBatchStage,
  ]);

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
        setReviewTab("final");
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
  }, [session?.pending_revision_characters, session?.selected_revision_characters, session?.status]);

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

    let isActive = true;
    setIsPreparingReviewArtifacts(true);
    const activeBrushSize = drawingData?.brush_size ?? brushSize;
    const activeCanvasSize = drawingData?.canvas_size ?? SESSION_CANVAS_SIZE;

    void (
      result.interpreted_vector_data_url
        ? Promise.resolve({
            vectorImageDataUrl: sanitizeVectorSvgDataUrl(result.interpreted_vector_data_url),
            finalImageDataUrl: result.final_render_data_url,
          })
        : buildReviewArtifacts(
            result.generated_image_data_url,
            activeBrushSize,
            activeCanvasSize,
          )
    )
      .then((artifacts) => {
        if (!isActive) {
          return;
        }
        const sanitizedVector = sanitizeVectorSvgDataUrl(artifacts.vectorImageDataUrl);
        setInterpretedVectorImage(sanitizedVector);
        void buildReviewDisplayFinalImage(sanitizedVector, activeBrushSize, activeCanvasSize)
          .then((displayFinalImage) => {
            if (!isActive) {
              return;
            }
            setFinalRenderImage(displayFinalImage || artifacts.finalImageDataUrl);
          });
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
    if (seedReferences.length === 0) {
      setSeedVectorImages({});
      setSeedFinalRenderImages({});
      return;
    }

    let isActive = true;
    void (async () => {
      try {
        const renderedEntries = await Promise.all(
          seedReferences.map(async (reference) => {
            const artifacts = await buildReviewArtifacts(
              reference.previewUrl,
              16,
              SESSION_CANVAS_SIZE,
            );
            return [normalizeLetter(reference.character), artifacts] as const;
          }),
        );
        if (!isActive) {
          return;
        }
        setSeedVectorImages(
          Object.fromEntries(
            renderedEntries.map(([character, artifacts]) => [character, artifacts.vectorImageDataUrl]),
          ),
        );
        setSeedFinalRenderImages(
          Object.fromEntries(
            renderedEntries.map(([character, artifacts]) => [character, artifacts.finalImageDataUrl]),
          ),
        );
      } catch {
        if (!isActive) {
          return;
        }
        setSeedVectorImages({});
        setSeedFinalRenderImages({});
      }
    })();

    return () => {
      isActive = false;
    };
  }, [seedReferences]);

  useEffect(() => {
    if (!batchResult?.accepted_run_id) {
      return;
    }
    setBatchRenderBrushSize(drawingData?.brush_size ?? brushSize);
  }, [batchResult?.accepted_run_id, drawingData?.brush_size, brushSize]);

  useEffect(() => {
    if (!batchResult) {
      setBatchAdjustedFinalImages({});
      return;
    }

    const vectorSources = new Map<string, string>();
    for (const item of batchItems) {
      const character = normalizeLetter(item.target_character);
      if (item.interpreted_vector_data_url) {
        vectorSources.set(character, sanitizeVectorSvgDataUrl(item.interpreted_vector_data_url));
      }
    }
    for (const [character, dataUrl] of Object.entries(seedVectorImages)) {
      if (dataUrl) {
        vectorSources.set(normalizeLetter(character), sanitizeVectorSvgDataUrl(dataUrl));
      }
    }

    if (vectorSources.size === 0) {
      setBatchAdjustedFinalImages({});
      return;
    }

    let isActive = true;
    void Promise.all(
      Array.from(vectorSources.entries()).map(async ([character, dataUrl]) => {
        const trace = parseVectorSvgDataUrl(dataUrl);
        if (!trace) {
          return [character, ""] as const;
        }
        const finalImageDataUrl = await renderBrushPreview(trace, batchRenderBrushSize, SESSION_CANVAS_SIZE);
        return [character, finalImageDataUrl] as const;
      }),
    )
      .then((entries) => {
        if (!isActive) {
          return;
        }
        setBatchAdjustedFinalImages(
          Object.fromEntries(entries.filter(([, imageUrl]) => Boolean(imageUrl))),
        );
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setBatchAdjustedFinalImages({});
      });

    return () => {
      isActive = false;
    };
  }, [batchResult, batchVectorSourceSignature, seedVectorSignature, batchRenderBrushSize]);

  useEffect(() => {
    if (!sessionId || !result || !batchResult || seedReferences.length < 2) {
      setNormalizedExportGlyphs([]);
      return;
    }

    let isActive = true;
    void (async () => {
      try {
        const glyphs = await buildExportGlyphs(seedReferences, result, batchResult, batchAdjustedFinalImages);
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
  }, [sessionId, seedReferences, result, batchResult, batchAdjustedFinalImagesSignature]);

  useEffect(() => {
    if (!sessionId || !batchResult) {
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
        ? sampleReviewCharacter(sourceCharacter)
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
        target_character: sampleReviewCharacter(sourceCharacter),
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
        setReferenceBlob(null);
        setDrawingData(null);
        setSourceCharacter(SECOND_SEED_CHARACTER);
        setTargetCharacter(sampleReviewCharacter(firstSeedCharacter));
        setSkeletonPreview(null);
        setSkeletonPreviewSignature("");
        setDrawStageTab("draw");
        sessionCanvasRef.current?.clear();
        await updateSession(sessionId, {
          source_character: SECOND_SEED_CHARACTER,
          target_character: sampleReviewCharacter(firstSeedCharacter),
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

    const nextLetterToReview = sampleReviewCharacter(seedReferences[0]?.character ?? sourceCharacter);
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
      const effectiveTargetCharacter = sampleReviewCharacter(primarySeed.character);
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
      setReviewTab("final");
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
      const nextTargets = [...nextAlphabetCharacters(approvedCharacter, 3), ...EXTRA_GLYPHS];
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
      setBatchViewTab("final");
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
      const fontBlob = previewFontBlob ?? await buildPreviewFontBlob(
        sessionId,
        seedReferences,
        result,
        batchResult,
        normalizedExportGlyphs,
        batchAdjustedFinalImages,
      );
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
            : await buildPreviewFontBlob(
                sessionId,
                seedReferences,
                result as RunResponse,
                batchResult as BatchResponse,
                normalizedExportGlyphs,
                batchAdjustedFinalImages,
              )
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

  function postDrawConfirmedEvent() {
    if (!sessionId) {
      return;
    }
    beginTransition(
      seedReferences.length === 0
        ? "I’m recording your first letter and moving to the next drawing step now."
        : "I’m generating the first sample character for you to review now.",
    );
    setPendingHermesConfirm({
      kind: "draw",
      sourceCharacter: normalizeLetter(session?.source_character || sourceCharacter),
      targetCharacter: normalizeLetter(session?.target_character || targetCharacter || sourceCharacter),
      latestRunId: session?.latest_run_id || result?.run_id || "",
      batchRunIdsSignature: JSON.stringify(session?.batch_run_ids ?? []),
      status: session?.status ?? "ready",
      stage: session?.stage ?? "draw",
      seedCount: session?.seed_references?.length ?? seedReferences.length,
      postBatchStage,
    });
    void postHermesFontsketchEvent({
      eventType: "draw_confirmed",
      fontsketchSessionId: sessionId,
      payload: {
        current_status: "User confirmed the current drawn glyph.",
        source_glyph: normalizeLetter(sourceCharacter),
        target_glyph: normalizeLetter(targetCharacter || sourceCharacter),
        stage: session?.stage ?? "draw",
      },
    }).then((queued) => {
      if (queued) {
        return;
      }
      setPendingHermesConfirm(null);
      void endTransition();
    });
  }

  function postSingleGlyphApprovedEvent() {
    if (!sessionId || !result) {
      return;
    }
    beginTransition("I’m moving on to generate the rest of the alphabet now.");
    setPendingHermesConfirm({
      kind: "single",
      sourceCharacter: normalizeLetter(session?.source_character || result.source_character),
      targetCharacter: normalizeLetter(session?.target_character || result.target_character),
      latestRunId: session?.latest_run_id || result.run_id,
      batchRunIdsSignature: JSON.stringify(session?.batch_run_ids ?? []),
      status: session?.status ?? "ready",
      stage: session?.stage ?? "review",
      seedCount: session?.seed_references?.length ?? seedReferences.length,
      postBatchStage,
    });
    void postHermesFontsketchEvent({
      eventType: "single_glyph_approved",
      fontsketchSessionId: sessionId,
      payload: {
        current_status: "User approved the generated glyph on the single-letter review page.",
        approved_glyph: normalizeLetter(result.target_character),
        source_glyph: normalizeLetter(result.source_character),
      },
    }).then((queued) => {
      if (queued) {
        return;
      }
      setPendingHermesConfirm(null);
      void endTransition();
    });
  }

  function postAlphabetConfirmedEvent() {
    if (!sessionId) {
      return;
    }
    beginTransition("I’m moving on to the next step now.");
    setPendingHermesConfirm({
      kind: "alphabet",
      sourceCharacter: normalizeLetter(session?.source_character || sourceCharacter),
      targetCharacter: normalizeLetter(session?.target_character || targetCharacter),
      latestRunId: session?.latest_run_id || result?.run_id || "",
      batchRunIdsSignature: JSON.stringify(session?.batch_run_ids ?? []),
      status: session?.status ?? "ready",
      stage: session?.stage ?? "review",
      seedCount: session?.seed_references?.length ?? seedReferences.length,
      postBatchStage,
    });
    void (async () => {
      try {
        if (result && batchResult && seedReferences.length >= 2) {
          const exportGlyphOverrides = await buildExportGlyphs(
            seedReferences,
            result,
            batchResult,
            batchAdjustedFinalImages,
          );
          await updateSession(sessionId, {
            export_glyph_overrides: exportGlyphOverrides,
          });
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to prepare the current alphabet for export.");
        setPendingHermesConfirm(null);
        await endTransition();
        return;
      }

      const queued = await postHermesFontsketchEvent({
        eventType: "alphabet_confirmed",
        fontsketchSessionId: sessionId,
        payload: {
          current_status: "User confirmed the alphabet board.",
          selected_revision_characters: selectedBatchLetters.map(normalizeLetter),
          batch_characters: batchItems.map((item) => normalizeLetter(item.target_character)),
        },
      });
      if (queued) {
        return;
      }
      setPendingHermesConfirm(null);
      await endTransition();
    })();
  }

  function postAlphabetRedoEvent() {
    if (!sessionId) {
      return;
    }

    void postHermesFontsketchEvent({
      eventType: "alphabet_redo_requested",
      fontsketchSessionId: sessionId,
      payload: {
        current_status: "User is ready to request changes from the alphabet board.",
        selected_revision_characters: selectedBatchLetters.map(normalizeLetter),
        batch_characters: batchItems.map((item) => normalizeLetter(item.target_character)),
      },
    });
  }

  function adjustBatchRenderBrushSize(direction: "smaller" | "bigger") {
    setBatchRenderBrushSize((current) => {
      const delta = direction === "bigger" ? 6 : -6;
      return Math.max(4, Math.min(144, current + delta));
    });
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
                    {batchViewTabs}
                    <div className="session-batch-grid">
                      {(batchViewTab === "final"
                        ? batchFinalGridItems
                        : batchViewTab === "vector"
                          ? batchVectorGridItems
                          : batchGridItems).map((item) => (
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
                    <button
                      type="button"
                      className="session-icon-button"
                      onClick={() => adjustBatchRenderBrushSize("smaller")}
                      aria-label="Smaller X stroke"
                    >
                      <img src={smallerIcon} alt="" className="session-icon-image" />
                    </button>
                    <button
                      type="button"
                      className="session-icon-button"
                      onClick={() => adjustBatchRenderBrushSize("bigger")}
                      aria-label="Bigger X stroke"
                    >
                      <img src={biggerIcon} alt="" className="session-icon-image" />
                    </button>
                    <button
                      type="button"
                      className="session-icon-button"
                      aria-label="Redo"
                      onClick={postAlphabetRedoEvent}
                    >
                      <img src={redoIcon} alt="" className="session-icon-image" />
                    </button>
                    <button
                      type="button"
                      className="session-icon-button"
                      aria-label="Confirm"
                      onClick={postAlphabetConfirmedEvent}
                    >
                      <img src={approveIcon} alt="" className="session-icon-image" />
                    </button>
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
                  <button
                    type="button"
                    className="session-icon-button"
                    aria-label="Confirm"
                    onClick={postSingleGlyphApprovedEvent}
                  >
                    <img src={approveIcon} alt="" className="session-icon-image" />
                  </button>
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
                {isSkeletonDrawView ? (
                  <section className="session-review-frame session-inline-skeleton-frame">
                    {drawStageTabs}
                    <img className="session-result-image" src={skeletonPreviewImage} alt={`Skeleton preview for ${targetCharacter}`} />
                  </section>
                ) : null}
                <div style={isSkeletonDrawView ? { display: "none" } : undefined}>
                    <DrawingCanvas
                      key={`${sessionId || "local"}-${sourceCharacter}`}
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
                      isHidden={isSkeletonDrawView}
                    />
                </div>
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

                  <div className="session-controls-separator" aria-hidden="true" />

                  <button type="button" className="session-icon-button" aria-label="Confirm" onClick={postDrawConfirmedEvent}>
                    <img src={approveIcon} alt="" className="session-icon-image" />
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

function alphabetCharacterOffset(character: string, steps: number): string {
  let current = normalizeLetter(character);
  for (let index = 0; index < Math.max(steps, 0); index += 1) {
    current = nextAlphabetCharacter(current);
  }
  return current;
}

function sampleReviewCharacter(character: string): string {
  return alphabetCharacterOffset(character, SAMPLE_REVIEW_CHARACTER_OFFSET);
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

function glyphSortIndex(character: string): number {
  const normalized = normalizeLetter(character);
  const index = GLYPH_GRID_ORDER.indexOf(normalized);
  return index >= 0 ? index : GLYPH_GRID_ORDER.length;
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
  finalGlyphImageOverrides: Record<string, string> = {},
): Promise<GlyphOutlineExportItem[]> {
  const normalizedSeeds = await Promise.all(
    seedReferences.map(async (reference) => {
      const character = normalizeLetter(reference.character);
      return {
        character,
        image_data_url: finalGlyphImageOverrides[character] || await blobToDataUrl(reference.blob),
      };
    }),
  );
  const resultCharacter = normalizeLetter(result.target_character);
  const glyphs = [
    ...normalizedSeeds,
    {
      character: resultCharacter,
      image_data_url: finalGlyphImageOverrides[resultCharacter] || result.generated_image_data_url,
    },
    ...batchResult.items.map((item) => ({
      character: normalizeLetter(item.target_character),
      image_data_url:
        finalGlyphImageOverrides[normalizeLetter(item.target_character)] || item.generated_image_data_url,
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
    (left, right) => glyphSortIndex(normalizeLetter(left.character)) - glyphSortIndex(normalizeLetter(right.character)),
  );
}

async function buildPreviewFontBlob(
  sessionId: string,
  seedReferences: SeedReference[],
  result: RunResponse,
  batchResult: BatchResponse,
  normalizedGlyphs: GlyphOutlineExportItem[],
  finalGlyphImageOverrides: Record<string, string> = {},
): Promise<Blob> {
  const glyphs = normalizedGlyphs.length > 0
    ? normalizedGlyphs
    : await buildNormalizedExportGlyphs(sessionId, seedReferences, result, batchResult, finalGlyphImageOverrides);
  return exportPartialFont(sessionId, glyphs);
}

async function buildNormalizedExportGlyphs(
  sessionId: string,
  seedReferences: SeedReference[],
  result: RunResponse,
  batchResult: BatchResponse,
  finalGlyphImageOverrides: Record<string, string> = {},
): Promise<GlyphOutlineExportItem[]> {
  const glyphs = await buildExportGlyphs(seedReferences, result, batchResult, finalGlyphImageOverrides);
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

function sanitizeVectorSvgDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith("data:image/svg+xml")) {
    return dataUrl;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return dataUrl;
  }

  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const whiteRectPattern = /<rect\b[^>]*fill=["']#(?:fff|ffffff)["'][^>]*\/?>/gi;

  try {
    if (metadata.includes(";base64")) {
      const decoded = atob(payload);
      const sanitized = decoded.replace(whiteRectPattern, "");
      if (sanitized === decoded) {
        return dataUrl;
      }
      return `${metadata},${btoa(sanitized)}`;
    }

    const decoded = decodeURIComponent(payload);
    const sanitized = decoded.replace(whiteRectPattern, "");
    if (sanitized === decoded) {
      return dataUrl;
    }
    return `${metadata},${encodeURIComponent(sanitized)}`;
  } catch {
    return dataUrl;
  }
}

function parseVectorSvgDataUrl(dataUrl: string): VectorTrace | null {
  const svg = decodeSvgDataUrl(dataUrl);
  if (!svg) {
    return null;
  }

  const viewBoxMatch = svg.match(/viewBox=["'][^"']*\s([\d.]+)\s([\d.]+)["']/i);
  const widthMatch = svg.match(/width=["']([\d.]+)["']/i);
  const heightMatch = svg.match(/height=["']([\d.]+)["']/i);
  const size = Math.max(
    Number.parseFloat(viewBoxMatch?.[1] ?? "0"),
    Number.parseFloat(viewBoxMatch?.[2] ?? "0"),
    Number.parseFloat(widthMatch?.[1] ?? "0"),
    Number.parseFloat(heightMatch?.[1] ?? "0"),
    1,
  );

  const paths = Array.from(svg.matchAll(/<path\b[^>]*\bd=["']([^"']+)["'][^>]*>/gi))
    .map((match) => parseVectorPathData(match[1] ?? ""))
    .filter((path) => path.length > 0);

  if (paths.length === 0) {
    return null;
  }

  return { size, paths };
}

function decodeSvgDataUrl(dataUrl: string): string | null {
  if (!dataUrl.startsWith("data:image/svg+xml")) {
    return null;
  }

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const metadata = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  try {
    if (metadata.includes(";base64")) {
      return atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function parseVectorPathData(pathData: string): VectorPathPoint[] {
  const points: VectorPathPoint[] = [];
  const commandPattern = /[ML]\s*(-?[\d.]+)\s*,?\s*(-?[\d.]+)/gi;

  for (const match of pathData.matchAll(commandPattern)) {
    const x = Number.parseFloat(match[1] ?? "");
    const y = Number.parseFloat(match[2] ?? "");
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({ x, y });
    }
  }

  return points;
}

async function buildReviewDisplayFinalImage(
  vectorDataUrl: string,
  brushSize: number,
  sourceCanvasSize: number,
): Promise<string> {
  const trace = parseVectorSvgDataUrl(vectorDataUrl);
  if (!trace) {
    return "";
  }
  return renderBrushPreview(trace, brushSize, sourceCanvasSize, false);
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
  try {
    const artifacts = await submitGlyphVectorization(
      dataUrlToBlob(dataUrl),
      brushSize,
    );
    return {
      vectorImageDataUrl: artifacts.interpreted_vector_data_url,
      finalImageDataUrl: artifacts.final_render_data_url,
    };
  } catch (error) {
    console.warn("[fontbuilder] vectorize-preview fallback", error);
    const trace = await traceVectorPathsFromDataUrl(dataUrl);
    return {
      vectorImageDataUrl: buildVectorSvgDataUrl(trace),
      finalImageDataUrl: await renderBrushPreview(trace, brushSize, sourceCanvasSize),
    };
  }
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="${trace.size}" height="${trace.size}" viewBox="0 0 ${trace.size} ${trace.size}">${paths}</svg>`,
  )}`;
}

async function renderBrushPreview(
  trace: VectorTrace,
  brushSize: number,
  sourceCanvasSize: number,
  cropToBounds = true,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = trace.size;
  canvas.height = trace.size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to prepare final render canvas");
  }

  context.strokeStyle = "#111111";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(
    2,
    brushSize * FINAL_RENDER_BRUSH_SCALE * (trace.size / Math.max(sourceCanvasSize, 1)),
  );

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

  if (!cropToBounds) {
    return canvas.toDataURL("image/png");
  }

  return cropCanvasToContentDataUrl(canvas, Math.max(8, Math.round(trace.size * 0.03)));
}

function cropCanvasToContentDataUrl(canvas: HTMLCanvasElement, padding: number): string {
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas.toDataURL("image/png");
  }

  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return canvas.toDataURL("image/png");
  }

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + padding + 1);
  const bottom = Math.min(height, maxY + padding + 1);
  const cropped = document.createElement("canvas");
  cropped.width = right - left;
  cropped.height = bottom - top;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) {
    return canvas.toDataURL("image/png");
  }

  croppedContext.drawImage(
    canvas,
    left,
    top,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height,
  );
  return cropped.toDataURL("image/png");
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load generated glyph image"));
    image.src = dataUrl;
  });
}

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";

export type DrawingPoint = {
  x: number;
  y: number;
};

export type DrawingStroke = {
  points: DrawingPoint[];
  brush_size: number;
  brush_label: string;
};

export type DrawingVectorData = {
  canvas_size: number;
  brush_size: number;
  brush_label: string;
  strokes: DrawingStroke[];
};

export type DrawingViewMode = "draw" | "vector";

type DrawingCanvasProps = {
  onExportReady: (blob: Blob | null) => void;
  onVectorChange?: (drawing: DrawingVectorData) => void;
  size?: number;
  brushSize?: number;
  onBrushSizeChange?: (value: number) => void;
  showToolbar?: boolean;
  showActions?: boolean;
  viewMode?: DrawingViewMode;
  overlay?: ReactNode;
};

export type DrawingCanvasHandle = {
  clear: () => void;
  undo: () => void;
};

const CANVAS_SIZE = 360;
const BRUSH_RENDER_SCALE = 1.832;

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
  onExportReady,
  onVectorChange,
  size = CANVAS_SIZE,
  brushSize = 16,
  onBrushSizeChange,
  showToolbar = true,
  showActions = true,
  viewMode = "draw",
  overlay = null,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<DrawingStroke | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    renderDrawing(context, size, strokes, currentStrokeRef.current, viewMode, null);
  }, [size, strokes, viewMode]);

  useEffect(() => {
    if (!onVectorChange) {
      return;
    }
    onVectorChange({
      canvas_size: size,
      brush_size: brushSize,
      brush_label: getBrushLabel(brushSize),
      strokes,
    });
  }, [brushSize, onVectorChange, size, strokes]);

  useEffect(() => {
    if (strokes.length === 0) {
      onExportReady(null);
      return;
    }
    void exportRasterPreview();
  }, [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const point = getPoint(event);
    const nextStroke: DrawingStroke = {
      points: [point],
      brush_size: brushSize,
      brush_label: getBrushLabel(brushSize),
    };
    currentStrokeRef.current = nextStroke;
    isDrawingRef.current = true;
    redrawCanvas(nextStroke);
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || !currentStrokeRef.current) {
      return;
    }

    const point = getPoint(event);
    currentStrokeRef.current = {
      ...currentStrokeRef.current,
      points: [...currentStrokeRef.current.points, point],
    };
    redrawCanvas(currentStrokeRef.current);
  }

  function stopDrawing(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (event && canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }

    isDrawingRef.current = false;
    const active = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (active && active.points.length > 0) {
      setStrokes((existing) => [...existing, active]);
    } else {
      redrawCanvas(null);
    }
  }

  async function exportRasterPreview() {
    const offscreen = document.createElement("canvas");
    offscreen.width = size;
    offscreen.height = size;
    const context = offscreen.getContext("2d");
    if (!context) {
      onExportReady(null);
      return;
    }

    renderDrawing(context, size, strokes, null, "draw", null);
    const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, "image/png"));
    onExportReady(blob);
  }

  function clearCanvas() {
    setStrokes([]);
    currentStrokeRef.current = null;
    isDrawingRef.current = false;
    onExportReady(null);
  }

  function undoStroke() {
    currentStrokeRef.current = null;
    isDrawingRef.current = false;
    setStrokes((existing) => existing.slice(0, -1));
  }

  useImperativeHandle(ref, () => ({
    clear: clearCanvas,
    undo: undoStroke,
  }));

  return (
    <div className="canvas-panel">
      {showToolbar ? (
        <div className="canvas-toolbar">
          <span>Draw</span>
        </div>
      ) : null}
      <div className="drawing-canvas-shell">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="drawing-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
        {overlay ? <div className="drawing-canvas-overlay">{overlay}</div> : null}
      </div>
      {showActions ? (
        <div className="canvas-actions">
          <label className="brush-control">
            <span>Brush</span>
            <select
              value={brushSize}
              onChange={(event) => onBrushSizeChange?.(Number(event.target.value))}
            >
              <option value={8}>Thin</option>
              <option value={16}>Medium</option>
              <option value={24}>Bold</option>
              <option value={32}>Heavy</option>
            </select>
          </label>
          <button type="button" onClick={undoStroke} className="clear-link">
            Undo
          </button>
          <button type="button" onClick={clearCanvas} className="clear-link">
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );

  function redrawCanvas(currentStrokeOverride: DrawingStroke | null = currentStrokeRef.current) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    renderDrawing(context, size, strokes, currentStrokeOverride, viewMode, null);
  }
});

function renderDrawing(
  context: CanvasRenderingContext2D,
  size: number,
  strokes: DrawingStroke[],
  currentStroke: DrawingStroke | null,
  viewMode: DrawingViewMode,
  backgroundFill: string | null,
) {
  context.clearRect(0, 0, size, size);
  if (backgroundFill) {
    context.fillStyle = backgroundFill;
    context.fillRect(0, 0, size, size);
  }

  const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes;
  if (viewMode === "vector") {
    for (const stroke of allStrokes) {
      drawVectorStroke(context, stroke);
    }
    return;
  }

  for (const stroke of allStrokes) {
    drawBrushStroke(context, stroke);
  }
}

function drawBrushStroke(context: CanvasRenderingContext2D, stroke: DrawingStroke) {
  if (stroke.points.length === 0) {
    return;
  }

  const renderedBrushSize = stroke.brush_size * BRUSH_RENDER_SCALE;
  context.strokeStyle = "#111111";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = renderedBrushSize;
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.arc(point.x, point.y, renderedBrushSize / 2, 0, Math.PI * 2);
    context.fillStyle = "#111111";
    context.fill();
    return;
  }

  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawVectorStroke(context: CanvasRenderingContext2D, stroke: DrawingStroke) {
  if (stroke.points.length === 0) {
    return;
  }

  context.strokeStyle = "#111111";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, stroke.brush_size * 0.18);
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();

  context.fillStyle = "#111111";
  for (const point of stroke.points) {
    context.beginPath();
    context.arc(point.x, point.y, 1.75, 0, Math.PI * 2);
    context.fill();
  }
}

function getBrushLabel(brushSize: number): string {
  if (brushSize >= 28) {
    return "Large";
  }
  if (brushSize >= 16) {
    return "Medium";
  }
  return "Small";
}

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type DrawingCanvasProps = {
  onExportReady: (blob: Blob | null) => void;
  size?: number;
  brushSize?: number;
  onBrushSizeChange?: (value: number) => void;
  showToolbar?: boolean;
  showActions?: boolean;
};

export type DrawingCanvasHandle = {
  clear: () => void;
  undo: () => void;
};

const CANVAS_SIZE = 360;

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
  onExportReady,
  size = CANVAS_SIZE,
  brushSize = 16,
  onBrushSizeChange,
  showToolbar = true,
  showActions = true,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const historyRef = useRef<ImageData[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111111";
    context.lineWidth = brushSize;
  }, [brushSize, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.lineWidth = brushSize;
  }, [brushSize]);

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
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const point = getPoint(event);
    historyRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    context.beginPath();
    context.moveTo(point.x, point.y);
    setIsDrawing(true);
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  async function exportCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) {
      onExportReady(null);
      return;
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    onExportReady(blob);
  }

  function stopDrawing(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (event && canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    setIsDrawing(false);
    void exportCanvas();
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, size, size);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    historyRef.current = [];
    onExportReady(null);
  }

  function undoStroke() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const previous = historyRef.current.pop();
    if (!canvas || !context || !previous) {
      return;
    }
    context.putImageData(previous, 0, 0);
    void exportCanvas();
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
});

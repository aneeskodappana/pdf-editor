"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: PointerEvent | ReactPointerEvent<HTMLCanvasElement>,
) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

export function SignaturePad({
  onSave,
  isOpen,
  hasSavedSignature,
  onToggle,
}: {
  onSave: (dataUrl: string) => void;
  isOpen: boolean;
  hasSavedSignature: boolean;
  onToggle: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) return;

    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getCanvasPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.01, point.y + 0.01);
    context.stroke();
    setDrawing(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const point = getCanvasPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing(event?: ReactPointerEvent<HTMLCanvasElement>) {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="signature-dock-button"
        onClick={onToggle}
      >
        Signature{hasSavedSignature ? " ready" : ""}
      </button>
    );
  }

  return (
    <div className="floating-widget signature-widget">
      <div className="widget-head">
        <strong>Signature</strong>
        <button type="button" className="ghost-button widget-close" onClick={onToggle}>
          Hide
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={360}
        height={150}
        className="signature-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
      />
      <div className="toolbar-inline">
        <button type="button" className="ghost-button" onClick={clear}>
          Clear
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            onSave(canvas.toDataURL("image/png"));
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

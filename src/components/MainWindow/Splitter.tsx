"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export interface SplitterProps {
  // Pointer drag: the pointer's clientX on every move.
  onResize: (clientX: number) => void;
  // Keyboard nudge: grow (+) or shrink (−) the detail pane by `delta` px.
  onStep?: (delta: number) => void;
  // Home / End jump to an edge; double-click restores the default.
  onSetWidth?: (width: number) => void;
  onReset?: () => void;
  // Current / min / max detail width, exposed as the separator's ARIA value.
  value?: number;
  min?: number;
  max?: number;
  ariaLabel?: string;
}

const STEP = 16;
const BIG_STEP = 64;

export function Splitter({
  onResize,
  onStep,
  onSetWidth,
  onReset,
  value,
  min,
  max,
  ariaLabel = "Resize detail pane",
}: SplitterProps) {
  const draggingRef = useRef(false);

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  // Pointer capture keeps move/up events flowing to the splitter even when
  // the pointer leaves it — or the window — so a drag can't get stuck "on"
  // after releasing outside.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) onResize(e.clientX);
  };

  // The splitter sits left of the detail pane, so ArrowLeft widens it.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    if (e.key === "ArrowLeft") onStep?.(step);
    else if (e.key === "ArrowRight") onStep?.(-step);
    else if (e.key === "Home" && min != null) onSetWidth?.(min);
    else if (e.key === "End" && max != null && Number.isFinite(max)) onSetWidth?.(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max != null && Number.isFinite(max) ? max : undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      style={{
        cursor: "col-resize",
        background: "var(--color-border)",
        position: "relative",
        touchAction: "none",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "0 -3px",
        }}
      />
    </div>
  );
}

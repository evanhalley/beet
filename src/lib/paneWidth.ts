// Detail-pane sizing for the main window's list | splitter | detail grid.
//
// The detail pane has a fixed floor but no fixed ceiling: it can grow until
// the list pane is squeezed down to LIST_MIN_WIDTH. The user's preferred width
// is stored as-is and clamped against the space available at render time, so
// shrinking the window (or expanding the sidebar) temporarily narrows the
// pane and growing it back restores the preference.

export const DETAIL_WIDTH_DEFAULT = 380;
export const DETAIL_WIDTH_MIN = 280;
export const LIST_MIN_WIDTH = 320;
export const SPLITTER_WIDTH = 1;

// Widest the detail pane may be inside a grid `gridWidth` px wide. Never
// below the floor, so a cramped window degrades to the floor instead of
// collapsing the pane.
export function maxDetailWidth(gridWidth: number): number {
  if (!Number.isFinite(gridWidth) || gridWidth <= 0) return Infinity;
  return Math.max(
    DETAIL_WIDTH_MIN,
    Math.floor(gridWidth - LIST_MIN_WIDTH - SPLITTER_WIDTH),
  );
}

// Clamp `w` into [DETAIL_WIDTH_MIN, maxDetailWidth(gridWidth)]. Pass an
// unknown (0 / NaN) grid width to apply only the floor, e.g. when hydrating a
// stored preference before layout has been measured.
export function clampDetailWidth(w: number, gridWidth = 0): number {
  if (!Number.isFinite(w)) return DETAIL_WIDTH_DEFAULT;
  return Math.min(
    maxDetailWidth(gridWidth),
    Math.max(DETAIL_WIDTH_MIN, Math.round(w)),
  );
}

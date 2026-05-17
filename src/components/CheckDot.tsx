import { Check, X } from "lucide-react";

export type CheckDotState = "success" | "failure" | "pending" | "neutral";

const TITLES: Record<CheckDotState, string> = {
  success: "Checks passing",
  failure: "Checks failing",
  pending: "Checks pending",
  neutral: "No checks",
};

const COLORS: Record<CheckDotState, string> = {
  success: "var(--color-success)",
  failure: "var(--color-danger)",
  pending: "var(--color-warn)",
  neutral: "var(--color-text-faint)",
};

// Direct port of the design's CheckDot (design/src/ui.jsx:79-91). 14×14
// wrapper with a state-colored glyph: check for success, X for failure, a
// solid 6×6 dot that blinks for pending, nothing for neutral.
export function CheckDot({ state }: { state: CheckDotState }) {
  return (
    <span
      role="img"
      aria-label={TITLES[state]}
      title={TITLES[state]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 7,
        color: COLORS[state],
        animation:
          state === "pending" ? "beet-blink 1.2s ease-in-out infinite" : "none",
        flexShrink: 0,
      }}
    >
      {state === "success" && <Check size={12} aria-hidden />}
      {state === "failure" && <X size={12} aria-hidden />}
      {state === "pending" && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: "currentColor",
            display: "block",
          }}
          aria-hidden
        />
      )}
      {state === "neutral" && <span aria-hidden />}
    </span>
  );
}

// Map a CheckRunSummary (status + conclusion) to the dot's visual state.
// Matches the design's derivation exactly (design/src/main-window.jsx:313):
// only "success" → success, only "failure" → failure, "in_progress" status
// → pending; everything else (queued, cancelled, timed_out, action_required,
// etc.) collapses to neutral.
export function deriveCheckDotState(
  status: string | undefined,
  conclusion: string | undefined,
): CheckDotState {
  if (conclusion === "success") return "success";
  if (conclusion === "failure") return "failure";
  if (status === "in_progress") return "pending";
  return "neutral";
}

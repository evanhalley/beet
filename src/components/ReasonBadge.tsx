import type { NeedsActionReason } from "@/lib/needsAction";
import { Pill } from "./Pill";

export type Reason = NeedsActionReason;

export interface ReasonBadgeProps {
  reason: Reason;
}

export function ReasonBadge({ reason }: ReasonBadgeProps) {
  if (reason === "ejected") return <Pill tone="danger">Kicked from queue</Pill>;
  if (reason === "checks_failing") return <Pill tone="danger">Checks failing</Pill>;
  if (reason === "mention") return <Pill tone="info">@mention</Pill>;
  if (reason === "reply") return <Pill tone="info">Review reply</Pill>;
  return null;
}

import { Pill } from "./Pill";

export type Reason = "ejected" | "checks_failing" | "mention";

export interface ReasonBadgeProps {
  reason: Reason;
}

export function ReasonBadge({ reason }: ReasonBadgeProps) {
  if (reason === "ejected") return <Pill tone="danger">Kicked from queue</Pill>;
  if (reason === "checks_failing") return <Pill tone="danger">Checks failing</Pill>;
  if (reason === "mention") return <Pill tone="info">@mention</Pill>;
  return null;
}

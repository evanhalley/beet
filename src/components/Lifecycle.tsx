import { Pill } from "./Pill";
import type { PrLifecycle } from "@/lib/types";

export interface LifecycleProps {
  state: PrLifecycle;
  mqPos?: number | null;
}

export function Lifecycle({ state, mqPos }: LifecycleProps) {
  if (state === "merge_queue") {
    return (
      <Pill tone="accent" mono>
        queue · {mqPos ?? "?"}
      </Pill>
    );
  }
  if (state === "in_review") return <Pill tone="info">in review</Pill>;
  if (state === "open") return <Pill tone="neutral">open</Pill>;
  if (state === "merged") return <Pill tone="accent">merged</Pill>;
  return <Pill tone="neutral">{state}</Pill>;
}

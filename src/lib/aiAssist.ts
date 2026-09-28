import type { AiAssist, AiSource } from "@/lib/types";

const SOURCE_LABELS: Record<AiSource, string> = {
  pr_author: "PR author",
  commit_author: "commit author",
  commit_message: "commit trailers",
  pr_body: "PR description",
};

/// "Claude, Copilot · commit trailers, PR description" — the pill tooltip and
/// the detail header line.
export function describeAiAssist(ai: AiAssist): string {
  const sources = ai.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ");
  return sources ? `${ai.tools.join(", ")} · ${sources}` : ai.tools.join(", ");
}

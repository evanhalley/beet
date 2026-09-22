"use client";

import { InFlightSection } from "@/components/InFlightSection";
import { NeedsActionSection } from "@/components/NeedsActionSection";
import { RecentlyResolvedSection } from "@/components/RecentlyResolvedSection";
import { ReviewRequestsSection } from "@/components/ReviewRequestsSection";
import { StandaloneRunsSection } from "@/components/StandaloneRunsSection";

export function ListPane() {
  return (
    <div
      aria-label="List"
      style={{
        borderLeft: "1px solid var(--color-border)",
        overflow: "auto",
        background: "var(--color-bg)",
      }}
    >
      <NeedsActionSection />
      <ReviewRequestsSection />
      <InFlightSection />
      <StandaloneRunsSection />
      <RecentlyResolvedSection />
    </div>
  );
}

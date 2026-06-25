"use client";

import { useQuery } from "@tanstack/react-query";
import { isMockMode } from "@/lib/mock";

// Reads the backend's mock-mode flag once (it can't change without a restart).
// Consumed by the auth gate in page.tsx to render the populated UI without a
// PAT when `BEET_MOCK=1`.
export function useMockMode(): boolean {
  const { data } = useQuery({
    queryKey: ["mockMode"],
    queryFn: isMockMode,
    staleTime: Infinity,
  });
  return data ?? false;
}

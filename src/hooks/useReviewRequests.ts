"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchReviewRequests } from "@/lib/github/prs";
import { selectShowAllReviews, useAppStore } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import type { ActionableItem } from "@/lib/types";

export interface UseReviewRequestsResult {
  items: ActionableItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useReviewRequests(): UseReviewRequestsResult {
  const { auth } = useAuth();
  const username = auth?.login ?? null;
  const settings = useAppStore((s) => s.settings);
  const showAll = useAppStore(selectShowAllReviews);

  const enabled = !!username;

  const query = useQuery({
    queryKey: [
      "review-requests",
      username,
      settings.teams,
      settings.penalizedBots,
      settings.taskRegex,
      showAll,
    ],
    queryFn: () =>
      fetchReviewRequests({
        username: username!,
        teams: settings.teams,
        penalizedBots: settings.penalizedBots,
        taskRegex: settings.taskRegex,
        showAll,
      }),
    enabled,
    refetchInterval: enabled
      ? Math.max(15, Math.min(600, settings.pollingIntervalSec)) * 1000
      : false,
    staleTime: 0,
  });

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      query.refetch();
    },
  };
}

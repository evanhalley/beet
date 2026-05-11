"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReviewRequests } from "@/lib/github/prs";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

export interface UseReviewRequestsResult {
  items: ActionableItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useReviewRequests(): UseReviewRequestsResult {
  const username = useAppStore((s) => s.user?.login ?? null);
  const settings = useAppStore((s) => s.settings);
  const showAllReviews = useAppStore((s) => s.showAllReviews);
  const setActionableItems = useAppStore((s) => s.setActionableItems);

  const enabled = !!username;

  const query = useQuery({
    queryKey: [
      "review-requests",
      username,
      settings.teams,
      settings.penalizedBots,
      settings.taskRegex,
      showAllReviews,
    ],
    queryFn: () =>
      fetchReviewRequests({
        username: username!,
        teams: settings.teams,
        penalizedBots: settings.penalizedBots,
        taskRegex: settings.taskRegex,
        showAll: showAllReviews,
      }),
    enabled,
    refetchInterval: enabled
      ? Math.max(15, settings.pollingIntervalSec) * 1000
      : false,
    staleTime: 0,
  });

  useEffect(() => {
    if (query.data) setActionableItems(query.data);
  }, [query.data, setActionableItems]);

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

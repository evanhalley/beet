"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchReviewRequests } from "@/lib/github/prs";
import { selectShowAllReviews, useAppStore } from "@/lib/store";

export interface UseReviewRequestsResult {
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useReviewRequests(): UseReviewRequestsResult {
  const username = useAppStore((s) => s.user?.login ?? null);
  const settings = useAppStore((s) => s.settings);
  const showAll = useAppStore(selectShowAllReviews);
  const setReviewRequests = useAppStore((s) => s.setReviewRequests);

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

  useEffect(() => {
    if (query.data) setReviewRequests(query.data);
  }, [query.data, setReviewRequests]);

  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      query.refetch();
    },
  };
}

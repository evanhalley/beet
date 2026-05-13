"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMyOpenPrs } from "@/lib/github/prs";
import { useAppStore } from "@/lib/store";

export interface UseMyOpenPrsResult {
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useMyOpenPrs(): UseMyOpenPrsResult {
  const username = useAppStore((s) => s.user?.login ?? null);
  const taskRegex = useAppStore((s) => s.settings.taskRegex);
  const pollingIntervalSec = useAppStore((s) => s.settings.pollingIntervalSec);
  const setInFlight = useAppStore((s) => s.setInFlight);

  const enabled = !!username;

  const query = useQuery({
    queryKey: ["my-open-prs", username, taskRegex],
    queryFn: () => fetchMyOpenPrs({ username: username!, taskRegex }),
    enabled,
    refetchInterval: enabled
      ? Math.max(15, Math.min(600, pollingIntervalSec)) * 1000
      : false,
    staleTime: 0,
  });

  useEffect(() => {
    if (query.data) setInFlight(query.data);
  }, [query.data, setInFlight]);

  return {
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      query.refetch();
    },
  };
}

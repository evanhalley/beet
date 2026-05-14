"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMyOpenPrs } from "@/lib/github/prs";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import type { ActionableItem } from "@/lib/types";

export interface UseMyOpenPrsResult {
  items: ActionableItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => void;
}

export function useMyOpenPrs(): UseMyOpenPrsResult {
  const { auth } = useAuth();
  const username = auth?.login ?? null;
  const taskRegex = useAppStore((s) => s.settings.taskRegex);
  const pollingIntervalSec = useAppStore((s) => s.settings.pollingIntervalSec);

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

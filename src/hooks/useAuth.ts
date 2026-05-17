"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { validateToken, type AuthValidation } from "@/lib/github/auth";
import { getToken, storeToken } from "@/lib/storage/token";
import { useAppStore } from "@/lib/store";

const TOKEN_QUERY_KEY = ["token"] as const;
const AUTH_QUERY_KEY = (token: string | null) => ["auth", token] as const;

export function useAuth() {
  const queryClient = useQueryClient();
  const setRateLimit = useAppStore((s) => s.setRateLimit);

  const tokenQuery = useQuery({
    queryKey: TOKEN_QUERY_KEY,
    queryFn: async () => (await getToken()) ?? null,
    staleTime: Infinity,
  });

  const token = tokenQuery.data ?? null;

  const authQuery = useQuery<AuthValidation>({
    queryKey: AUTH_QUERY_KEY(token),
    queryFn: () => validateToken(token ?? ""),
    enabled: tokenQuery.isSuccess && !!token,
    staleTime: 30_000,
  });

  const auth = authQuery.data ?? null;

  // validateToken bypasses the Octokit beetGet wrapper, so its rate-limit
  // headers don't reach the interceptor — feed them into the store here.
  useEffect(() => {
    if (authQuery.data?.rateLimit) setRateLimit(authQuery.data.rateLimit);
  }, [authQuery.data, setRateLimit]);

  const validateAndSave = useMutation<AuthValidation, Error, string>({
    mutationFn: async (newToken) => {
      const result = await validateToken(newToken);
      if (result.ok) {
        await storeToken(newToken);
      }
      return result;
    },
    onSuccess: (result, newToken) => {
      if (!result.ok) return;
      if (result.rateLimit) setRateLimit(result.rateLimit);
      queryClient.setQueryData(TOKEN_QUERY_KEY, newToken);
      queryClient.setQueryData(AUTH_QUERY_KEY(newToken), result);
    },
  });

  const revalidate = () => {
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY(token) });
  };

  const lastCheckedAt = token ? authQuery.dataUpdatedAt : 0;

  return {
    token,
    auth,
    lastValidation: validateAndSave.data ?? null,
    isLoading:
      tokenQuery.isLoading || authQuery.isFetching || validateAndSave.isPending,
    lastCheckedAt,
    validateAndSave: (t: string) => validateAndSave.mutateAsync(t),
    revalidate,
  };
}

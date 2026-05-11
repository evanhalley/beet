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
  const setToken = useAppStore((s) => s.setToken);
  const setAuth = useAppStore((s) => s.setAuth);
  const setRateLimit = useAppStore((s) => s.setRateLimit);
  const token = useAppStore((s) => s.token);
  const auth = useAppStore((s) => s.auth);

  const tokenQuery = useQuery({
    queryKey: TOKEN_QUERY_KEY,
    queryFn: async () => (await getToken()) ?? null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (tokenQuery.data !== undefined) {
      setToken(tokenQuery.data);
    }
  }, [tokenQuery.data, setToken]);

  const authQuery = useQuery<AuthValidation>({
    queryKey: AUTH_QUERY_KEY(token),
    queryFn: () => validateToken(token ?? ""),
    enabled: tokenQuery.isSuccess && !!token,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (authQuery.data) {
      setAuth(authQuery.data);
      if (authQuery.data.rateLimit) setRateLimit(authQuery.data.rateLimit);
    }
  }, [authQuery.data, setAuth, setRateLimit]);

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
      setToken(newToken);
      setAuth(result);
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
    isLoading: tokenQuery.isLoading || authQuery.isFetching || validateAndSave.isPending,
    lastCheckedAt,
    validateAndSave: (t: string) => validateAndSave.mutateAsync(t),
    revalidate,
  };
}

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
    queryFn: async () => {
      if (!token) {
        return {
          ok: false,
          scopes: [],
          missingScopes: [],
          error: "no_token" as const,
        };
      }
      return validateToken(token);
    },
    enabled: tokenQuery.isSuccess,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (authQuery.data) {
      setAuth(authQuery.data);
      if (authQuery.data.rateLimit) setRateLimit(authQuery.data.rateLimit);
    }
  }, [authQuery.data, setAuth, setRateLimit]);

  const saveToken = useMutation({
    mutationFn: async (newToken: string) => {
      await storeToken(newToken);
      return newToken;
    },
    onSuccess: (newToken) => {
      setToken(newToken);
      queryClient.setQueryData(TOKEN_QUERY_KEY, newToken);
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY(newToken) });
    },
  });

  const revalidate = () => {
    queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY(token) });
  };

  return {
    token,
    auth,
    isLoading: tokenQuery.isLoading || authQuery.isFetching,
    lastCheckedAt: authQuery.dataUpdatedAt,
    saveToken: (t: string) => saveToken.mutateAsync(t),
    revalidate,
  };
}

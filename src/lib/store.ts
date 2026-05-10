import { create } from "zustand";
import type { AuthValidation } from "@/lib/github/auth";
import type { RateLimitInfo } from "@/lib/github/octokit";

export interface AppStore {
  token: string | null;
  user: { login: string } | null;
  rateLimit: RateLimitInfo | null;
  auth: AuthValidation | null;

  setToken: (token: string | null) => void;
  setUser: (user: { login: string } | null) => void;
  setRateLimit: (rateLimit: RateLimitInfo | null) => void;
  setAuth: (auth: AuthValidation | null) => void;
  reset: () => void;
}

const initialState = {
  token: null,
  user: null,
  rateLimit: null,
  auth: null,
};

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setToken: (token) => set({ token }),
  setUser: (user) => set({ user }),
  setRateLimit: (rateLimit) => set({ rateLimit }),
  setAuth: (auth) => set({ auth, user: auth?.login ? { login: auth.login } : null }),
  reset: () => set(initialState),
}));

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

export const REQUIRED_SCOPES = [
  "repo",
  "read:org",
  "read:user",
  "user:email",
  "notifications",
] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export interface AuthValidation {
  ok: boolean;
  login?: string;
  scopes: string[];
  missingScopes: string[];
  rateLimit?: { remaining: number; reset: number } | null;
  error?: "no_token" | "invalid" | "network";
}

export function parseScopes(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readRateLimit(
  headers: Record<string, string | undefined> | undefined,
): { remaining: number; reset: number } | null {
  if (!headers) return null;
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  if (remaining === undefined || reset === undefined) return null;
  return { remaining: Number(remaining), reset: Number(reset) };
}

export async function validateToken(token: string): Promise<AuthValidation> {
  if (!token) {
    return { ok: false, scopes: [], missingScopes: [...REQUIRED_SCOPES], error: "no_token" };
  }
  const octokit = new Octokit({ auth: token });
  try {
    const response = await octokit.request("GET /user");
    const headers = response.headers as Record<string, string | undefined>;
    const scopes = parseScopes(headers["x-oauth-scopes"]);
    const missingScopes = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
    return {
      ok: true,
      login: (response.data as { login: string }).login,
      scopes,
      missingScopes,
      rateLimit: readRateLimit(headers),
    };
  } catch (err) {
    if (err instanceof RequestError) {
      if (err.status === 401) {
        return {
          ok: false,
          scopes: [],
          missingScopes: [...REQUIRED_SCOPES],
          error: "invalid",
        };
      }
    }
    return {
      ok: false,
      scopes: [],
      missingScopes: [...REQUIRED_SCOPES],
      error: "network",
    };
  }
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number;
}

export function readRateLimit(
  headers: Record<string, string | undefined> | undefined,
): RateLimitInfo | null {
  if (!headers) return null;
  const remaining = headers["x-ratelimit-remaining"];
  const limit = headers["x-ratelimit-limit"];
  const reset = headers["x-ratelimit-reset"];
  if (remaining === undefined || limit === undefined || reset === undefined) {
    return null;
  }
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    reset: Number(reset),
  };
}

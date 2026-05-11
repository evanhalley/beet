export interface RateLimitInfo {
  remaining: number;
  reset: number;
}

export function readRateLimit(
  headers: Record<string, string | undefined> | undefined,
): RateLimitInfo | null {
  if (!headers) return null;
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  if (remaining === undefined || reset === undefined) return null;
  return { remaining: Number(remaining), reset: Number(reset) };
}

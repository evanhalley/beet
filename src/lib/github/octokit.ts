import { Octokit } from "@octokit/rest";
import { getCached, setCached } from "@/lib/storage/etag-cache";
import { getToken as getStoredToken } from "@/lib/storage/token";

export class NoTokenError extends Error {
  constructor() {
    super("No GitHub token configured");
    this.name = "NoTokenError";
  }
}

export interface BeetGetOptions {
  cacheKey: string;
  url: string;
  params?: Record<string, unknown>;
}

export interface RateLimitInfo {
  remaining: number;
  reset: number;
}

export interface BeetGetResult<T> {
  body: T;
  fromCache: boolean;
  etag: string | null;
  rateLimit: RateLimitInfo | null;
}

let cachedClient: { token: string; client: Octokit } | null = null;

function getOctokit(token: string): Octokit {
  if (cachedClient && cachedClient.token === token) return cachedClient.client;
  const client = new Octokit({ auth: token });
  cachedClient = { token, client };
  return client;
}

export function __resetOctokitForTests(): void {
  cachedClient = null;
}

function readRateLimit(
  headers: Record<string, string | undefined> | undefined,
): RateLimitInfo | null {
  if (!headers) return null;
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  if (remaining === undefined || reset === undefined) return null;
  return { remaining: Number(remaining), reset: Number(reset) };
}

type TokenProvider = () => Promise<string | null>;

let onRateLimit: ((rl: RateLimitInfo | null) => void) | null = null;

export function setRateLimitListener(fn: ((rl: RateLimitInfo | null) => void) | null): void {
  onRateLimit = fn;
}

export async function beetGet<T>(
  opts: BeetGetOptions,
  tokenProvider: TokenProvider = getStoredToken,
): Promise<BeetGetResult<T>> {
  const token = await tokenProvider();
  if (!token) throw new NoTokenError();

  const octokit = getOctokit(token);
  const cached = await getCached<T>(opts.cacheKey);

  const headers: Record<string, string> = {};
  if (cached) headers["If-None-Match"] = cached.etag;

  try {
    const response = await octokit.request(opts.url, {
      ...(opts.params ?? {}),
      headers,
    });
    const respHeaders = response.headers as Record<string, string | undefined>;
    const etag = respHeaders.etag ?? null;
    const rateLimit = readRateLimit(respHeaders);
    if (etag) {
      await setCached<T>(opts.cacheKey, etag, response.data as T);
    }
    if (onRateLimit) onRateLimit(rateLimit);
    return {
      body: response.data as T,
      fromCache: false,
      etag,
      rateLimit,
    };
  } catch (err) {
    if (
      cached &&
      err !== null &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status: unknown }).status === 304
    ) {
      const e = err as {
        response?: { headers?: Record<string, string | undefined> };
      };
      const respHeaders = e.response?.headers ?? {};
      const rateLimit = readRateLimit(respHeaders);
      if (onRateLimit) onRateLimit(rateLimit);
      return {
        body: cached.body,
        fromCache: true,
        etag: cached.etag,
        rateLimit,
      };
    }
    throw err;
  }
}

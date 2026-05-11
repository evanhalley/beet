import { Octokit } from "@octokit/rest";
import { getCached, setCached } from "@/lib/storage/etag-cache";
import { getToken as getStoredToken } from "@/lib/storage/token";
import { readRateLimit, type RateLimitInfo } from "@/lib/github/rate-limit";

export type { RateLimitInfo };

export class NoTokenError extends Error {
  constructor() {
    super("No GitHub token configured");
    this.name = "NoTokenError";
  }
}

export interface BeetGetOptions {
  cacheKey: string;
  route: string;
  params?: Record<string, unknown>;
}

export interface BeetGetResult<T> {
  body: T;
  fromCache: boolean;
  etag: string | null;
  rateLimit: RateLimitInfo | null;
}

let cachedClient: { token: string; client: Octokit } | null = null;

// Marker header we inject on synthetic 304→200 responses so beetGet can
// detect cache hits without Octokit ever seeing a non-2xx status.
const CACHE_HIT_HEADER = "x-beet-cache-hit";

// Octokit treats 304 as an error and throws; the underlying fetch response
// with status 304 is then surfaced by Next.js / Turbopack dev tooling as a
// "Console Error" even when the throw is caught. We swap in a custom fetch
// that promotes 304 → 200 with a marker header so the 304 never escapes the
// network adapter.
const conditionalFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 304) return res;
  const headers = new Headers(res.headers);
  headers.set(CACHE_HIT_HEADER, "1");
  return new Response("{}", {
    status: 200,
    statusText: "Not Modified (cache hit)",
    headers,
  });
};

function getOctokit(token: string): Octokit {
  if (cachedClient && cachedClient.token === token) return cachedClient.client;
  const client = new Octokit({
    auth: token,
    request: { fetch: conditionalFetch },
  });
  cachedClient = { token, client };
  return client;
}

export function __resetOctokitForTests(): void {
  cachedClient = null;
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

  const response = await octokit.request(opts.route, {
    ...(opts.params ?? {}),
    headers,
  });
  const respHeaders = response.headers as Record<string, string | undefined>;
  const rateLimit = readRateLimit(respHeaders);
  if (onRateLimit) onRateLimit(rateLimit);

  // conditionalFetch promotes upstream 304 into a 200 with this marker header.
  if (cached && respHeaders[CACHE_HIT_HEADER]) {
    return {
      body: cached.body,
      fromCache: true,
      etag: cached.etag,
      rateLimit,
    };
  }

  const etag = respHeaders.etag ?? null;
  if (etag) {
    await setCached<T>(opts.cacheKey, etag, response.data as T);
  }
  return {
    body: response.data as T,
    fromCache: false,
    etag,
    rateLimit,
  };
}

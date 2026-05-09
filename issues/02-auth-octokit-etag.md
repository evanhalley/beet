# #2 — Auth + Octokit + ETag cache

Wire up the data-layer primitives every later iteration depends on: a PAT the user can paste and validate, persistent storage (Tauri Store for the token, SQLite for everything structured), and an Octokit wrapper that does conditional GETs so we don't burn rate limit on unchanged data. Plus the first real Settings panel — Account tab only.

Refs: [SPECS.md §4](../SPECS.md) (auth + scopes), [§7](../SPECS.md) (ETag cached queries table), [§9](../SPECS.md) (SQLite schema), [§11](../SPECS.md) (Settings → Account tab fields). Builds on [#1](01-bootstrap.md).

## Goal

User can paste a GitHub PAT, click Validate, and see their login + per-scope status. The Octokit wrapper sends `If-None-Match` and serves cached bodies on 304, exercised end-to-end in tests with MSW.

## Acceptance criteria

- [ ] **Settings panel shell** opens from the main window and renders an Account tab. Nav lists only tabs we've actually implemented (Account); future iterations register their own.
- [ ] **PAT field** persists the token via `tauri-plugin-store` (key `github-pat`, matching Action Jackson's pattern in [tauri-bridge.ts](file:///Users/evan/Downloads/src/lib/tauri-bridge.ts)). Survives app restart.
- [ ] **Validate button** calls `users.getAuthenticated` via the Octokit wrapper. On success, shows a green `● valid` pill, the resolved login, and "last checked Ns ago".
- [ ] **Scopes grid** lists the five required scopes from §4 (`repo`, `read:org`, `read:user`, `user:email`, `notifications`) and marks each as `ok` / `missing` based on the `X-OAuth-Scopes` response header.
- [ ] **SQLite database** initializes on app launch via `tauri-plugin-sql` and runs the first migration creating `etag_cache` (per §9). Subsequent launches are no-ops.
- [ ] **Octokit wrapper** for any GET request:
  - Looks up `(cache_key, etag)` in `etag_cache`; if present, sends `If-None-Match`.
  - On `304`, returns the cached body + records a cache-hit metric.
  - On `200`, stores `(cache_key, etag, body, fetched_at)`.
  - Other status codes propagate as Octokit errors (caller handles).
- [ ] **Degraded states** surface clearly:
  - Token missing → main window shows a banner with "Open Settings" CTA.
  - Token invalid (401 from validate) → same banner, copy says "Token rejected by GitHub. Check Settings."
- [ ] **Rate-limit headers** (`x-ratelimit-remaining`, `x-ratelimit-reset`) are captured into Zustand on every successful request. Not rendered yet (Polling tab lands in #3).
- [ ] All tests pass (`npm test`), lint clean (`npm run lint`), `npm run tauri build` produces a runnable `.app`.

## Files to add

```
src/
├── app/
│   └── page.tsx                              ← gains "Open Settings" button + missing-token banner
├── components/
│   ├── MissingTokenBanner.tsx
│   └── Settings/
│       ├── SettingsPanel.tsx                 ← nav + tab area; Account-only for now
│       ├── AccountTab.tsx                    ← port design/src/settings.jsx AccountTab
│       └── ScopesGrid.tsx                    ← port the ScopesGrid primitive
├── hooks/
│   └── useAuth.ts                            ← TanStack Query around validate + token state
├── lib/
│   ├── github/
│   │   ├── octokit.ts                        ← ETag-aware wrapper
│   │   └── auth.ts                           ← validateToken, parseScopes
│   ├── storage/
│   │   ├── token.ts                          ← port AJ's tauri-bridge.ts
│   │   ├── db.ts                             ← Tauri SQL plugin init helper
│   │   ├── etag-cache.ts                     ← DAL for etag_cache table
│   │   └── migrations.ts                     ← migration list (consumed by lib.rs)
│   └── store.ts                              ← Zustand: token, user, rateLimit
└── test/
    └── msw-handlers.ts                       ← /user fixtures, ETag fixtures

src-tauri/
├── Cargo.toml                                ← add plugin-store, plugin-sql
├── capabilities/default.json                 ← permissions for store + sql
└── src/lib.rs                                ← register both plugins, define migration list
```

## Dependencies to add

**Frontend (`package.json`)**

```jsonc
{
  "dependencies": {
    "@octokit/rest": "^22.0.1",
    "@tauri-apps/plugin-store": "^2",
    "@tauri-apps/plugin-sql": "^2",
    "@tanstack/react-query": "^5",
    "zustand": "^5",
    "dayjs": "^1.11.19"
  },
  "devDependencies": {
    "msw": "^2"
  }
}
```

**Rust (`src-tauri/Cargo.toml`)**

```toml
tauri-plugin-store = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

## SQLite migration #1

Defined in Rust via `tauri_plugin_sql::Migration` so the plugin runs it on init. Just the ETag cache table for now — other tables in §9 land with their owning iterations.

```sql
CREATE TABLE IF NOT EXISTS etag_cache (
  cache_key TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  body_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

DB filename: `beet.db` in the Tauri app data dir.

## Octokit wrapper shape

```ts
// src/lib/github/octokit.ts
export interface BeetGetOptions {
  cacheKey: string;          // stable composition: e.g. "search:review-requested:@me"
  url: string;               // octokit-relative: "/user", "/search/issues", ...
  params?: Record<string, unknown>;
}

export interface BeetGetResult<T> {
  body: T;
  fromCache: boolean;        // true on 304
  etag: string | null;
  rateLimit: { remaining: number; reset: number } | null;
}

export async function beetGet<T>(opts: BeetGetOptions): Promise<BeetGetResult<T>>;
```

Cache-key composition is the caller's job and must be stable. The wrapper handles only the conditional-request mechanics.

Octokit does throw on 304 by default — the wrapper catches `RequestError` with `status === 304` and resolves with cached body + `fromCache: true`. Rate-limit headers are read from `error.response.headers` in that path and from `response.headers` in the 200 path; either way they're forwarded to the Zustand store.

## Auth helper shape

```ts
// src/lib/github/auth.ts
export interface AuthValidation {
  ok: boolean;
  login?: string;
  scopes: string[];          // parsed from X-OAuth-Scopes
  missingScopes: string[];   // diff against REQUIRED_SCOPES
  error?: "no_token" | "invalid" | "network";
}

export async function validateToken(token: string): Promise<AuthValidation>;

export const REQUIRED_SCOPES = [
  "repo",
  "read:org",
  "read:user",
  "user:email",
  "notifications",
] as const;
```

Note that fine-grained PATs report scopes differently from classic PATs. The header parser should accept both formats; if `X-OAuth-Scopes` is missing, surface `scopes: []` and let the grid render everything as `missing` until we add fine-grained handling later.

## Test plan

**Unit (Vitest + MSW)**

- `src/lib/storage/etag-cache.test.ts` — set + get + overwrite round-trips.
- `src/lib/github/octokit.test.ts`:
  - First call: 200 + ETag → caches body and etag.
  - Second call with same `cacheKey`: handler asserts `If-None-Match` header → returns 304 → wrapper resolves with `fromCache: true` and the cached body.
  - 200 with new ETag overwrites cache.
- `src/lib/github/auth.test.ts`:
  - Valid token → `ok: true`, login, full scope list.
  - Token missing `notifications` scope → `missingScopes: ["notifications"]`.
  - 401 response → `ok: false`, `error: "invalid"`.
- `src/components/Settings/AccountTab.test.tsx` — Validate button click triggers fetch, success state renders pill + login.

**Manual**

- Paste a real PAT, click Validate, confirm scopes grid lights up correctly.
- Quit and relaunch — token is still there, no re-validation needed until Validate is clicked again.
- Delete `beet.db` from the app data dir, relaunch — migration runs cleanly, no errors.
- Change PAT to an obviously-invalid string, click Validate — banner appears, copy correct.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| Polling tab (slider, rate-limit meter) | #3 |
| Mute & pin tab | #8 |
| Scoring tab (penalized bots, task regex, weights table) | #3 |
| Notifications tab | #8 |
| Appearance tab (theme, density) | #9 |
| Teams-to-track field on Account tab | #3 (it's a scoring input) |
| Any actual PR/run fetching | #3, #5 |
| Lifecycle history table, item_state, mute/pin, notifications_sent tables | #4, #7, #8 |
| Adaptive polling | #8 |

## Notes

- Match [design/src/settings.jsx](../design/src/settings.jsx) AccountTab pixel-for-pixel: same field labels, hint copy, scopes-grid layout, validate-button placement. The `notifications` scope showing as `missing` in the mock is the design's way of demoing the degraded state — make sure that path actually works.
- `MissingTokenBanner` is the only thing the main window renders for users without a valid token. Don't pre-render the empty list sections — that's #3's surface and showing them stubbed out before they work invites confusion.
- Cache-key conventions documented for later iterations: `"user"`, `"search:<query-hash>"`, `"pr:<owner>/<repo>#<num>"`, `"runs:<owner>/<repo>"`, `"notifications"`. Just a convention; the wrapper treats `cacheKey` as opaque.
- The `migrations.ts` list grows by one entry per iteration that adds a table. Treat it as append-only — never edit a past migration.

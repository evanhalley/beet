import { http, HttpResponse } from "msw";

export const VALID_TOKEN = "ghp_validtoken1234567890";
export const MISSING_NOTIFICATIONS_TOKEN = "ghp_missingnotif1234567890";
export const INVALID_TOKEN = "ghp_invalidtoken12345";

const ALL_SCOPES = "repo, read:org, read:user, user:email, notifications";
const PARTIAL_SCOPES = "repo, read:org, read:user, user:email";

const RATE_HEADERS = {
  "x-ratelimit-remaining": "4998",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": "1700000000",
};

function authHeaderToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^token\s+(.+)$/i);
  return match ? match[1] : null;
}

export const handlers = [
  http.get("https://api.github.com/user", ({ request }) => {
    const token = authHeaderToken(request);
    if (token === VALID_TOKEN) {
      return HttpResponse.json(
        { login: "octocat" },
        {
          headers: {
            "X-OAuth-Scopes": ALL_SCOPES,
            ...RATE_HEADERS,
          },
        },
      );
    }
    if (token === MISSING_NOTIFICATIONS_TOKEN) {
      return HttpResponse.json(
        { login: "partial" },
        {
          headers: {
            "X-OAuth-Scopes": PARTIAL_SCOPES,
            ...RATE_HEADERS,
          },
        },
      );
    }
    return new HttpResponse(JSON.stringify({ message: "Bad credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }),
];

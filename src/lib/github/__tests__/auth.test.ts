import { describe, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import {
  INVALID_TOKEN,
  MISSING_NOTIFICATIONS_TOKEN,
  VALID_TOKEN,
} from "@/test/msw-handlers";
import { parseScopes, REQUIRED_SCOPES, validateToken } from "../auth";

describe("parseScopes", () => {
  test("splits comma-separated scopes and trims", () => {
    expect(parseScopes("repo, read:org , user:email")).toEqual([
      "repo",
      "read:org",
      "user:email",
    ]);
  });

  test("returns empty array when header is missing", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
  });
});

describe("validateToken", () => {
  test("returns ok=true with login + scopes for a valid classic PAT", async () => {
    const result = await validateToken(VALID_TOKEN);
    expect(result.ok).toBe(true);
    expect(result.login).toBe("octocat");
    expect(result.scopes).toEqual([...REQUIRED_SCOPES]);
    expect(result.missingScopes).toEqual([]);
    expect(result.rateLimit).toEqual({
      remaining: 4998,
      limit: 5000,
      reset: 1700000000,
    });
  });

  test("flags missingScopes when the token lacks notifications", async () => {
    const result = await validateToken(MISSING_NOTIFICATIONS_TOKEN);
    expect(result.ok).toBe(true);
    expect(result.missingScopes).toEqual(["notifications"]);
  });

  test("returns invalid on 401", async () => {
    const result = await validateToken(INVALID_TOKEN);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid");
    expect(result.missingScopes).toEqual([...REQUIRED_SCOPES]);
  });

  test("returns no_token when called with empty string", async () => {
    const result = await validateToken("");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_token");
  });

  test("returns scopes=[] for fine-grained PATs without X-OAuth-Scopes header", async () => {
    server.use(
      http.get("https://api.github.com/user", () =>
        HttpResponse.json({ login: "fine-grained" }),
      ),
    );
    const result = await validateToken("github_pat_FAKE");
    expect(result.ok).toBe(true);
    expect(result.scopes).toEqual([]);
    expect(result.missingScopes).toEqual([...REQUIRED_SCOPES]);
  });
});

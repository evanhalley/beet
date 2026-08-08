import { describe, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { checkForUpdate, isNewerVersion, parseTagVersion } from "../updateCheck";

describe("parseTagVersion", () => {
  test("strips common tag prefixes", () => {
    expect(parseTagVersion("v0.1.6")).toBe("0.1.6");
    expect(parseTagVersion("app-v0.1.6")).toBe("0.1.6");
    expect(parseTagVersion("0.1.6")).toBe("0.1.6");
  });
});

describe("isNewerVersion", () => {
  test("compares numeric segments, not strings", () => {
    expect(isNewerVersion("0.1.6", "0.1.5")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  test("equal or older versions are not newer", () => {
    expect(isNewerVersion("0.1.5", "0.1.5")).toBe(false);
    expect(isNewerVersion("0.1.4", "0.1.5")).toBe(false);
  });

  test("a longer version wins over its shorter prefix", () => {
    expect(isNewerVersion("0.1.5.1", "0.1.5")).toBe(true);
    expect(isNewerVersion("0.1.5", "0.1.5.1")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  test("reports an available update with the release URL", async () => {
    server.use(
      http.get(
        "https://api.github.com/repos/evanhalley/beet/releases/latest",
        () =>
          HttpResponse.json({
            tag_name: "v0.2.0",
            html_url: "https://github.com/evanhalley/beet/releases/tag/v0.2.0",
          }),
      ),
    );

    const result = await checkForUpdate("0.1.5");

    expect(result).toEqual({
      latest: "0.2.0",
      url: "https://github.com/evanhalley/beet/releases/tag/v0.2.0",
      updateAvailable: true,
    });
  });

  test("reports up-to-date when the latest release matches", async () => {
    server.use(
      http.get(
        "https://api.github.com/repos/evanhalley/beet/releases/latest",
        () =>
          HttpResponse.json({
            tag_name: "v0.1.5",
            html_url: "https://github.com/evanhalley/beet/releases/tag/v0.1.5",
          }),
      ),
    );

    const result = await checkForUpdate("0.1.5");
    expect(result.updateAvailable).toBe(false);
  });

  test("throws on a non-OK response", async () => {
    server.use(
      http.get(
        "https://api.github.com/repos/evanhalley/beet/releases/latest",
        () => new HttpResponse(null, { status: 503 }),
      ),
    );

    await expect(checkForUpdate("0.1.5")).rejects.toThrow("503");
  });
});

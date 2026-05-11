import { describe, test, expect } from "vitest";
import {
  DEFAULT_TASK_REGEX,
  compileTaskRegex,
  extractTaskUrls,
} from "./tasks";

describe("compileTaskRegex", () => {
  test("compiles a raw pattern with default global flag", () => {
    const re = compileTaskRegex(DEFAULT_TASK_REGEX);
    expect(re).toBeInstanceOf(RegExp);
    expect(re?.global).toBe(true);
  });

  test("accepts /pattern/flags form", () => {
    const re = compileTaskRegex("/foo-\\d+/i");
    expect(re).toBeInstanceOf(RegExp);
    expect(re?.ignoreCase).toBe(true);
    expect(re?.source).toBe("foo-\\d+");
  });

  test("/pattern/ without flags defaults to global", () => {
    const re = compileTaskRegex("/foo-\\d+/");
    expect(re?.global).toBe(true);
  });

  test("returns null on invalid pattern", () => {
    expect(compileTaskRegex("[unterminated")).toBeNull();
  });

  test("returns null on empty/null input", () => {
    expect(compileTaskRegex("")).toBeNull();
    expect(compileTaskRegex(null)).toBeNull();
    expect(compileTaskRegex(undefined)).toBeNull();
  });
});

describe("extractTaskUrls", () => {
  const re = compileTaskRegex(DEFAULT_TASK_REGEX)!;

  test("matches default Atlassian URLs and dedupes them", () => {
    const body = `
      see https://your-company.atlassian.net/browse/PROJ-123
      and https://your-company.atlassian.net/browse/PROJ-456
      duplicate https://your-company.atlassian.net/browse/PROJ-123
    `;
    const out = extractTaskUrls(body, re);
    expect(out).toEqual([
      "https://your-company.atlassian.net/browse/PROJ-123",
      "https://your-company.atlassian.net/browse/PROJ-456",
    ]);
  });

  test("returns [] when body is empty", () => {
    expect(extractTaskUrls("", re)).toEqual([]);
    expect(extractTaskUrls(null, re)).toEqual([]);
  });

  test("returns [] when regex is null", () => {
    expect(extractTaskUrls("anything", null)).toEqual([]);
  });

  test("returns [] when nothing matches", () => {
    expect(extractTaskUrls("just prose", re)).toEqual([]);
  });
});

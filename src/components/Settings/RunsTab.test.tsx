import { describe, expect, test } from "vitest";
import { formatAllowlist, parseAllowlist } from "./RunsTab";

describe("RunsTab parser", () => {
  test("parses owner/repo: workflowA, workflowB", () => {
    const out = parseAllowlist("acme/web: Deploy, Release\nfoo/bar: CI");
    expect(out.allowlist).toEqual({
      "acme/web": ["Deploy", "Release"],
      "foo/bar": ["CI"],
    });
    expect(out.invalid).toEqual([]);
  });

  test("treats a colon with empty list as pass-through (empty array)", () => {
    const out = parseAllowlist("acme/web:");
    expect(out.allowlist).toEqual({ "acme/web": [] });
    expect(out.invalid).toEqual([]);
  });

  test("rejects lines without a colon and bad repo names", () => {
    const out = parseAllowlist("nope\nbad repo: Workflow\nfoo/bar: CI");
    expect(out.allowlist).toEqual({ "foo/bar": ["CI"] });
    expect(out.invalid).toEqual(["nope", "bad repo: Workflow"]);
  });

  test("ignores blank lines and trims whitespace", () => {
    const out = parseAllowlist("\n  acme/web :   Deploy ,  Release  \n");
    expect(out.allowlist).toEqual({ "acme/web": ["Deploy", "Release"] });
  });

  test("formatAllowlist is sorted and round-trips through parseAllowlist", () => {
    const allowlist = {
      "foo/bar": ["CI"],
      "acme/web": ["Deploy", "Release"],
    };
    const text = formatAllowlist(allowlist);
    expect(text).toBe("acme/web: Deploy, Release\nfoo/bar: CI");
    expect(parseAllowlist(text).allowlist).toEqual(allowlist);
  });
});

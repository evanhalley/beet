import { beforeEach, describe, expect, test } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatAllowlist, parseAllowlist, RunsTab } from "../RunsTab";
import { useAppStore } from "@/lib/store";

beforeEach(() => {
  useAppStore.getState().reset();
});

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

describe("RunsTab UI", () => {
  test("keeps invalid draft lines visible on blur instead of dropping them", async () => {
    render(<RunsTab />);
    const textarea = screen.getByPlaceholderText(
      /acme\/web-app: Deploy/i,
    ) as HTMLTextAreaElement;
    // User types a malformed line and a good one, then tabs out.
    fireEvent.change(textarea, {
      target: { value: "garbage line\nfoo/bar: CI" },
    });
    fireEvent.blur(textarea);
    // Good line persisted; bad line still visible so the user can fix it.
    await waitFor(() => {
      expect(textarea.value).toContain("garbage line");
      expect(textarea.value).toContain("foo/bar: CI");
    });
    // And the "ignored on save" hint surfaces.
    expect(screen.getByText(/ignored on save/i)).toBeInTheDocument();
  });

  test("collapses the draft back to the canonical formatted view when all lines parse", async () => {
    render(<RunsTab />);
    const textarea = screen.getByPlaceholderText(
      /acme\/web-app: Deploy/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "foo/bar:   CI ,  Lint  " },
    });
    fireEvent.blur(textarea);
    // Reformatted on the next tick once setStandaloneRunsAllowlist resolves.
    await waitFor(() =>
      expect(textarea.value).toBe("foo/bar: CI, Lint"),
    );
  });
});

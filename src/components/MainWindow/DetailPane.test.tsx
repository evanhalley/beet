import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailPane } from "./DetailPane";
import type { ActionableItem } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const pr: ActionableItem = {
  id: "x",
  kind: "pr",
  title: "Patch the migrator",
  url: "https://github.com/acme/repo/pull/42",
  repoFullName: "acme/repo",
  updatedAt: "2026-05-09T10:00:00Z",
  unread: false,
  dismissedUntilFingerprint: null,
  pr: {
    number: 42,
    author: "rina",
    body: null,
    isAuthoredByMe: false,
    isReviewRequestedFromMe: true,
    isAuthorOnMyTeam: false,
    iveCommented: false,
    iveReviewed: false,
    iveApproved: false,
    approvalCount: 0,
    isDraft: false,
    additions: 12,
    deletions: 3,
    createdAt: "2026-05-08T10:00:00Z",
    lifecycle: "in_review",
    taskUrls: [],
    score: 9,
  },
};

describe("DetailPane", () => {
  test("renders 'Select an item.' when item is null", () => {
    render(<DetailPane item={null} />);
    expect(screen.getByText("Select an item.")).toBeInTheDocument();
  });

  test("renders the PR header with repo, number, title, and Open on GitHub button", () => {
    render(<DetailPane item={pr} />);
    expect(screen.getByText("acme/repo")).toBeInTheDocument();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Patch the migrator" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Patch the migrator on GitHub" }),
    ).toBeInTheDocument();
  });

  test("renders Body / Reviewers / Checks / Activity blocks", () => {
    render(<DetailPane item={pr} />);
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewers")).toBeInTheDocument();
    expect(screen.getByLabelText("Checks")).toBeInTheDocument();
    expect(screen.getByLabelText("Activity")).toBeInTheDocument();
  });

  test("Body block shows 'No description.' when pr.body is null", () => {
    render(<DetailPane item={pr} />);
    expect(screen.getByText("No description.")).toBeInTheDocument();
  });

  test("Body block renders markdown headings, lists, code, and links", () => {
    const withBody: ActionableItem = {
      ...pr,
      pr: {
        ...pr.pr!,
        body: [
          "## Summary",
          "",
          "- Wires the retry budget",
          "- Adds a metric",
          "",
          "See [the doc](https://example.com/doc) for context.",
          "",
          "```ts",
          "const budget = 3;",
          "```",
        ].join("\n"),
      },
    };
    render(<DetailPane item={withBody} />);

    // Heading rendered (downsized to h4 in our markdown components).
    expect(
      screen.getByRole("heading", { name: "Summary" }),
    ).toBeInTheDocument();
    // List items.
    expect(screen.getByText("Wires the retry budget")).toBeInTheDocument();
    expect(screen.getByText("Adds a metric")).toBeInTheDocument();
    // Link rendered as a button (so it routes through openInBrowser).
    expect(
      screen.getByRole("button", { name: "the doc" }),
    ).toBeInTheDocument();
    // Code block content.
    expect(screen.getByText("const budget = 3;")).toBeInTheDocument();
  });

  test("Body markdown links open via tauri shell, not in-webview navigation", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    const withBody: ActionableItem = {
      ...pr,
      pr: { ...pr.pr!, body: "See [docs](https://example.com/x) here." },
    };
    render(<DetailPane item={withBody} />);
    await user.click(screen.getByRole("button", { name: "docs" }));
    expect(shellMod.open).toHaveBeenCalledWith("https://example.com/x");
  });

  test("Open on GitHub button calls tauri shell open", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    render(<DetailPane item={pr} />);
    await user.click(
      screen.getByRole("button", { name: "Open Patch the migrator on GitHub" }),
    );
    expect(shellMod.open).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/42",
    );
  });
});

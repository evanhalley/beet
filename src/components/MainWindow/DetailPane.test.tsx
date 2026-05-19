import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailPane } from "./DetailPane";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

beforeEach(() => {
  useAppStore.getState().reset();
});

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
  test("renders 'Select an item.' when item is null and a poll has completed", () => {
    useAppStore.setState({ pollState: "ok" });
    render(<DetailPane item={null} />);
    expect(screen.getByText("Select an item.")).toBeInTheDocument();
  });

  test("renders a 'Loading…' indicator during cold start (idle pollState)", () => {
    // Default pollState is "idle" — no poll cycle has completed yet.
    render(<DetailPane item={null} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Select an item.")).toBeNull();
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

  test("Reviewers/Checks blocks show empty-state hints when no data is attached", () => {
    render(<DetailPane item={pr} />);
    expect(screen.getByText("No reviewers yet.")).toBeInTheDocument();
    expect(
      screen.getByText("No checks reported for this commit."),
    ).toBeInTheDocument();
  });

  test("Reviewers block renders the design's four pill mappings", () => {
    const withReviewers: ActionableItem = {
      ...pr,
      pr: {
        ...pr.pr!,
        reviewers: [
          { login: "alice", state: "approved" },
          { login: "bob", state: "changes_requested" },
          { login: "carol", state: "requested" },
          // "commented" isn't in the design's explicit mapping → neutral pill
          // labeled with the raw state.
          { login: "dave", state: "commented" },
        ],
      },
    };
    render(<DetailPane item={withReviewers} />);
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("changes requested")).toBeInTheDocument();
    expect(screen.getByText("awaiting")).toBeInTheDocument();
    expect(screen.getByText("commented")).toBeInTheDocument();
  });

  test("Checks block renders rows with the design's status derivation", () => {
    const withChecks: ActionableItem = {
      ...pr,
      pr: {
        ...pr.pr!,
        checkRuns: [
          { name: "build", status: "completed", conclusion: "success" },
          { name: "integration", status: "completed", conclusion: "failure" },
          { name: "deploy", status: "in_progress" },
          { name: "lint", status: "queued" },
        ],
      },
    };
    render(<DetailPane item={withChecks} />);
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getByText("integration")).toBeInTheDocument();
    expect(screen.getByText("deploy")).toBeInTheDocument();
    // In-progress row reads "running…", not the (null) conclusion.
    expect(screen.getByText("running…")).toBeInTheDocument();
    // Completed rows surface the raw conclusion.
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("failure")).toBeInTheDocument();
    // Pending CheckDot is identified by its title text (one per row).
    const pendingDots = screen.getAllByLabelText("Checks pending");
    expect(pendingDots).toHaveLength(1); // deploy only; queued is neutral.
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

  test("renders 'Auto-requeued N×' badge and an opt-out toggle for authored ejected PRs", async () => {
    const coreMod = (await import("@tauri-apps/api/core")) as unknown as {
      invoke: ReturnType<typeof vi.fn>;
    };
    // Spy-route the requeue commands; fall back to the default impl for
    // everything else so unrelated commands (e.g. shell.open) keep working.
    let optOut = false;
    const baseImpl = coreMod.invoke.getMockImplementation()!;
    coreMod.invoke.mockImplementation(
      async (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
          case "get_requeue_count":
            return 2;
          case "get_requeue_opt_out":
            return optOut;
          case "set_requeue_opt_out":
            optOut = Boolean(args?.optOut);
            return undefined;
          default:
            return baseImpl(cmd, args);
        }
      },
    );

    const ejected: ActionableItem = {
      ...pr,
      pr: {
        ...pr.pr!,
        isAuthoredByMe: true,
        lifecycle: "open",
        mergeQueue: {
          position: null,
          enteredAt: "2026-05-09T09:50:00Z",
          lastEjectionAt: "2026-05-09T09:55:00Z",
          headSha: "deadbeef",
          prNodeId: "PR_kwDOA",
          ejectedChecks: [
            { name: "ci/build", conclusion: "failure" },
          ],
        },
      },
    };

    render(<DetailPane item={ejected} />);
    expect(await screen.findByText("Auto-requeued 2×")).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Don't auto-requeue this PR"),
    ).toBeInTheDocument();

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Don't auto-requeue this PR"));
    expect(coreMod.invoke).toHaveBeenCalledWith("set_requeue_opt_out", {
      prId: ejected.id,
      headSha: "deadbeef",
      optOut: true,
    });
  });

  test("does not render the opt-out toggle for PRs the user did not author", async () => {
    render(<DetailPane item={pr} />);
    // Render finished — assert by absence.
    expect(
      screen.queryByLabelText("Don't auto-requeue this PR"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto-requeued/)).not.toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DetailPane } from "../DetailPane";
import { useAppStore } from "@/lib/store";
import type { ActionableItem } from "@/lib/types";

beforeEach(() => {
  useAppStore.getState().reset();
});

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

// Run detail fetches jobs over IPC; the branch tests only need the header.
vi.mock("@/hooks/useRunJobs", () => ({
  useRunJobs: () => ({ jobs: [], isLoading: false, error: null }),
}));

async function setupClipboard() {
  const userEvent = (await import("@testing-library/user-event")).default;
  const user = userEvent.setup();
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return { user, writeText };
}

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

  test("PR header omits the branch and its copy button when the branch is unknown", () => {
    render(<DetailPane item={pr} />);
    expect(screen.queryByText("branch")).toBeNull();
    expect(screen.queryByRole("button", { name: /Copy branch name/ })).toBeNull();
  });

  test("PR header shows the head branch with a copy button", async () => {
    const withBranch: ActionableItem = {
      ...pr,
      pr: { ...pr.pr!, headRef: "fix/migrator" },
    };
    const { user, writeText } = await setupClipboard();
    render(<DetailPane item={withBranch} />);

    expect(screen.getByText("fix/migrator")).toBeInTheDocument();
    const copy = screen.getByRole("button", { name: "Copy branch name fix/migrator" });
    await user.click(copy);
    expect(writeText).toHaveBeenCalledWith("fix/migrator");
    await waitFor(() => expect(copy).toHaveAttribute("title", "Copied!"));
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("fork PR header shows owner:branch and copies gh pr checkout", async () => {
    const fork: ActionableItem = {
      ...pr,
      pr: { ...pr.pr!, headRef: "main", headForkOwner: "alice" },
    };
    const { user, writeText } = await setupClipboard();
    render(<DetailPane item={fork} />);
    expect(screen.getByText("alice:main")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Copy checkout command gh pr checkout 42" }),
    );
    expect(writeText).toHaveBeenCalledWith("gh pr checkout 42");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  test("run detail header shows the branch with a copy button", async () => {
    const run: ActionableItem = {
      id: "run:acme/repo#7",
      kind: "standalone_run",
      title: "Deploy",
      url: "https://github.com/acme/repo/actions/runs/7",
      repoFullName: "acme/repo",
      updatedAt: "2026-05-09T10:00:00Z",
      unread: false,
      dismissedUntilFingerprint: null,
      run: {
        workflowName: "Deploy",
        event: "push",
        status: "completed",
        conclusion: "success",
        branch: "release/2026-05",
        sha: "abcdef1234",
        runNumber: 7,
        actorLogin: "me",
        runUrl: "https://github.com/acme/repo/actions/runs/7",
        startedAt: "2026-05-09T09:58:00Z",
        completedAt: "2026-05-09T10:00:00Z",
      },
    };
    const { user, writeText } = await setupClipboard();
    render(<DetailPane item={run} />);
    await user.click(
      screen.getByRole("button", { name: "Copy branch name release/2026-05" }),
    );
    expect(writeText).toHaveBeenCalledWith("release/2026-05");
    Reflect.deleteProperty(navigator, "clipboard");
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
});

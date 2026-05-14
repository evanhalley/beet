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

  test("renders placeholder Body / Reviewers / Checks / Activity blocks", () => {
    render(<DetailPane item={pr} />);
    expect(screen.getByLabelText("Body")).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewers")).toBeInTheDocument();
    expect(screen.getByLabelText("Checks")).toBeInTheDocument();
    expect(screen.getByLabelText("Activity")).toBeInTheDocument();
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

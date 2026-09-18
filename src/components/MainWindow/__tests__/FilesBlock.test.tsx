import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { FilesBlock, defaultFilesView } from "../FilesBlock";
import type { ActionableItem, PrChangedFile, PrFilesResult } from "@/lib/types";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

const item: ActionableItem = {
  id: "pr:acme/repo#42",
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
    headSha: "head1",
    baseRef: "main",
    baseSha: "base1",
  },
};

function file(path: string, ownedByMe: boolean, extra: Partial<PrChangedFile> = {}): PrChangedFile {
  return {
    path,
    status: "modified",
    additions: 4,
    deletions: 1,
    owners: ownedByMe ? ["@acme/core"] : [],
    ownedByMe,
    anchor: `diff-${path.replace(/[^a-z]/gi, "")}`,
    ...extra,
  };
}

const files: PrChangedFile[] = [
  file("src/lib/a.rs", true),
  file("src/lib/b.rs", true, { owners: ["@evan"] }),
  file("docs/x.md", false, { status: "renamed", previousPath: "docs/y.md" }),
  file("vendor/z.js", false, { status: "removed" }),
  file("README.md", false, { status: "added" }),
];

function result(overrides: Partial<PrFilesResult> = {}): PrFilesResult {
  const f = overrides.files ?? files;
  return {
    files: f,
    hasCodeowners: true,
    codeownersPath: ".github/CODEOWNERS",
    teamsResolved: true,
    ownedCount: f.filter((x) => x.ownedByMe).length,
    totalCount: f.length,
    truncated: false,
    username: "evan",
    ...overrides,
  };
}

function rows() {
  return within(screen.getByRole("list", { name: "Changed files" })).getAllByRole("listitem");
}

async function renderWith(r: PrFilesResult) {
  invokeMock.mockResolvedValue(r);
  render(<FilesBlock item={item} />);
  await waitFor(() => expect(screen.queryByText("Loading files…")).not.toBeInTheDocument());
}

describe("defaultFilesView", () => {
  test("mine only when CODEOWNERS exists and something is owned", () => {
    expect(defaultFilesView(result())).toBe("mine");
    expect(defaultFilesView(result({ ownedCount: 0 }))).toBe("all");
    expect(defaultFilesView(result({ hasCodeowners: false, ownedCount: 0 }))).toBe("all");
  });
});

describe("FilesBlock", () => {
  test("defaults to my files, with an accurate hidden count", async () => {
    await renderWith(result());
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("a.rs")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.getByText("3 files hidden by this filter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My files (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All files (5)" })).toHaveAttribute("aria-pressed", "false");
  });

  test("toggling to all files shows everything without refetching", async () => {
    const user = userEvent.setup();
    await renderWith(result());
    await user.click(screen.getByRole("button", { name: "All files (5)" }));
    expect(rows()).toHaveLength(5);
    expect(screen.queryByText(/hidden by this filter/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "My files (2)" }));
    expect(rows()).toHaveLength(2);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("shows all files with a note when nothing is owned", async () => {
    await renderWith(result({ files: files.map((f) => ({ ...f, ownedByMe: false })) }));
    expect(screen.getByText("No files owned by you.")).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "All files (5)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Open my files on GitHub" })).not.toBeInTheDocument();
  });

  test("hides the toggle and explains when the repo has no CODEOWNERS", async () => {
    await renderWith(
      result({
        hasCodeowners: false,
        codeownersPath: undefined,
        files: files.map((f) => ({ ...f, ownedByMe: false, owners: [] })),
      }),
    );
    expect(screen.getByText("No CODEOWNERS in this repo.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Files view" })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });

  test("warns when team ownership could not be resolved", async () => {
    await renderWith(result({ teamsResolved: false }));
    expect(screen.getByRole("note")).toHaveTextContent(/read:org/);
  });

  test("mentions truncation at GitHub's cap", async () => {
    await renderWith(result({ truncated: true }));
    expect(screen.getByText(/truncated at 3000 files/)).toBeInTheDocument();
  });

  test("owned rows deep-link with the owned-by filter; others without", async () => {
    const user = userEvent.setup();
    await renderWith(result());
    await user.click(screen.getByRole("button", { name: "Open src/lib/a.rs diff on GitHub" }));
    expect(openMock).toHaveBeenLastCalledWith(
      "https://github.com/acme/repo/pull/42/files?owned-by%5B%5D=evan#diff-srclibars",
    );
    await user.click(screen.getByRole("button", { name: "All files (5)" }));
    await user.click(screen.getByRole("button", { name: "Open README.md diff on GitHub" }));
    expect(openMock).toHaveBeenLastCalledWith(
      "https://github.com/acme/repo/pull/42/files#diff-READMEmd",
    );
  });

  test("opens GitHub's owned-by filtered Files tab", async () => {
    const user = userEvent.setup();
    await renderWith(result());
    await user.click(screen.getByRole("button", { name: "Open my files on GitHub" }));
    expect(openMock).toHaveBeenLastCalledWith(
      "https://github.com/acme/repo/pull/42/files?owned-by%5B%5D=evan",
    );
  });

  test("shows owners and the previous path of a rename", async () => {
    const user = userEvent.setup();
    await renderWith(result());
    expect(screen.getByText("@acme/core")).toBeInTheDocument();
    expect(screen.getByText("@evan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All files (5)" }));
    expect(screen.getByText("docs/y.md →")).toBeInTheDocument();
  });

  test("renders loading and error states", async () => {
    invokeMock.mockImplementationOnce(() => new Promise(() => {}));
    render(<FilesBlock item={item} />);
    expect(screen.getByText("Loading files…")).toBeInTheDocument();

    invokeMock.mockRejectedValueOnce(new Error("no PAT configured"));
    render(<FilesBlock item={{ ...item, id: "pr:acme/repo#43" }} />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load files: no PAT configured")).toBeInTheDocument(),
    );
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BranchWithCopy, CopyBranchButton } from "../CopyBranchButton";
import { useAppStore } from "@/lib/store";

let writeText: ReturnType<typeof vi.fn>;

// userEvent.setup() installs its own clipboard stub, so ours goes on after it.
function setup() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return user;
}

beforeEach(() => {
  useAppStore.getState().reset();
  writeText = vi.fn(async () => {});
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("CopyBranchButton", () => {
  test("icon variant copies the branch and flips to copied state", async () => {
    const user = setup();
    render(<CopyBranchButton branch="feat/widget" />);
    const btn = screen.getByRole("button", { name: "Copy branch name feat/widget" });
    expect(btn).toHaveAttribute("title", "Copy branch name");
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith("feat/widget");
    await waitFor(() => expect(btn).toHaveAttribute("title", "Copied!"));
  });

  test("BranchWithCopy shows the branch name next to its copy button", async () => {
    const user = setup();
    render(<BranchWithCopy target={{ branch: "fix/typo" }} />);
    expect(screen.getByText("fix/typo")).toHaveAttribute("title", "fix/typo");
    await user.click(screen.getByRole("button", { name: "Copy branch name fix/typo" }));
    expect(writeText).toHaveBeenCalledWith("fix/typo");
  });

  test("BranchWithCopy renders nothing without a branch", () => {
    const { container } = render(<BranchWithCopy target={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("fork targets copy the checkout command instead of the branch", async () => {
    const user = setup();
    render(
      <BranchWithCopy
        target={{ branch: "alice:main", checkoutCommand: "gh pr checkout 42" }}
      />,
    );
    expect(screen.getByText("alice:main")).toBeInTheDocument();
    const btn = screen.getByRole("button", {
      name: "Copy checkout command gh pr checkout 42",
    });
    expect(btn.getAttribute("title")).toContain("fork");
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith("gh pr checkout 42");
  });

  test("does not bubble click or key events to a parent row", async () => {
    const user = setup();
    const onRowClick = vi.fn();
    const onRowKey = vi.fn();
    render(
      <div role="button" tabIndex={0} onClick={onRowClick} onKeyDown={onRowKey}>
        <CopyBranchButton branch="feat/widget" />
      </div>,
    );
    const btn = screen.getByRole("button", { name: "Copy branch name feat/widget" });
    await user.click(btn);
    btn.focus();
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowKey).not.toHaveBeenCalled();
  });

  test("surfaces a UI error and stays uncopied when the clipboard fails", async () => {
    const user = setup();
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<CopyBranchButton branch="feat/widget" />);
    const btn = screen.getByRole("button", { name: "Copy branch name feat/widget" });
    await user.click(btn);
    await waitFor(() =>
      expect(useAppStore.getState().uiError).toBe("Couldn't copy to clipboard"),
    );
    expect(btn).toHaveAttribute("title", "Copy branch name");
  });
});

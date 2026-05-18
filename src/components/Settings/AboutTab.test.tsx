import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AboutTab } from "./AboutTab";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("AboutTab", () => {
  test("renders the version when getVersion resolves", async () => {
    const { getVersion } = (await import(
      "@tauri-apps/api/app"
    )) as unknown as { getVersion: ReturnType<typeof vi.fn> };
    getVersion.mockResolvedValueOnce("2026.07");

    render(<AboutTab />);

    expect(await screen.findByText("Version 2026.07")).toBeInTheDocument();
  });

  test("hides the version line when getVersion rejects (non-Tauri context)", async () => {
    const { getVersion } = (await import(
      "@tauri-apps/api/app"
    )) as unknown as { getVersion: ReturnType<typeof vi.fn> };
    getVersion.mockRejectedValueOnce(new Error("not in tauri"));

    render(<AboutTab />);

    // Static content still rendered.
    expect(screen.getByText("Beet")).toBeInTheDocument();
    // Wait a tick for the rejected promise to settle, then assert no version row.
    await waitFor(() => {
      expect(screen.queryByText(/^Version /)).not.toBeInTheDocument();
    });
  });

  test("clicking the beet.sh link opens via the Tauri shell instead of navigating", async () => {
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    render(<AboutTab />);

    await user.click(screen.getByRole("link", { name: "beet.sh" }));

    expect(shellMod.open).toHaveBeenCalledWith("https://beet.sh");
  });

  test("falls back to window.open when the Tauri shell is unavailable", async () => {
    const user = userEvent.setup();
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    shellMod.open.mockRejectedValueOnce(new Error("no tauri"));
    const winOpen = vi
      .spyOn(window, "open")
      .mockImplementation(() => ({}) as Window);

    try {
      render(<AboutTab />);
      await user.click(screen.getByRole("link", { name: "beet.sh" }));

      await waitFor(() => {
        expect(winOpen).toHaveBeenCalledWith(
          "https://beet.sh",
          "_blank",
          "noopener,noreferrer",
        );
      });
    } finally {
      winOpen.mockRestore();
    }
  });
});

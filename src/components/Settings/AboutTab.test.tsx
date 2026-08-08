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

  test("check for updates reports up-to-date when versions match", async () => {
    const user = userEvent.setup();
    const { getVersion } = (await import(
      "@tauri-apps/api/app"
    )) as unknown as { getVersion: ReturnType<typeof vi.fn> };
    getVersion.mockResolvedValue("0.1.5");
    const { server } = await import("@/test/msw-server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get(
        "https://api.github.com/repos/evanhalley/beet/releases/latest",
        () =>
          HttpResponse.json({
            tag_name: "v0.1.5",
            html_url: "https://github.com/evanhalley/beet/releases/tag/v0.1.5",
          }),
      ),
    );

    render(<AboutTab />);
    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    expect(await screen.findByText(/up to date/i)).toBeInTheDocument();
  });

  test("check for updates links to a newer release", async () => {
    const user = userEvent.setup();
    const { getVersion } = (await import(
      "@tauri-apps/api/app"
    )) as unknown as { getVersion: ReturnType<typeof vi.fn> };
    getVersion.mockResolvedValue("0.1.5");
    const shellMod = (await import("@tauri-apps/plugin-shell")) as unknown as {
      open: ReturnType<typeof vi.fn>;
    };
    const { server } = await import("@/test/msw-server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get(
        "https://api.github.com/repos/evanhalley/beet/releases/latest",
        () =>
          HttpResponse.json({
            tag_name: "v0.2.0",
            html_url: "https://github.com/evanhalley/beet/releases/tag/v0.2.0",
          }),
      ),
    );

    render(<AboutTab />);
    await user.click(
      await screen.findByRole("button", { name: /check for updates/i }),
    );

    const link = await screen.findByRole("link", {
      name: /update available/i,
    });
    await user.click(link);
    expect(shellMod.open).toHaveBeenCalledWith(
      "https://github.com/evanhalley/beet/releases/tag/v0.2.0",
    );
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

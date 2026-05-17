import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { TitleBar } from "./TitleBar";
import { useAppStore } from "@/lib/store";

beforeEach(() => {
  useAppStore.getState().reset();
  vi.mocked(invoke).mockClear();
});

describe("TitleBar", () => {
  test("Refresh pokes the Rust poll loop", async () => {
    const user = userEvent.setup();
    render(<TitleBar onOpenSettings={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(invoke).toHaveBeenCalledWith("refresh_now");
  });

  test("Pause toggles the store and mirrors it to the Rust loop", async () => {
    const user = userEvent.setup();
    render(<TitleBar onOpenSettings={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Pause polling" }));
    expect(useAppStore.getState().paused).toBe(true);
    expect(invoke).toHaveBeenCalledWith("set_poll_paused", { paused: true });

    // The button now reflects the paused state and resumes on a second click.
    await user.click(screen.getByRole("button", { name: "Resume polling" }));
    expect(useAppStore.getState().paused).toBe(false);
    expect(invoke).toHaveBeenCalledWith("set_poll_paused", { paused: false });
  });

  test("Refresh is disabled while paused", async () => {
    const user = userEvent.setup();
    useAppStore.setState({ paused: true });
    render(<TitleBar onOpenSettings={() => {}} />);

    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toBeDisabled();
    await user.click(refresh);
    expect(invoke).not.toHaveBeenCalledWith("refresh_now");
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GeneralTab } from "./GeneralTab";

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));

async function autostartMod() {
  return (await import("@tauri-apps/plugin-autostart")) as unknown as {
    isEnabled: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
    disable: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GeneralTab launch at login", () => {
  test("renders unchecked when autostart is disabled", async () => {
    render(<GeneralTab />);

    const toggle = await screen.findByRole("checkbox", {
      name: /launch at login/i,
    });
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  test("enabling the toggle calls enable and checks the box", async () => {
    const user = userEvent.setup();
    const mod = await autostartMod();
    render(<GeneralTab />);

    const toggle = await screen.findByRole("checkbox", {
      name: /launch at login/i,
    });
    await user.click(toggle);

    expect(mod.enable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  test("disabling an enabled toggle calls disable", async () => {
    const user = userEvent.setup();
    const mod = await autostartMod();
    mod.isEnabled.mockResolvedValueOnce(true);
    render(<GeneralTab />);

    const toggle = await screen.findByRole("checkbox", {
      name: /launch at login/i,
    });
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);

    expect(mod.disable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle).not.toBeChecked());
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import { useAppStore } from "@/lib/store";

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("SettingsPanel", () => {
  test("opens on the General tab", () => {
    render(<SettingsPanel onClose={() => {}} />);

    expect(
      screen.getByRole("button", { name: "General" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("checkbox", { name: /launch at login/i }),
    ).toBeInTheDocument();
  });
});

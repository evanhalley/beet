import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceTab } from "./AppearanceTab";
import { useAppStore } from "@/lib/store";
import { THEME_LS_KEY } from "@/lib/theme";

beforeEach(() => {
  useAppStore.getState().reset();
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.removeItem(THEME_LS_KEY);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.removeItem(THEME_LS_KEY);
});

describe("AppearanceTab", () => {
  test("renders the three theme options with 'System' selected by default", () => {
    render(<AppearanceTab />);
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  test("selecting Dark sets data-theme on the document and updates the store", async () => {
    const user = userEvent.setup();
    render(<AppearanceTab />);
    await user.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
    expect(useAppStore.getState().settings.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_LS_KEY)).toBe("dark");
  });

  test("selecting Light sets data-theme=light", async () => {
    const user = userEvent.setup();
    render(<AppearanceTab />);
    await user.click(screen.getByRole("radio", { name: "Light" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
    expect(useAppStore.getState().settings.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_LS_KEY)).toBe("light");
  });

  test("selecting System removes the data-theme attribute (falls through to media query)", async () => {
    const user = userEvent.setup();
    // Start in dark so the toggle to System has something to clear.
    useAppStore.getState().setSettings({ theme: "dark" });
    document.documentElement.setAttribute("data-theme", "dark");
    render(<AppearanceTab />);

    await user.click(screen.getByRole("radio", { name: "System" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });
    expect(useAppStore.getState().settings.theme).toBe("system");
    expect(window.localStorage.getItem(THEME_LS_KEY)).toBe("system");
  });
});

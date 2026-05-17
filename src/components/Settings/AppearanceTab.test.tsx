import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceTab } from "./AppearanceTab";
import { useAppStore } from "@/lib/store";
import { FONT_SCALE_LS_KEY, THEME_LS_KEY } from "@/lib/theme";

beforeEach(() => {
  useAppStore.getState().reset();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--font-scale");
  window.localStorage.removeItem(THEME_LS_KEY);
  window.localStorage.removeItem(FONT_SCALE_LS_KEY);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--font-scale");
  window.localStorage.removeItem(THEME_LS_KEY);
  window.localStorage.removeItem(FONT_SCALE_LS_KEY);
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

  test("selecting System resolves data-theme against the OS preference", async () => {
    const user = userEvent.setup();
    // Start in dark so the toggle to System has something to change.
    useAppStore.getState().setSettings({ theme: "dark" });
    document.documentElement.setAttribute("data-theme", "dark");
    render(<AppearanceTab />);

    await user.click(screen.getByRole("radio", { name: "System" }));

    await waitFor(() => {
      // The test matchMedia mock reports light (matches: false), so "system"
      // resolves to a concrete data-theme="light".
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
    // The stored *preference* is still "system" — only the resolved attribute
    // is concrete.
    expect(useAppStore.getState().settings.theme).toBe("system");
    expect(window.localStorage.getItem(THEME_LS_KEY)).toBe("system");
  });

  test("renders the four font-size options with 'Default' selected by default", () => {
    render(<AppearanceTab />);
    expect(screen.getByRole("radio", { name: "Small" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Default" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Large" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Extra Large" })).not.toBeChecked();
  });

  test("selecting Large sets --font-scale on the document and updates the store", async () => {
    const user = userEvent.setup();
    render(<AppearanceTab />);
    await user.click(screen.getByRole("radio", { name: "Large" }));

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue("--font-scale"),
      ).toBe("1.15");
    });
    expect(useAppStore.getState().settings.fontScale).toBe(1.15);
    expect(window.localStorage.getItem(FONT_SCALE_LS_KEY)).toBe("1.15");
  });

  test("selecting System resolves to dark when the OS prefers dark", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("dark"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const user = userEvent.setup();
      // Start in light so clicking System actually fires an onChange.
      useAppStore.getState().setSettings({ theme: "light" });
      render(<AppearanceTab />);
      await user.click(screen.getByRole("radio", { name: "System" }));
      await waitFor(() => {
        expect(document.documentElement.getAttribute("data-theme")).toBe(
          "dark",
        );
      });
      expect(useAppStore.getState().settings.theme).toBe("system");
    } finally {
      window.matchMedia = original;
    }
  });
});

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceTab } from "../AppearanceTab";
import { useAppStore } from "@/lib/store";
import {
  ACCENT_LS_KEY,
  DENSITY_LS_KEY,
  FONT_SCALE_LS_KEY,
  THEME_LS_KEY,
} from "@/lib/theme";

function resetDom() {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.style.removeProperty("--font-scale");
  window.localStorage.removeItem(THEME_LS_KEY);
  window.localStorage.removeItem(FONT_SCALE_LS_KEY);
  window.localStorage.removeItem(ACCENT_LS_KEY);
  window.localStorage.removeItem(DENSITY_LS_KEY);
}

beforeEach(() => {
  useAppStore.getState().reset();
  resetDom();
});

afterEach(() => {
  resetDom();
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

  test("renders the four accent options with 'Beet' selected by default", () => {
    render(<AppearanceTab />);
    expect(screen.getByRole("radio", { name: "Beet" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Ocean" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Forest" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Ink" })).not.toBeChecked();
  });

  test("selecting Ocean sets data-accent on the document and updates the store", async () => {
    const user = userEvent.setup();
    render(<AppearanceTab />);
    await user.click(screen.getByRole("radio", { name: "Ocean" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-accent")).toBe("ocean");
    });
    expect(useAppStore.getState().settings.accent).toBe("ocean");
    expect(window.localStorage.getItem(ACCENT_LS_KEY)).toBe("ocean");
  });

  test("renders the three density options with 'Regular' selected by default", () => {
    render(<AppearanceTab />);
    expect(screen.getByRole("radio", { name: "Compact" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Regular" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Comfy" })).not.toBeChecked();
  });

  test("selecting Compact sets data-density on the document and updates the store", async () => {
    const user = userEvent.setup();
    render(<AppearanceTab />);
    await user.click(screen.getByRole("radio", { name: "Compact" }));

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-density")).toBe(
        "compact",
      );
    });
    expect(useAppStore.getState().settings.density).toBe("compact");
    expect(window.localStorage.getItem(DENSITY_LS_KEY)).toBe("compact");
  });

  test("selecting Regular removes the data-density attribute so CSS falls back to default", async () => {
    const user = userEvent.setup();
    // Start in Comfy so clicking Regular has something to unset.
    useAppStore.getState().setSettings({ density: "comfy" });
    document.documentElement.setAttribute("data-density", "comfy");
    render(<AppearanceTab />);

    await user.click(screen.getByRole("radio", { name: "Regular" }));

    await waitFor(() => {
      expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    });
    expect(useAppStore.getState().settings.density).toBe("regular");
    expect(window.localStorage.getItem(DENSITY_LS_KEY)).toBe("regular");
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

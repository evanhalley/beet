import { describe, it, expect } from "vitest";
import { formatBadge } from "../trayBadge";

describe("formatBadge", () => {
  it("returns empty string when zero and active", () => {
    expect(formatBadge(0, false)).toBe("");
  });

  it("returns pause glyph when zero and paused", () => {
    expect(formatBadge(0, true)).toBe("⏸");
  });

  it("returns count string when active", () => {
    expect(formatBadge(3, false)).toBe("3");
  });

  it("returns pause glyph with count when paused", () => {
    expect(formatBadge(3, true)).toBe("⏸ 3");
  });

  it("handles large counts", () => {
    expect(formatBadge(42, false)).toBe("42");
    expect(formatBadge(42, true)).toBe("⏸ 42");
  });
});

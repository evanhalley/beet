import { describe, expect, test } from "vitest";
import { rowActionsReserve } from "../RowShell";

describe("rowActionsReserve", () => {
  test("is zero with no overlaid actions", () => {
    expect(rowActionsReserve(0)).toBe(0);
  });

  test("grows by one button plus gap per extra action", () => {
    expect(rowActionsReserve(2) - rowActionsReserve(1)).toBe(26);
  });

  test("covers the overlay's reach past the content column", () => {
    // Overlay spans right 12px + 2×22 + 4 gap = 60px; the content column
    // already ends 16px padding + 10px grid gap from the edge.
    expect(rowActionsReserve(2)).toBeGreaterThanOrEqual(60 - 26);
  });
});

import { describe, expect, test } from "vitest";
import {
  DETAIL_WIDTH_DEFAULT,
  DETAIL_WIDTH_MIN,
  clampDetailWidth,
  maxDetailWidth,
} from "@/lib/paneWidth";

describe("maxDetailWidth", () => {
  test("leaves the list pane its minimum width", () => {
    expect(maxDetailWidth(1400)).toBe(1079);
  });

  test("never drops below the detail floor in a cramped grid", () => {
    expect(maxDetailWidth(400)).toBe(DETAIL_WIDTH_MIN);
  });

  test("is unbounded before the grid has been measured", () => {
    expect(maxDetailWidth(0)).toBe(Infinity);
    expect(maxDetailWidth(Number.NaN)).toBe(Infinity);
  });
});

describe("clampDetailWidth", () => {
  test("clamps to the floor and to the available room", () => {
    expect(clampDetailWidth(100, 1400)).toBe(DETAIL_WIDTH_MIN);
    expect(clampDetailWidth(5000, 1400)).toBe(1079);
    expect(clampDetailWidth(900.4, 1400)).toBe(900);
  });

  test("with an unknown grid width only the floor applies", () => {
    expect(clampDetailWidth(1500)).toBe(1500);
  });

  test("non-finite input falls back to the default", () => {
    expect(clampDetailWidth(Number.NaN, 1400)).toBe(DETAIL_WIDTH_DEFAULT);
  });
});

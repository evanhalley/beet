import { describe, expect, test } from "vitest";
import { durationSeconds, formatDuration } from "../duration";

describe("formatDuration", () => {
  test("seconds-only below a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
  });

  test("minutes + seconds below an hour", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(134)).toBe("2m 14s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  test("hours + minutes at and above one hour", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3660)).toBe("1h 1m");
    expect(formatDuration(7320)).toBe("2h 2m");
  });

  test("returns null for negative or non-finite input", () => {
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("durationSeconds", () => {
  test("computes the wall-clock delta between two ISO timestamps", () => {
    expect(
      durationSeconds("2026-01-01T00:00:00Z", "2026-01-01T00:02:14Z"),
    ).toBe(134);
  });

  test("returns null when either input is missing or unparseable", () => {
    expect(durationSeconds(null, "2026-01-01T00:00:00Z")).toBeNull();
    expect(durationSeconds("2026-01-01T00:00:00Z", undefined)).toBeNull();
    expect(durationSeconds("nope", "2026-01-01T00:00:00Z")).toBeNull();
  });

  test("returns null for negative deltas (clock skew)", () => {
    expect(
      durationSeconds("2026-01-01T00:02:00Z", "2026-01-01T00:00:00Z"),
    ).toBeNull();
  });
});

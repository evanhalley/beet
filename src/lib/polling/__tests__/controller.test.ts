import { describe, it, expect } from "vitest";
import { computeMultiplier, type PollingSignals } from "../controller";

function base(overrides: Partial<PollingSignals> = {}): PollingSignals {
  return {
    windowHidden: false,
    onBattery: false,
    rateLimitRemaining: 5000,
    hasInFlight: false,
    hasPinnedRepos: false,
    ...overrides,
  };
}

describe("computeMultiplier", () => {
  it("returns 1 by default (all signals off, plenty of rate limit)", () => {
    expect(computeMultiplier(base())).toBe(1);
  });

  it("returns 1 when in-flight items present", () => {
    expect(computeMultiplier(base({ hasInFlight: true }))).toBe(1);
  });

  it("returns 2 when window is hidden", () => {
    expect(computeMultiplier(base({ windowHidden: true }))).toBe(2);
  });

  it("returns 2 when on battery", () => {
    expect(computeMultiplier(base({ onBattery: true }))).toBe(2);
  });

  it("returns 2 when both window hidden and on battery (max-wins, not ×4)", () => {
    expect(
      computeMultiplier(base({ windowHidden: true, onBattery: true })),
    ).toBe(2);
  });

  it("returns 4 when rate limit remaining < 100", () => {
    expect(computeMultiplier(base({ rateLimitRemaining: 99 }))).toBe(4);
  });

  it("returns 4 (rate-limit beats window-hidden) when both apply", () => {
    expect(
      computeMultiplier(base({ rateLimitRemaining: 50, windowHidden: true })),
    ).toBe(4);
  });

  it("returns 1 when pinned repos exist (overrides everything)", () => {
    expect(
      computeMultiplier(
        base({
          hasPinnedRepos: true,
          rateLimitRemaining: 0,
          windowHidden: true,
          onBattery: true,
        }),
      ),
    ).toBe(1);
  });

  it("returns 4 at exactly rateLimitRemaining = 99 but 1 at 100", () => {
    expect(computeMultiplier(base({ rateLimitRemaining: 99 }))).toBe(4);
    expect(computeMultiplier(base({ rateLimitRemaining: 100 }))).toBe(1);
  });

  it("in-flight returns 1 even with window hidden (fast lane wins over ×2)", () => {
    expect(
      computeMultiplier(base({ hasInFlight: true, windowHidden: true })),
    ).toBe(1);
  });
});

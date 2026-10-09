import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CheckDot,
  deriveCheckDotState,
  deriveItemCheckDotState,
} from "../CheckDot";
import type { ActionableItem } from "@/lib/types";

describe("CheckDot", () => {
  test("renders each state with its title for screen readers", () => {
    const { rerender } = render(<CheckDot state="success" />);
    expect(screen.getByLabelText("Checks passing")).toBeInTheDocument();
    rerender(<CheckDot state="failure" />);
    expect(screen.getByLabelText("Checks failing")).toBeInTheDocument();
    rerender(<CheckDot state="pending" />);
    expect(screen.getByLabelText("Checks pending")).toBeInTheDocument();
    rerender(<CheckDot state="neutral" />);
    expect(screen.getByLabelText("No checks")).toBeInTheDocument();
  });
});

describe("deriveCheckDotState", () => {
  test("matches the design's derivation exactly", () => {
    expect(deriveCheckDotState("completed", "success")).toBe("success");
    expect(deriveCheckDotState("completed", "failure")).toBe("failure");
    expect(deriveCheckDotState("in_progress", undefined)).toBe("pending");
    expect(deriveCheckDotState("queued", undefined)).toBe("neutral");
    // Conclusions outside success/failure fall to neutral per the design;
    // the design specifically does NOT promote cancelled/timed_out to failure.
    expect(deriveCheckDotState("completed", "cancelled")).toBe("neutral");
    expect(deriveCheckDotState("completed", "neutral")).toBe("neutral");
  });
});

describe("deriveItemCheckDotState", () => {
  const item = (checkRuns: unknown[]) =>
    ({ pr: { checkRuns } }) as unknown as ActionableItem;
  const ok = { name: "lint", status: "completed", conclusion: "success" };
  const bad = { name: "test", status: "completed", conclusion: "failure" };
  const running = { name: "e2e", status: "in_progress" };

  test("any failing check wins, wherever it sits", () => {
    expect(deriveItemCheckDotState(item([ok, running, bad]))).toBe("failure");
  });

  test("a running check beats a passing first check", () => {
    expect(deriveItemCheckDotState(item([ok, running]))).toBe("pending");
  });

  test("falls back to the first check, or neutral with none", () => {
    expect(deriveItemCheckDotState(item([ok]))).toBe("success");
    expect(deriveItemCheckDotState(item([]))).toBe("neutral");
  });
});

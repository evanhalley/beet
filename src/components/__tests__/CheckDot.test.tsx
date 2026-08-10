import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { CheckDot, deriveCheckDotState } from "../CheckDot";

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

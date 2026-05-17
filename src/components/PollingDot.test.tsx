import { beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { PollingDot } from "./PollingDot";
import { useAppStore } from "@/lib/store";

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("PollingDot", () => {
  test("idle when no poll cycle is in flight", () => {
    render(<PollingDot />);
    expect(screen.getByLabelText("Idle")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  test("spins while the Rust loop reports a cycle in flight", () => {
    useAppStore.setState({ pollState: "polling" });
    render(<PollingDot />);
    expect(screen.getByLabelText("Polling")).toBeInTheDocument();
    expect(screen.getByText("syncing")).toBeInTheDocument();
  });

  test("a completed cycle stops the spin", () => {
    useAppStore.setState({ pollState: "ok" });
    render(<PollingDot />);
    expect(screen.getByLabelText("Idle")).toBeInTheDocument();
  });

  test("paused wins over an in-flight cycle", () => {
    useAppStore.setState({ pollState: "polling" });
    render(<PollingDot paused />);
    expect(screen.getByLabelText("Polling paused")).toBeInTheDocument();
    expect(screen.getByText("paused")).toBeInTheDocument();
  });
});

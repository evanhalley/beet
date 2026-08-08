import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { VALID_TOKEN, MISSING_NOTIFICATIONS_TOKEN, INVALID_TOKEN } from "@/test/msw-handlers";
import { useAppStore } from "@/lib/store";
import { AccountTab } from "../AccountTab";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

beforeEach(() => {
  useAppStore.getState().reset();
});

afterEach(() => {
  useAppStore.getState().reset();
});

describe("AccountTab", () => {
  test("validates a pasted token and renders ● valid + login + scopes", async () => {
    const user = userEvent.setup();
    render(<AccountTab />, { wrapper: makeWrapper() });

    const tokenInput = await screen.findByLabelText(/personal access token/i);
    await user.type(tokenInput, VALID_TOKEN);
    await user.click(screen.getByRole("button", { name: /validate/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid as octocat/i)).toBeInTheDocument();
    });
    for (const scope of ["repo", "read:org", "read:user", "user:email", "notifications"]) {
      const node = screen.getByTestId(`scope-${scope}`);
      expect(node.dataset.status).toBe("ok");
    }
  });

  test("renders missing scope status when token lacks notifications", async () => {
    const user = userEvent.setup();
    render(<AccountTab />, { wrapper: makeWrapper() });

    await user.type(screen.getByLabelText(/personal access token/i), MISSING_NOTIFICATIONS_TOKEN);
    await user.click(screen.getByRole("button", { name: /validate/i }));

    await waitFor(() => {
      expect(screen.getByTestId("scope-notifications").dataset.status).toBe("missing");
    });
    expect(screen.getByTestId("scope-repo").dataset.status).toBe("ok");
  });

  test("shows rejected pill when token is invalid", async () => {
    const user = userEvent.setup();
    render(<AccountTab />, { wrapper: makeWrapper() });

    await user.type(screen.getByLabelText(/personal access token/i), INVALID_TOKEN);
    await user.click(screen.getByRole("button", { name: /validate/i }));

    await waitFor(() => {
      expect(screen.getByText(/rejected/i)).toBeInTheDocument();
    });
  });
});

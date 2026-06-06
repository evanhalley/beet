import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./msw-server";

// Tauri APIs aren't available in jsdom; tests use injected providers/mocks.
// `invoke` is backed by an in-memory keychain so the secure_token commands
// round-trip (storeToken → getToken → clearToken) like the real Rust commands.
vi.mock("@tauri-apps/api/core", () => {
  const keychain = new Map<string, string>();
  const KEY = "github-pat";
  const fakeKeychain = {
    get: () => keychain.get(KEY),
    __reset: () => keychain.clear(),
  };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "store_token":
        keychain.set(KEY, String(args?.token ?? ""));
        return undefined;
      case "get_token":
        return keychain.get(KEY) ?? null;
      case "clear_token":
        keychain.delete(KEY);
        return undefined;
      default:
        return undefined;
    }
  });
  return { invoke, __fakeKeychain: fakeKeychain };
});

vi.mock("@tauri-apps/plugin-store", () => {
  const memory = new Map<string, unknown>();
  const fakeStore = {
    get: vi.fn(async (key: string) => memory.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      memory.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      memory.delete(key);
    }),
    save: vi.fn(async () => {}),
    __reset: () => memory.clear(),
  };
  return {
    load: vi.fn(async () => fakeStore),
    __fakeStore: fakeStore,
  };
});

// Server state is pushed in via Tauri events from the Rust poll loop; tests
// drive the store directly, so `listen` is a no-op that returns an unlisten fn.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

// jsdom has no matchMedia. Default to "light" (matches: false); tests that
// need dark can override window.matchMedia themselves.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// jsdom doesn't implement scrollIntoView; several components call it to reveal
// a section/row. Stub it so those code paths don't throw in tests.
if (
  typeof Element !== "undefined" &&
  !Element.prototype.scrollIntoView
) {
  Element.prototype.scrollIntoView = vi.fn();
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

beforeEach(async () => {
  const storeMod = (await import("@tauri-apps/plugin-store")) as unknown as {
    __fakeStore: { __reset: () => void };
  };
  storeMod.__fakeStore.__reset();
  const coreMod = (await import("@tauri-apps/api/core")) as unknown as {
    __fakeKeychain: { __reset: () => void };
  };
  coreMod.__fakeKeychain.__reset();
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

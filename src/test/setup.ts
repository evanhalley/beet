import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./msw-server";
import { __resetOctokitForTests } from "@/lib/github/octokit";

// Tauri APIs aren't available in jsdom; tests use injected providers/mocks.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    select: vi.fn(async () => []),
    execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
  };
  return {
    default: {
      load: vi.fn(async () => fakeDb),
    },
    __fakeDb: fakeDb,
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

beforeEach(async () => {
  const storeMod = (await import("@tauri-apps/plugin-store")) as unknown as {
    __fakeStore: { __reset: () => void };
  };
  storeMod.__fakeStore.__reset();
  __resetOctokitForTests();
});

afterEach(() => server.resetHandlers());
afterAll(() => server.close());

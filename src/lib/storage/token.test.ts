import { describe, test, expect } from "vitest";
import {
  clearLegacyPlaintextToken,
  clearToken,
  getToken,
  storeToken,
} from "./token";

describe("token storage", () => {
  test("getToken returns null when nothing is stored", async () => {
    expect(await getToken()).toBeNull();
  });

  test("round-trips the token through the keychain", async () => {
    await storeToken("ghp_example");
    expect(await getToken()).toBe("ghp_example");

    await clearToken();
    expect(await getToken()).toBeNull();
  });
});

describe("clearLegacyPlaintextToken", () => {
  test("deletes a leftover plaintext token from the store", async () => {
    const mod = (await import("@tauri-apps/plugin-store")) as unknown as {
      __fakeStore: {
        set: (k: string, v: unknown) => Promise<void>;
        get: (k: string) => Promise<unknown>;
      };
    };
    await mod.__fakeStore.set("github-pat", "ghp_plaintext");

    await clearLegacyPlaintextToken();

    expect(await mod.__fakeStore.get("github-pat")).toBeUndefined();
  });

  test("is a no-op when no plaintext token exists", async () => {
    await expect(clearLegacyPlaintextToken()).resolves.toBeUndefined();
  });
});

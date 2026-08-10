import { describe, test, expect } from "vitest";
import { clearToken, getToken, storeToken } from "../token";

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

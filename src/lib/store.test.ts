import { beforeEach, describe, expect, test } from "vitest";
import { selectShowAllReviews, useAppStore } from "./store";

beforeEach(() => {
  useAppStore.getState().reset();
});

describe("app store (client/UI state)", () => {
  test("setSelectedItemId updates the selection", () => {
    useAppStore.getState().setSelectedItemId("pr:acme/repo#1");
    expect(useAppStore.getState().selectedItemId).toBe("pr:acme/repo#1");
  });

  test("setShowAllReviewsOverride holds a session override", () => {
    useAppStore.getState().setShowAllReviewsOverride(true);
    expect(useAppStore.getState().showAllReviewsOverride).toBe(true);
    useAppStore.getState().setShowAllReviewsOverride(null);
    expect(useAppStore.getState().showAllReviewsOverride).toBeNull();
  });

  test("selectShowAllReviews: override wins over the persisted default", () => {
    useAppStore.getState().setSettings({ showAllApproved: true });
    expect(selectShowAllReviews(useAppStore.getState())).toBe(true);

    useAppStore.getState().setShowAllReviewsOverride(false);
    expect(selectShowAllReviews(useAppStore.getState())).toBe(false);
  });

  test("setSettings merges partial settings", () => {
    useAppStore.getState().setSettings({ taskRegex: "FOO-\\d+" });
    expect(useAppStore.getState().settings.taskRegex).toBe("FOO-\\d+");
  });

  test("setRateLimit stores the latest rate-limit snapshot", () => {
    useAppStore
      .getState()
      .setRateLimit({ remaining: 4200, limit: 5000, reset: 1700000000 });
    expect(useAppStore.getState().rateLimit?.remaining).toBe(4200);
  });

  test("reset restores initial state", () => {
    const s = useAppStore.getState();
    s.setSelectedItemId("x");
    s.setUiError("boom");
    s.setShowAllReviewsOverride(true);
    s.reset();

    const after = useAppStore.getState();
    expect(after.selectedItemId).toBeNull();
    expect(after.uiError).toBeNull();
    expect(after.showAllReviewsOverride).toBeNull();
  });
});

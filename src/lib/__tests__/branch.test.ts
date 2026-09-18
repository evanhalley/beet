import { describe, expect, test } from "vitest";
import { prBranchTarget } from "../branch";

describe("prBranchTarget", () => {
  test("returns null when the branch is unknown", () => {
    expect(prBranchTarget({ number: 1 })).toBeNull();
  });

  test("copies the bare branch for same-repo PRs", () => {
    expect(prBranchTarget({ number: 1, headRef: "feat/x" })).toEqual({
      branch: "feat/x",
    });
  });

  test("labels fork PRs owner:branch and copies gh pr checkout", () => {
    expect(
      prBranchTarget({ number: 42, headRef: "main", headForkOwner: "alice" }),
    ).toEqual({ branch: "alice:main", checkoutCommand: "gh pr checkout 42" });
  });
});

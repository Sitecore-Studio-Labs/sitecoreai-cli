import { describe, expect, it } from "vitest";
import { requireUnverified } from "../../../../src/agents/tasks/shared";

describe("requireUnverified", () => {
  it("passes when the operator opted in with --unverified", () => {
    expect(() => requireUnverified(true, "skill", "delete")).not.toThrow();
  });

  it("throws INPUT_INVALID, naming the resource and verb, when --unverified is absent", () => {
    try {
      requireUnverified(false, "widget", "update");
      expect.unreachable("requireUnverified should have thrown");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("INPUT_INVALID");
      expect((error as Error).message).toContain("widget");
      expect((error as Error).message).toContain("update");
    }
  });

  it("treats an undefined flag the same as false (opt-in, not opt-out)", () => {
    expect(() => requireUnverified(undefined, "schema", "delete")).toThrow();
  });
});

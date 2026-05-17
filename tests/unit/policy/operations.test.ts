import { describe, expect, it } from "vitest";
import { OPERATION_RISK, riskTierForOperation } from "../../../src/policy";

describe("operation risk registry", () => {
  it("classifies every registered operation as destructive", () => {
    for (const tier of Object.values(OPERATION_RISK)) {
      expect(tier).toBe("destructive");
    }
  });

  it("riskTierForOperation returns the registered tier", () => {
    expect(riskTierForOperation("cleanup-versions-prune")).toBe("destructive");
    expect(riskTierForOperation("recipe-push")).toBe("destructive");
  });

  it("registers the destructive cleanup verbs and recipe push", () => {
    const ids = Object.keys(OPERATION_RISK);
    expect(ids).toContain("cleanup-versions-prune");
    expect(ids).toContain("cleanup-archive-purge");
    expect(ids).toContain("cleanup-users");
    expect(ids).toContain("cleanup-site-residue");
    expect(ids).toContain("recipe-push");
  });
});

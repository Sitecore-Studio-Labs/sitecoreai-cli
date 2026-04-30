import { describe, expect, it } from "vitest";
import {
  defaultPolicyForRecipe,
  policyFor,
  policyForOp,
  purposeForRecipe,
} from "../../../src/recipe/policy";
import type { CreateItemOp } from "../../../src/recipe/ir/operations";

describe("policy.ts — Phase 1 invariants", () => {
  it("component-template recipes emit template-structure ops with CreateAndUpdate", () => {
    expect(purposeForRecipe("component-template")).toBe("template-structure");
    expect(defaultPolicyForRecipe("component-template")).toBe("CreateAndUpdate");
  });

  it("content-template recipes also emit template-structure ops with CreateAndUpdate", () => {
    expect(purposeForRecipe("content-template")).toBe("template-structure");
    expect(defaultPolicyForRecipe("content-template")).toBe("CreateAndUpdate");
  });

  it("policyFor distinguishes Phase 3+ purposes (datasource-item / page-item → CreateOnly)", () => {
    expect(policyFor("template-structure")).toBe("CreateAndUpdate");
    expect(policyFor("datasource-item")).toBe("CreateOnly");
    expect(policyFor("page-item")).toBe("CreateOnly");
  });

  it("policyForOp returns the op's own attached policy", () => {
    const op: CreateItemOp = {
      op: "CreateItem",
      policy: "CreateOnly",
      label: "test",
      id: "00000000-0000-0000-0000-000000000000",
      parent: "/sitecore/content",
      templateOf: "00000000-0000-0000-0000-000000000001",
      name: "test",
      fields: [],
    };
    expect(policyForOp(op)).toBe("CreateOnly");
  });
});

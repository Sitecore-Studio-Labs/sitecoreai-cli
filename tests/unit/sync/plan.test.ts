import { describe, expect, it } from "vitest";
import { planIsNoop, summarizePlan, writingChanges } from "../../../src/sync/plan";
import type { RecipePlan } from "../../../src/sync/plan";

const plan: RecipePlan = {
  changes: [
    { kind: "create", path: "a", summary: "a" },
    { kind: "update", path: "b", summary: "b" },
    { kind: "update", path: "c", summary: "c" },
    { kind: "noop", path: "d", summary: "d" },
    { kind: "delete", path: "e", summary: "e" },
  ],
};

describe("summarizePlan", () => {
  it("tallies changes by kind", () => {
    expect(summarizePlan(plan)).toEqual({ create: 1, update: 2, delete: 1, noop: 1 });
  });

  it("returns all-zero for an empty plan", () => {
    expect(summarizePlan({ changes: [] })).toEqual({ create: 0, update: 0, delete: 0, noop: 0 });
  });
});

describe("planIsNoop", () => {
  it("is false when any change writes", () => {
    expect(planIsNoop(plan)).toBe(false);
  });

  it("is true when every change is a noop", () => {
    expect(planIsNoop({ changes: [{ kind: "noop", path: "a", summary: "a" }] })).toBe(true);
  });

  it("is true for an empty plan", () => {
    expect(planIsNoop({ changes: [] })).toBe(true);
  });
});

describe("writingChanges", () => {
  it("drops noop changes and keeps the rest", () => {
    expect(writingChanges(plan).map((change) => change.kind)).toEqual([
      "create",
      "update",
      "update",
      "delete",
    ]);
  });
});

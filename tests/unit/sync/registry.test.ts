import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getKind, listKinds, registerKind } from "../../../src/sync/registry";
import type { RecipeKind } from "../../../src/sync/kind";

// The registry is a module-level singleton, so each test uses a unique
// kind name to stay independent of the others in this file.
const makeKind = (name: string): RecipeKind<{ v: string }> => ({
  name,
  schema: z.object({ v: z.string() }),
  readCurrent: async () => null,
  plan: async () => ({ changes: [] }),
  apply: async () => ({ applied: [], skipped: [] }),
});

describe("kind registry", () => {
  it("registers a kind and looks it up by name", () => {
    registerKind(makeKind("reg-demo-a"));
    expect(getKind("reg-demo-a").name).toBe("reg-demo-a");
  });

  it("throws on duplicate registration", () => {
    registerKind(makeKind("reg-demo-b"));
    expect(() => registerKind(makeKind("reg-demo-b"))).toThrow(/already registered/i);
  });

  it("throws a hinted error for an unknown kind", () => {
    expect(() => getKind("nope-xyz")).toThrow(/Unknown recipe kind/i);
  });

  it("lists registered kinds sorted", () => {
    registerKind(makeKind("reg-zzz"));
    registerKind(makeKind("reg-aaa"));
    const names = listKinds();
    expect(names).toEqual([...names].sort());
    expect(names).toContain("reg-aaa");
    expect(names).toContain("reg-zzz");
  });
});

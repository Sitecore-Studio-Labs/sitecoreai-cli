import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  aggregatePull,
  aggregateStatus,
  aggregatePush,
  slugifyRecipeId,
} from "../../../src/sync/aggregate";
import type { RecipeKind, SyncContext } from "../../../src/sync/kind";
import type { RecipePlan } from "../../../src/sync/plan";
import type { Logger } from "../../../src/shared/logger";

interface Demo {
  name: string;
}

const ctx: SyncContext = { environmentName: "test", logger: {} as Logger };
const schema = z.object({ name: z.string() });

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "scai-aggregate-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Build a kind whose behavior is fully overridable. */
const fakeKind = (name: string, overrides: Partial<RecipeKind<Demo>> = {}): RecipeKind<Demo> => ({
  name,
  schema,
  readCurrent: async () => null,
  plan: async () => ({ changes: [{ kind: "noop", path: "name", summary: "name" }] }),
  apply: async (plan: RecipePlan) => ({ applied: plan.changes, skipped: [] }),
  ...overrides,
});

describe("slugifyRecipeId", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugifyRecipeId("My Brand Kit!")).toBe("my-brand-kit");
  });

  it("falls back to 'item' for an all-symbol id", () => {
    expect(slugifyRecipeId("***")).toBe("item");
  });
});

describe("aggregatePull", () => {
  it("skips kinds that do not implement list()", async () => {
    const kind = fakeKind("no-list");
    const result = await aggregatePull([kind], ctx, { dir: workDir });
    expect(result.kinds).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("captures each enumerated instance as a recipe file", async () => {
    const kind = fakeKind("brand", {
      list: async () => [
        { kind: "brand", id: "Kit One" },
        { kind: "brand", id: "Kit Two" },
      ],
      readCurrent: async (ref) => ({ name: ref.id }),
    });
    // aggregatePull's writeRecipe expects the kind subdirectory to exist.
    fs.mkdirSync(path.join(workDir, "brand"), { recursive: true });

    const result = await aggregatePull([kind], ctx, { dir: workDir });

    expect(result.total).toBe(2);
    expect(result.kinds[0].pulled).toHaveLength(2);
    // Files were actually written under <dir>/<kind>/<slug>.yaml.
    expect(fs.existsSync(path.join(workDir, "brand", "kit-one.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, "brand", "kit-two.yaml"))).toBe(true);
  });

  it("records a kind as skipped when list() throws", async () => {
    const kind = fakeKind("brand", {
      list: async () => {
        throw new Error("no credential");
      },
    });

    const result = await aggregatePull([kind], ctx, { dir: workDir });

    expect(result.kinds[0].skipped).toContain("no credential");
    expect(result.total).toBe(0);
  });

  it("skips instances whose readCurrent resolves null", async () => {
    const kind = fakeKind("brand", {
      list: async () => [{ kind: "brand", id: "ghost" }],
      readCurrent: async () => null,
    });

    const result = await aggregatePull([kind], ctx, { dir: workDir });
    expect(result.total).toBe(0);
    expect(result.kinds[0].pulled).toEqual([]);
  });
});

describe("aggregateStatus", () => {
  /** Drop a recipe file into the workspace for `kind`. */
  const seed = (kind: string, slug: string, recipe: Demo): void => {
    const dir = path.join(workDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.yaml`), `name: ${recipe.name}\n`, "utf8");
  };

  it("omits kinds with no workspace files", async () => {
    const kind = fakeKind("brand");
    const result = await aggregateStatus([kind], ctx, { dir: workDir });
    expect(result.kinds).toEqual([]);
    expect(result.drifted).toBe(0);
  });

  it("classifies a noop plan as in-sync", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => ({ changes: [{ kind: "noop", path: "name", summary: "name" }] }),
    });

    const result = await aggregateStatus([kind], ctx, { dir: workDir });

    expect(result.drifted).toBe(0);
    expect(result.kinds[0].items[0].status).toBe("in-sync");
  });

  it("classifies a writing plan as drift with a summary", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => ({ changes: [{ kind: "update", path: "name", summary: "name" }] }),
    });

    const result = await aggregateStatus([kind], ctx, { dir: workDir });

    expect(result.drifted).toBe(1);
    expect(result.kinds[0].items[0]).toMatchObject({
      status: "drift",
      summary: { update: 1 },
    });
  });

  it("classifies a thrown plan as error", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => {
        throw new Error("diff failed");
      },
    });

    const result = await aggregateStatus([kind], ctx, { dir: workDir });

    expect(result.kinds[0].items[0]).toMatchObject({
      status: "error",
      error: "diff failed",
    });
  });
});

describe("aggregatePush", () => {
  const seed = (kind: string, slug: string, recipe: Demo): void => {
    const dir = path.join(workDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.yaml`), `name: ${recipe.name}\n`, "utf8");
  };

  it("omits kinds with no workspace files", async () => {
    const kind = fakeKind("brand");
    const result = await aggregatePush([kind], ctx, { dir: workDir, mode: "apply" });
    expect(result.kinds).toEqual([]);
    expect(result.applied).toBe(0);
  });

  it("reports planned changes (no write) in what-if mode", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => ({
        changes: [
          { kind: "update", path: "a", summary: "a" },
          { kind: "create", path: "b", summary: "b" },
        ],
      }),
    });

    const result = await aggregatePush([kind], ctx, { dir: workDir, mode: "what-if" });

    expect(result.applied).toBe(0);
    expect(result.kinds[0].items[0]).toMatchObject({ status: "planned", plannedCount: 2 });
  });

  it("reports applied change count in apply mode", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => ({ changes: [{ kind: "update", path: "a", summary: "a" }] }),
      apply: async (plan) => ({ applied: plan.changes, skipped: [] }),
    });

    const result = await aggregatePush([kind], ctx, { dir: workDir, mode: "apply" });

    expect(result.applied).toBe(1);
    expect(result.kinds[0].items[0]).toMatchObject({ status: "applied", appliedCount: 1 });
  });

  it("reports in-sync for a noop plan in apply mode", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => ({ changes: [{ kind: "noop", path: "a", summary: "a" }] }),
    });

    const result = await aggregatePush([kind], ctx, { dir: workDir, mode: "apply" });

    expect(result.applied).toBe(0);
    expect(result.kinds[0].items[0].status).toBe("in-sync");
  });

  it("classifies a thrown push as error", async () => {
    seed("brand", "kit", { name: "kit" });
    const kind = fakeKind("brand", {
      plan: async () => {
        throw new Error("push blew up");
      },
    });

    const result = await aggregatePush([kind], ctx, { dir: workDir, mode: "apply" });

    expect(result.kinds[0].items[0]).toMatchObject({ status: "error", error: "push blew up" });
  });
});

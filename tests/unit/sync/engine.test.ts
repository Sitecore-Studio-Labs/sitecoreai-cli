import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { syncDiff, syncPull, syncPush } from "../../../src/sync/engine";
import type { RecipeKind, SyncContext } from "../../../src/sync/kind";
import type { RecipePlan } from "../../../src/sync/plan";
import type { Logger } from "../../../src/shared/logger";

interface Demo {
  name: string;
}

// The engine never touches the logger; a bare stub keeps the unit pure.
const ctx: SyncContext = { environmentName: "test", logger: {} as Logger };
const ref = { kind: "demo", id: "x" } as const;

const updatePlan: RecipePlan = { changes: [{ kind: "update", path: "name", summary: "name" }] };
const noopPlan: RecipePlan = { changes: [{ kind: "noop", path: "name", summary: "name" }] };
const deletePlan: RecipePlan = {
  changes: [
    { kind: "update", path: "name", summary: "name" },
    { kind: "delete", path: "old", summary: "old" },
  ],
};

const fakeKind = (overrides: Partial<RecipeKind<Demo>> = {}): RecipeKind<Demo> => ({
  name: "demo",
  schema: z.object({ name: z.string() }),
  readCurrent: vi.fn(async () => null),
  plan: vi.fn(async () => updatePlan),
  apply: vi.fn(async (plan) => ({ applied: plan.changes, skipped: [] })),
  ...overrides,
});

describe("syncPull", () => {
  it("returns whatever the kind captures", async () => {
    const kind = fakeKind({ readCurrent: vi.fn(async () => ({ name: "live" })) });
    await expect(syncPull(kind, ref, ctx)).resolves.toEqual({ name: "live" });
  });
});

describe("syncDiff", () => {
  it("delegates to the kind's plan with the desired recipe + ref", async () => {
    const kind = fakeKind();
    const plan = await syncDiff(kind, { name: "desired" }, ref, ctx);
    expect(kind.plan).toHaveBeenCalledWith({ name: "desired" }, ref, ctx);
    expect(plan).toBe(updatePlan);
  });
});

describe("syncPush", () => {
  it("what-if mode returns the plan without applying", async () => {
    const kind = fakeKind();
    const outcome = await syncPush(kind, { name: "d" }, ref, ctx, { mode: "what-if" });
    // syncPush rebuilds the plan when filtering deletes, so compare by value.
    expect(outcome.plan).toEqual(updatePlan);
    expect(outcome.result).toBeNull();
    expect(kind.apply).not.toHaveBeenCalled();
  });

  it("apply mode applies a writing plan", async () => {
    const kind = fakeKind();
    const outcome = await syncPush(kind, { name: "d" }, ref, ctx, { mode: "apply" });
    expect(kind.apply).toHaveBeenCalledOnce();
    expect(outcome.result).toEqual({ applied: updatePlan.changes, skipped: [] });
  });

  it("apply mode skips a no-op plan — never calls apply", async () => {
    const kind = fakeKind({ plan: vi.fn(async () => noopPlan) });
    const outcome = await syncPush(kind, { name: "d" }, ref, ctx, { mode: "apply" });
    expect(kind.apply).not.toHaveBeenCalled();
    expect(outcome.result).toBeNull();
  });

  it("drops delete changes unless prune is set", async () => {
    const kind = fakeKind({ plan: vi.fn(async () => deletePlan) });
    const outcome = await syncPush(kind, { name: "d" }, ref, ctx, { mode: "what-if" });
    expect(outcome.plan.changes.map((change) => change.kind)).toEqual(["update"]);
  });

  it("keeps delete changes when prune is set", async () => {
    const kind = fakeKind({ plan: vi.fn(async () => deletePlan) });
    const outcome = await syncPush(kind, { name: "d" }, ref, ctx, {
      mode: "what-if",
      prune: true,
    });
    expect(outcome.plan.changes.map((change) => change.kind)).toEqual(["update", "delete"]);
  });

  it("throws CANCELLED when the signal aborts before apply", async () => {
    const kind = fakeKind();
    const controller = new AbortController();
    controller.abort();
    const abortCtx: SyncContext = { ...ctx, signal: controller.signal };
    await expect(
      syncPush(kind, { name: "d" }, ref, abortCtx, { mode: "apply" })
    ).rejects.toThrow(/cancelled/i);
    expect(kind.apply).not.toHaveBeenCalled();
  });
});

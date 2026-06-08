import { describe, expect, it, vi } from "vitest";
import type { KindRef, SyncContext } from "../../../src/sync/kind";
import { resolveMissingCurrentPlan } from "../../../src/sync/missing-on-tenant";
import type { RecipePlan } from "../../../src/sync/plan";

const ref: KindRef = { kind: "brand-kit", id: "acme" };
const recreatePlan: RecipePlan = {
  changes: [{ kind: "create", path: "x", summary: "create acme" }],
};
const recreate = () => recreatePlan;

const makeStorage = (hasBaseline: boolean) => ({
  load: vi.fn(async () => (hasBaseline ? { kind: "brand-kit", payload: {} } : null)),
  write: vi.fn(async () => "loc"),
  locator: () => "loc",
});

const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
  environmentName: "test",
  ...over,
});

const call = (over: Partial<SyncContext>) =>
  resolveMissingCurrentPlan({
    kindName: "brand-kit",
    ref,
    ctx: ctx(over),
    entityLabel: "Brand kit",
    recreate,
  });

describe("resolveMissingCurrentPlan", () => {
  it("recreates when no baseline storage is wired (can't tell deleted from first-push)", async () => {
    expect(await call({})).toBe(recreatePlan);
  });

  it("recreates when storage has no baseline for the entity (never pushed)", async () => {
    expect(await call({ baselineStorage: makeStorage(false) })).toBe(recreatePlan);
  });

  it("recreates a deleted entity under recipe-wins", async () => {
    expect(
      await call({ baselineStorage: makeStorage(true), pushConflictPolicy: "recipe-wins" })
    ).toBe(recreatePlan);
  });

  it("honors the deletion (no-op plan) under cms-wins", async () => {
    expect(
      await call({ baselineStorage: makeStorage(true), pushConflictPolicy: "cms-wins" })
    ).toEqual({ changes: [] });
  });

  it("blocks with POLICY_DENIED under error policy", async () => {
    await expect(
      call({ baselineStorage: makeStorage(true), pushConflictPolicy: "error" })
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("defaults to error (blocks) when no policy is set", async () => {
    await expect(call({ baselineStorage: makeStorage(true) })).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
  });
});

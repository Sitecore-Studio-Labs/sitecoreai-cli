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

  it("recreates a deleted entity under error policy (explicit resync = put it back)", async () => {
    expect(await call({ baselineStorage: makeStorage(true), pushConflictPolicy: "error" })).toBe(
      recreatePlan
    );
  });

  it("recreates a deleted entity when no policy is set (defaults to recreate)", async () => {
    expect(await call({ baselineStorage: makeStorage(true) })).toBe(recreatePlan);
  });
});

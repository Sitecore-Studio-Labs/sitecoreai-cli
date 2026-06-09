/**
 * The typed sync contract + the shared three-way merge-resolution
 * matrix.
 *
 * Two concerns:
 *
 *  1. {@link resolveCellByPolicy} is the ONE place every kind's merge
 *     driver delegates the "which side wins this cell?" decision. The
 *     per-kind traversals differ (brand sections×fields, campaign
 *     project+deliverables×tasks) and rightly stay separate — but the
 *     resolution they all funnel through must behave identically. This
 *     suite pins the full classification × policy matrix so a change to
 *     resolution can't silently diverge one kind from the others.
 *
 *  2. The contract builders ({@link buildSyncResult}) are the boundary
 *     where scai's internal outcome becomes the wire shape the
 *     orchestrator parses. The projection (classification lifted from
 *     `meta`, conflicts derived, identities passed through) is pinned
 *     here and validated against {@link SyncResultSchema}.
 */
import { describe, expect, it } from "vitest";

import { resolveCellByPolicy } from "../../../src/sync/merge-cells";
import type { FieldClassification } from "../../../src/sync/baseline";
import {
  SYNC_CONTRACT_VERSION,
  SyncResultSchema,
  buildSyncResult,
} from "../../../src/sync/contract";
import type { PushOutcome } from "../../../src/sync/engine";

const CLASSIFICATIONS: FieldClassification[] = [
  "first-push",
  "recipe-change",
  "cms-edit",
  "conflict",
];

describe("resolveCellByPolicy — the shared merge-resolution matrix", () => {
  // Non-divergent cells always take the desired (recipe-author) value,
  // regardless of policy — there's no tenant edit to preserve.
  describe.each(["error", "recipe-wins", "cms-wins"] as const)("under %s", (policy) => {
    it.each(["first-push", "recipe-change"] as const)(
      "resolves %s to desired",
      (classification) => {
        expect(resolveCellByPolicy(classification, policy)).toBe("desired");
      }
    );
  });

  // The two gating classifications — a tenant edit (cms-edit) or a
  // both-sides-moved divergence (conflict) — are where policy bites.
  describe.each(["cms-edit", "conflict"] as const)("a %s cell", (classification) => {
    it("blocks under error policy (policyError)", () => {
      expect(resolveCellByPolicy(classification, "error")).toBe("policyError");
    });
    it("preserves the tenant value under cms-wins (current)", () => {
      expect(resolveCellByPolicy(classification, "cms-wins")).toBe("current");
    });
    it("clobbers with the recipe value under recipe-wins (desired)", () => {
      expect(resolveCellByPolicy(classification, "recipe-wins")).toBe("desired");
    });
  });

  it("covers every classification (guards against an unhandled new state)", () => {
    for (const classification of CLASSIFICATIONS) {
      for (const policy of ["error", "recipe-wins", "cms-wins"] as const) {
        const result = resolveCellByPolicy(classification, policy);
        expect(["desired", "current", "policyError"]).toContain(result);
      }
    }
  });
});

const pushOutcome = (overrides?: Partial<PushOutcome>): PushOutcome => ({
  plan: {
    changes: [
      { kind: "update", path: "sections.voice.tone", summary: "tone" },
      {
        kind: "update",
        path: "sections.voice.style",
        summary: "style (tenant edit, resolved cms-wins)",
        meta: { classification: "cms-edit" },
      },
      { kind: "noop", path: "sections.voice.name", summary: "name" },
    ],
  },
  result: {
    applied: [
      { kind: "update", path: "sections.voice.tone", summary: "tone" },
      { kind: "update", path: "sections.voice.style", summary: "style" },
    ],
    skipped: [],
    identities: [{ scope: "brand-kit", handle: "acme", sitecoreId: "uuid-123" }],
  },
  ...overrides,
});

describe("buildSyncResult — the wire-contract projection", () => {
  it("projects a push outcome into a schema-valid SyncResult", () => {
    const result = buildSyncResult({
      operation: "push",
      kind: "brand-kit",
      ref: { kind: "brand-kit", id: "Acme", baselineKey: "acme", tenantId: "uuid-123" },
      mode: "apply",
      outcome: pushOutcome(),
    });

    // Validates against the mirrored schema downstream consumers use.
    expect(() => SyncResultSchema.parse(result)).not.toThrow();
    expect(result.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(result.operation).toBe("push");
    expect(result.ref).toEqual({ id: "Acme", baselineKey: "acme", tenantId: "uuid-123" });
    expect(result.summary).toEqual({ create: 0, update: 2, delete: 0, noop: 1 });
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("lifts per-cell classification out of meta onto the change", () => {
    const result = buildSyncResult({
      operation: "push",
      kind: "brand-kit",
      ref: { kind: "brand-kit", id: "Acme" },
      mode: "apply",
      outcome: pushOutcome(),
    });
    const styleChange = result.plan.find((c) => c.path === "sections.voice.style");
    expect(styleChange?.classification).toBe("cms-edit");
  });

  it("derives resolved conflicts from the plan", () => {
    const result = buildSyncResult({
      operation: "push",
      kind: "brand-kit",
      ref: { kind: "brand-kit", id: "Acme" },
      mode: "apply",
      outcome: pushOutcome(),
    });
    expect(result.conflicts).toEqual([
      { path: "sections.voice.style", classification: "cms-edit" },
    ]);
  });

  it("passes resolved identities through to the envelope", () => {
    const result = buildSyncResult({
      operation: "push",
      kind: "brand-kit",
      ref: { kind: "brand-kit", id: "Acme" },
      mode: "apply",
      outcome: pushOutcome(),
    });
    expect(result.identities).toEqual([
      { scope: "brand-kit", handle: "acme", sitecoreId: "uuid-123" },
    ]);
  });

  it("reports zero applied/skipped and no conflicts under what-if", () => {
    const result = buildSyncResult({
      operation: "diff",
      kind: "brand-kit",
      ref: { kind: "brand-kit", id: "Acme" },
      mode: "what-if",
      outcome: pushOutcome({ result: null }),
    });
    expect(() => SyncResultSchema.parse(result)).not.toThrow();
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.identities).toEqual([]);
    // A what-if still surfaces the (unresolved) divergence informationally.
    expect(result.conflicts).toEqual([
      { path: "sections.voice.style", classification: "cms-edit" },
    ]);
  });
});

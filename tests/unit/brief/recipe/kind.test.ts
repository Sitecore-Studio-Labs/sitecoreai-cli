import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Baseline, BaselineStorage, SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";
import {
  captureBriefTypeBaselinePayload,
  type BriefTypeBaselinePayload,
} from "../../../../src/brief/recipe/baseline";

// Stub the env -> client bridge so the kind never reads real config or
// mints a real token.
vi.mock("../../../../src/brief/recipe/client", () => ({
  resolveBriefClient: async () => ({ accessToken: "tok" }),
}));

// Mock the Brief API surface the kind composes.
const briefApi = vi.hoisted(() => ({
  listBriefTypes: vi.fn(),
  createBriefType: vi.fn(),
  updateBriefType: vi.fn(),
}));
// The kind imports these primitives from their defining sibling module
// (not the `@/brief` barrel) to avoid the intra-domain barrel cycle.
vi.mock("../../../../src/brief/api/brief-types", () => briefApi);

import { briefTypeKind } from "../../../../src/brief/recipe/kind";

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "brief-type", id: "CreativeBrief" } as const;

/**
 * Minimal in-memory BaselineStorage for kind-level three-way tests.
 * Mirrors the contract on `BaselineStorage` — `load` returns `null` on
 * unknown keys, `write` replaces wholesale, `locator` is diagnostic.
 */
const createMemoryStorage = (): BaselineStorage & {
  store: Map<string, Baseline<unknown>>;
} => {
  const store = new Map<string, Baseline<unknown>>();
  const keyOf = (kind: string, env: string, handle: string) => `${kind}|${env}|${handle}`;
  return {
    store,
    async load<T = unknown>(kind: string, env: string, handle: string) {
      return (store.get(keyOf(kind, env, handle)) ?? null) as Baseline<T> | null;
    },
    async write<T = unknown>(kind: string, env: string, handle: string, baseline: Baseline<T>) {
      store.set(keyOf(kind, env, handle), baseline as Baseline<unknown>);
      return `memory:${keyOf(kind, env, handle)}`;
    },
    locator(kind, env, handle) {
      return `memory:${keyOf(kind, env, handle)}`;
    },
  };
};

const sampleRecipe = (overrides: Partial<Record<string, unknown>> = {}) =>
  briefTypeKind.schema.parse({
    name: "CreativeBrief",
    label: { "en-us": "Creative Brief" },
    description: "A brief for creative work.",
    icon: "mdi-pencil",
    iconColor: "#3366FF",
    fields: [
      {
        type: "RichText",
        name: "summary",
        label: { "en-us": "Summary" },
        required: true,
        aiEditable: true,
      },
    ],
    ...overrides,
  });

const liveType = {
  id: "type-1",
  name: "CreativeBrief",
  label: { "en-us": "Creative Brief" },
  description: "A brief for creative work.",
  icon: "mdi-pencil",
  iconColor: "#3366FF",
  fields: [
    {
      type: "RichText",
      name: "summary",
      label: { "en-us": "Summary" },
      required: true,
      aiEditable: true,
    },
  ],
  createdOn: "2026-01-01T00:00:00Z",
  createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
  updatedOn: "2026-01-01T00:00:00Z",
  updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("briefTypeKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(briefTypeKind.name).toBe("brief-type");
    expect(briefTypeKind.schema).toBeDefined();
    expect(typeof briefTypeKind.readCurrent).toBe("function");
    expect(typeof briefTypeKind.plan).toBe("function");
    expect(typeof briefTypeKind.apply).toBe("function");
    expect(typeof briefTypeKind.list).toBe("function");
  });
});

describe("list", () => {
  it("enumerates every brief type as KindRefs", async () => {
    briefApi.listBriefTypes.mockResolvedValue({
      totalCount: 2,
      next: null,
      data: [
        { ...liveType, name: "CreativeBrief" },
        { ...liveType, name: "CampaignBrief" },
      ],
    });

    const refs = await briefTypeKind.list?.(ctx);

    expect(refs).toEqual([
      { kind: "brief-type", id: "CreativeBrief" },
      { kind: "brief-type", id: "CampaignBrief" },
    ]);
  });
});

describe("readCurrent", () => {
  it("returns null when no brief type matches the name", async () => {
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 0, next: null, data: [] });
    expect(await briefTypeKind.readCurrent({ kind: "brief-type", id: "Nope" }, ctx)).toBeNull();
  });

  it("builds a recipe from the matched type, dropping server ids", async () => {
    briefApi.listBriefTypes.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [liveType],
    });
    const recipe = await briefTypeKind.readCurrent(ref, ctx);
    expect(recipe).toEqual({
      name: "CreativeBrief",
      label: { "en-us": "Creative Brief" },
      description: "A brief for creative work.",
      icon: "mdi-pencil",
      iconColor: "#3366FF",
      fields: [
        {
          type: "RichText",
          name: "summary",
          label: { "en-us": "Summary" },
          required: true,
          aiEditable: true,
        },
      ],
    });
    expect(recipe).not.toHaveProperty("id");
    expect(recipe).not.toHaveProperty("createdOn");
  });
});

describe("apply", () => {
  it("creates the brief type for a stage:type create change", async () => {
    briefApi.createBriefType.mockResolvedValue({ id: "type-9", name: "CreativeBrief" });
    const recipe = briefTypeKind.schema.parse({
      name: "CreativeBrief",
      label: { "en-us": "Creative Brief" },
      description: "desc",
      icon: "mdi-pencil",
      iconColor: "#000",
    });

    const result = await briefTypeKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "briefType",
            summary: 'Create brief type "CreativeBrief"',
            after: "CreativeBrief",
            meta: { stage: "type", recipe },
          },
        ],
      },
      ref,
      ctx
    );

    expect(briefApi.createBriefType).toHaveBeenCalledOnce();
    expect(briefApi.createBriefType.mock.calls[0][1]).toMatchObject({
      name: "CreativeBrief",
      description: "desc",
    });
    expect(briefApi.updateBriefType).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("PUT-replaces the brief type for a stage:type update change", async () => {
    briefApi.listBriefTypes.mockResolvedValue({
      totalCount: 1,
      next: null,
      data: [liveType],
    });
    briefApi.updateBriefType.mockResolvedValue(undefined);
    const recipe = briefTypeKind.schema.parse({
      name: "CreativeBrief",
      label: { "en-us": "Creative Brief" },
      description: "changed",
      icon: "mdi-pencil",
      iconColor: "#3366FF",
    });

    const result = await briefTypeKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "briefType",
            summary: 'Update brief type "CreativeBrief"',
            before: "CreativeBrief",
            after: "CreativeBrief",
            meta: { stage: "type", recipe },
          },
          {
            kind: "update",
            path: "briefType.description",
            summary: "description",
            meta: { stage: "field", element: "description" },
          },
          {
            kind: "noop",
            path: "briefType.icon",
            summary: "icon unchanged",
            meta: { stage: "field", element: "icon" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(briefApi.updateBriefType).toHaveBeenCalledOnce();
    expect(briefApi.updateBriefType.mock.calls[0][1]).toBe("type-1");
    expect(briefApi.updateBriefType.mock.calls[0][2]).toMatchObject({ description: "changed" });
    expect(briefApi.createBriefType).not.toHaveBeenCalled();
    // The whole-record write + the per-element update applied; the noop skipped.
    expect(result.applied).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
  });

  it("throws when an update targets a brief type that no longer exists", async () => {
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 0, next: null, data: [] });
    const recipe = briefTypeKind.schema.parse({
      name: "CreativeBrief",
      label: {},
      description: "d",
      icon: "i",
      iconColor: "c",
    });
    await expect(
      briefTypeKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "briefType",
              summary: "update",
              meta: { stage: "type", recipe },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow(/not found/);
  });

  it("skips every change for an all-noop plan", async () => {
    const result = await briefTypeKind.apply(
      {
        changes: [
          {
            kind: "noop",
            path: "briefType.description",
            summary: "description unchanged",
            meta: { stage: "field", element: "description" },
          },
        ],
      },
      ref,
      ctx
    );
    expect(briefApi.createBriefType).not.toHaveBeenCalled();
    expect(briefApi.updateBriefType).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("three-way merge — plan", () => {
  // No baseline exists yet → every cell classifies as first-push and
  // the plan emits a recipe-wins update (degenerate two-way diff). The
  // per-field change carries the per-field classification map so the
  // operator / UI can see what's first-push.
  it("first-push: classifies every cell as first-push and writes desired", async () => {
    const storage = createMemoryStorage();
    const desired = sampleRecipe({ description: "New description" });
    const live = {
      id: "type-1",
      ...sampleRecipe(),
      description: "Old description",
      createdOn: "2026-01-01T00:00:00Z",
      createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      updatedOn: "2026-01-01T00:00:00Z",
      updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
    };
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });

    const plan = await briefTypeKind.plan(desired, ref, { ...ctx, baselineStorage: storage });

    const typeChange = plan.changes.find((c) => c.meta?.stage === "type");
    expect(typeChange?.meta?.policyError).toBeUndefined();
    const descChange = plan.changes.find(
      (c) => c.path === "briefType.description" && c.meta?.stage === "field"
    );
    expect(descChange?.meta?.classification).toBe("first-push");
  });

  // Baseline matches tenant; recipe moves one scalar → recipe-change.
  // The plan writes it; apply persists a fresh baseline reflecting the
  // post-push state.
  it("recipe-change: tenant-matches-baseline, recipe moves → safe write + baseline refresh", async () => {
    const storage = createMemoryStorage();
    const baselineSnapshot = sampleRecipe();
    await storage.write("brief-type", "test", "CreativeBrief", {
      envelopeVersion: "1",
      kind: "brief-type",
      recipeHandle: "CreativeBrief",
      envName: "test",
      capturedAt: "2026-01-01T00:00:00Z",
      payload: captureBriefTypeBaselinePayload(baselineSnapshot),
    });
    const desired = sampleRecipe({ description: "Recipe-edited description" });
    const live = {
      id: "type-1",
      ...baselineSnapshot, // tenant matches baseline
      createdOn: "2026-01-01T00:00:00Z",
      createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      updatedOn: "2026-01-01T00:00:00Z",
      updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
    };
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });
    briefApi.updateBriefType.mockResolvedValue(undefined);

    const plan = await briefTypeKind.plan(desired, ref, { ...ctx, baselineStorage: storage });

    const descChange = plan.changes.find(
      (c) => c.path === "briefType.description" && c.meta?.stage === "field"
    );
    expect(descChange?.meta?.classification).toBe("recipe-change");
    expect(descChange?.kind).toBe("update");
    const typeChange = plan.changes.find((c) => c.meta?.stage === "type");
    expect(typeChange?.meta?.policyError).toBeUndefined();

    // Apply writes the type and refreshes the baseline.
    const result = await briefTypeKind.apply(plan, ref, {
      ...ctx,
      baselineStorage: storage,
    });
    expect(briefApi.updateBriefType).toHaveBeenCalledOnce();
    expect(result.applied.length).toBeGreaterThan(0);
    const refreshed = (await storage.load(
      "brief-type",
      "test",
      "CreativeBrief"
    )) as Baseline<BriefTypeBaselinePayload> | null;
    expect(refreshed?.payload.cells.description).toBe(
      captureBriefTypeBaselinePayload(desired).cells.description
    );
  });

  // Baseline matches recipe; tenant has been edited → cms-edit. Under
  // each policy:
  //   error      → policyError surfaces, apply throws POLICY_DENIED
  //   cms-wins   → tenant value preserved, no policyError
  //   recipe-wins → desired wins (clobber), no policyError
  describe("cms-edit cell on `description`", () => {
    const buildPolicyCtx = async (policy: "error" | "cms-wins" | "recipe-wins") => {
      const storage = createMemoryStorage();
      const desired = sampleRecipe();
      // Baseline matches what the recipe says — recipe hasn't moved.
      await storage.write("brief-type", "test", "CreativeBrief", {
        envelopeVersion: "1",
        kind: "brief-type",
        recipeHandle: "CreativeBrief",
        envName: "test",
        capturedAt: "2026-01-01T00:00:00Z",
        payload: captureBriefTypeBaselinePayload(desired),
      });
      const live = {
        id: "type-1",
        ...desired,
        description: "Tenant-edited description",
        createdOn: "2026-01-01T00:00:00Z",
        createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
        updatedOn: "2026-01-01T00:00:00Z",
        updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      };
      briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });
      return {
        storage,
        desired,
        syncCtx: { ...ctx, baselineStorage: storage, pushConflictPolicy: policy },
      };
    };

    it("error policy: plan surfaces policyError; apply throws POLICY_DENIED", async () => {
      const { desired, syncCtx } = await buildPolicyCtx("error");
      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      const carrier = plan.changes.find((c) => c.meta?.policyError === true);
      expect(carrier).toBeDefined();
      const errors = carrier?.meta?.policyErrors as
        Array<{ path: string; classification: string }> | undefined;
      expect(errors?.[0]?.path).toBe("description");
      expect(errors?.[0]?.classification).toBe("cms-edit");

      await expect(briefTypeKind.apply(plan, ref, syncCtx)).rejects.toThrow(
        /unresolved three-way merge conflict/
      );
      expect(briefApi.updateBriefType).not.toHaveBeenCalled();
    });

    it("cms-wins policy: merged recipe carries tenant value, baseline refreshed to merged state", async () => {
      const { storage, desired, syncCtx } = await buildPolicyCtx("cms-wins");
      briefApi.updateBriefType.mockResolvedValue(undefined);

      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      // No policyError under cms-wins — the cms-edit is silently
      // resolved to the tenant value.
      expect(plan.changes.some((c) => c.meta?.policyError === true)).toBe(false);

      // Apply landed the cms-wins-merged recipe; the typeChange carries
      // the merged recipe, whose description matches the tenant value.
      await briefTypeKind.apply(plan, ref, syncCtx);
      const refreshed = (await storage.load(
        "brief-type",
        "test",
        "CreativeBrief"
      )) as Baseline<BriefTypeBaselinePayload> | null;
      expect(refreshed?.payload.cells.description).toBe(
        captureBriefTypeBaselinePayload(sampleRecipe({ description: "Tenant-edited description" }))
          .cells.description
      );
    });

    it("recipe-wins policy: desired clobbers tenant; baseline refreshed to desired", async () => {
      const { storage, desired, syncCtx } = await buildPolicyCtx("recipe-wins");
      briefApi.updateBriefType.mockResolvedValue(undefined);

      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      expect(plan.changes.some((c) => c.meta?.policyError === true)).toBe(false);

      await briefTypeKind.apply(plan, ref, syncCtx);
      // recipe-wins → the baseline matches `desired` (which equals the
      // pre-edit baseline content). The PUT was called.
      expect(briefApi.updateBriefType).toHaveBeenCalledOnce();
      const refreshed = (await storage.load(
        "brief-type",
        "test",
        "CreativeBrief"
      )) as Baseline<BriefTypeBaselinePayload> | null;
      expect(refreshed?.payload.cells.description).toBe(
        captureBriefTypeBaselinePayload(desired).cells.description
      );
    });
  });

  // Both sides moved off the baseline on the same cell → conflict.
  // Policy enforcement parallels cms-edit.
  describe("conflict cell (both sides moved)", () => {
    const buildConflictCtx = async (policy: "error" | "cms-wins" | "recipe-wins") => {
      const storage = createMemoryStorage();
      const baselineSnapshot = sampleRecipe();
      await storage.write("brief-type", "test", "CreativeBrief", {
        envelopeVersion: "1",
        kind: "brief-type",
        recipeHandle: "CreativeBrief",
        envName: "test",
        capturedAt: "2026-01-01T00:00:00Z",
        payload: captureBriefTypeBaselinePayload(baselineSnapshot),
      });
      const desired = sampleRecipe({ description: "Recipe-edited description" });
      const live = {
        id: "type-1",
        ...baselineSnapshot,
        description: "Tenant-edited description",
        createdOn: "2026-01-01T00:00:00Z",
        createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
        updatedOn: "2026-01-01T00:00:00Z",
        updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      };
      briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });
      return {
        storage,
        desired,
        syncCtx: { ...ctx, baselineStorage: storage, pushConflictPolicy: policy },
      };
    };

    it("error policy: summary surfaces conflict classification; apply refuses", async () => {
      const { desired, syncCtx } = await buildConflictCtx("error");
      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      const carrier = plan.changes.find((c) => c.meta?.policyError === true);
      const errors = carrier?.meta?.policyErrors as
        Array<{ path: string; classification: string }> | undefined;
      expect(errors?.[0]?.classification).toBe("conflict");
      await expect(briefTypeKind.apply(plan, ref, syncCtx)).rejects.toThrow(
        /unresolved three-way merge conflict/
      );
    });

    it("recipe-wins: conflict downgrades to recipe write", async () => {
      const { desired, syncCtx } = await buildConflictCtx("recipe-wins");
      briefApi.updateBriefType.mockResolvedValue(undefined);
      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      expect(plan.changes.some((c) => c.meta?.policyError === true)).toBe(false);
      await briefTypeKind.apply(plan, ref, syncCtx);
      expect(briefApi.updateBriefType).toHaveBeenCalledOnce();
      // The recipe value got written; verify via the typeChange recipe.
      const typeChange = plan.changes.find((c) => c.meta?.stage === "type");
      const wrote = typeChange?.meta?.recipe as ReturnType<typeof sampleRecipe>;
      expect(wrote.description).toBe(desired.description);
    });

    it("cms-wins: conflict downgrades to tenant skip (merged recipe takes tenant value)", async () => {
      const { desired, syncCtx } = await buildConflictCtx("cms-wins");
      briefApi.updateBriefType.mockResolvedValue(undefined);
      const plan = await briefTypeKind.plan(desired, ref, syncCtx);
      expect(plan.changes.some((c) => c.meta?.policyError === true)).toBe(false);
      // The merged recipe equals tenant — no scalar changed against
      // current state — so the diff produces no writing changes. The
      // plan is all-noop and apply is a no-op too.
      expect(plan.changes.every((c) => c.kind === "noop")).toBe(true);
      const result = await briefTypeKind.apply(plan, ref, syncCtx);
      expect(briefApi.updateBriefType).not.toHaveBeenCalled();
      expect(result.applied).toHaveLength(0);
    });
  });

  // Field add / remove: each field is its own cell keyed by codename.
  // An added field is first-push for that cell; a removed field is
  // recipe-change (recipe author dropped it, tenant unchanged).
  describe("field add / remove", () => {
    it("adding a recipe field classifies the new cell as first-push", async () => {
      const storage = createMemoryStorage();
      const baselineSnapshot = sampleRecipe();
      await storage.write("brief-type", "test", "CreativeBrief", {
        envelopeVersion: "1",
        kind: "brief-type",
        recipeHandle: "CreativeBrief",
        envName: "test",
        capturedAt: "2026-01-01T00:00:00Z",
        payload: captureBriefTypeBaselinePayload(baselineSnapshot),
      });
      const desired = sampleRecipe({
        fields: [
          ...baselineSnapshot.fields,
          {
            type: "RichText",
            name: "audience",
            label: { "en-us": "Audience" },
            required: false,
            aiEditable: true,
          },
        ],
      });
      const live = {
        id: "type-1",
        ...baselineSnapshot,
        createdOn: "2026-01-01T00:00:00Z",
        createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
        updatedOn: "2026-01-01T00:00:00Z",
        updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      };
      briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });

      const plan = await briefTypeKind.plan(desired, ref, { ...ctx, baselineStorage: storage });
      const fieldsChange = plan.changes.find(
        (c) => c.path === "briefType.fields" && c.meta?.stage === "field"
      );
      const perField = fieldsChange?.meta?.perFieldClassification as
        Record<string, string> | undefined;
      expect(perField?.audience).toBe("first-push");
      expect(perField?.summary).toBe("recipe-change");
    });

    it("removing a recipe field classifies the dropped cell as recipe-change", async () => {
      const storage = createMemoryStorage();
      const baselineSnapshot = sampleRecipe({
        fields: [
          {
            type: "RichText",
            name: "summary",
            label: { "en-us": "Summary" },
            required: true,
            aiEditable: true,
          },
          {
            type: "DateTime",
            name: "dueDate",
            label: { "en-us": "Due Date" },
            required: false,
            aiEditable: false,
          },
        ],
      });
      await storage.write("brief-type", "test", "CreativeBrief", {
        envelopeVersion: "1",
        kind: "brief-type",
        recipeHandle: "CreativeBrief",
        envName: "test",
        capturedAt: "2026-01-01T00:00:00Z",
        payload: captureBriefTypeBaselinePayload(baselineSnapshot),
      });
      const desired = sampleRecipe({ fields: [baselineSnapshot.fields[0]] });
      const live = {
        id: "type-1",
        ...baselineSnapshot,
        createdOn: "2026-01-01T00:00:00Z",
        createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
        updatedOn: "2026-01-01T00:00:00Z",
        updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      };
      briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });

      const plan = await briefTypeKind.plan(desired, ref, { ...ctx, baselineStorage: storage });
      const fieldsChange = plan.changes.find(
        (c) => c.path === "briefType.fields" && c.meta?.stage === "field"
      );
      const perField = fieldsChange?.meta?.perFieldClassification as
        Record<string, string> | undefined;
      expect(perField?.dueDate).toBe("recipe-change");
    });
  });

  // Without ctx.baselineStorage the kind degrades to the original
  // two-way diff and never writes a baseline.
  it("no baseline storage: degrades to two-way diff; no baseline written on apply", async () => {
    const desired = sampleRecipe({ description: "Changed" });
    const live = {
      id: "type-1",
      ...sampleRecipe(),
      description: "Old",
      createdOn: "2026-01-01T00:00:00Z",
      createdBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
      updatedOn: "2026-01-01T00:00:00Z",
      updatedBy: { type: "ExternalLink", relatedSystem: "co", relatedType: null, id: "x" },
    };
    briefApi.listBriefTypes.mockResolvedValue({ totalCount: 1, next: null, data: [live] });
    briefApi.updateBriefType.mockResolvedValue(undefined);

    const plan = await briefTypeKind.plan(desired, ref, ctx);
    // Per-field changes still annotate classification (first-push) but
    // there's no baseline writing on apply.
    const result = await briefTypeKind.apply(plan, ref, ctx);
    expect(briefApi.updateBriefType).toHaveBeenCalledOnce();
    expect(result.applied.length).toBeGreaterThan(0);
  });
});

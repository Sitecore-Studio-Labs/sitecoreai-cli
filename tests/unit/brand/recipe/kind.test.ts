import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → client bridge so the kind never reads real config.
vi.mock("../../../../src/brand/recipe/client", () => ({
  resolveBrandClient: () => ({ orgId: "org", credential: {} }),
}));

// Mock the Brand Management API surface the kind composes.
const brandApi = vi.hoisted(() => ({
  listBrandKits: vi.fn(),
  listBrandKitSections: vi.fn(),
  listBrandKitFields: vi.fn(),
  updateBrandKitField: vi.fn(),
  seedBrandKit: vi.fn(),
  createBrandKit: vi.fn(),
}));
vi.mock("../../../../src/brand", () => brandApi);

import { brandKitKind } from "../../../../src/brand/recipe/kind";

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "brand-kit", id: "Acme" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brandKitKind", () => {
  it("exposes the recipe-kind contract", () => {
    expect(brandKitKind.name).toBe("brand-kit");
    expect(brandKitKind.schema).toBeDefined();
    expect(typeof brandKitKind.readCurrent).toBe("function");
    expect(typeof brandKitKind.apply).toBe("function");
    expect(typeof brandKitKind.list).toBe("function");
  });
});

describe("list", () => {
  it("enumerates every brand kit as KindRefs, paging the list endpoint", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({
        totalCount: 3,
        pageSize: 2,
        data: [
          { id: "k1", name: "Acme" },
          { id: "k2", name: "Globex" },
        ],
      })
      .mockResolvedValueOnce({
        totalCount: 3,
        pageSize: 2,
        data: [{ id: "k3", name: "Initech" }],
      });

    const refs = await brandKitKind.list?.(ctx);

    expect(refs).toEqual([
      { kind: "brand-kit", id: "Acme" },
      { kind: "brand-kit", id: "Globex" },
      { kind: "brand-kit", id: "Initech" },
    ]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
  });

  it("pages the list endpoint when a page omits pageSize", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({ totalCount: 2, data: [{ id: "k1", name: "Acme" }] })
      .mockResolvedValueOnce({ totalCount: 2, data: [{ id: "k2", name: "Globex" }] });

    const refs = await brandKitKind.list?.(ctx);
    expect(refs).toEqual([
      { kind: "brand-kit", id: "Acme" },
      { kind: "brand-kit", id: "Globex" },
    ]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
  });

  it("stops paging when a page returns no data", async () => {
    brandApi.listBrandKits.mockResolvedValueOnce({ totalCount: 0, pageSize: 50, data: [] });
    expect(await brandKitKind.list?.(ctx)).toEqual([]);
    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(1);
  });
});

describe("readCurrent", () => {
  it("returns null when no kit matches the name", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });
    expect(await brandKitKind.readCurrent({ kind: "brand-kit", id: "Nope" }, ctx)).toBeNull();
  });

  it("builds a recipe from kit + sections + fields, dropping server ids", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme", industry: "retail" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Voice", type: "text", value: "Confident" },
      { id: "fld-2", name: "Personality", type: "array", value: [{ id: "e1", name: "Bold" }] },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe).toMatchObject({
      name: "Acme",
      industry: "retail",
      sections: { "Tone of Voice": { Voice: "Confident", Personality: ["Bold"] } },
    });
  });
});

describe("apply", () => {
  it("updates a field on an existing kit", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Tone of Voice" }]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-1", name: "Voice", type: "text" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.Tone of Voice.Voice",
            summary: "Voice",
            after: "New voice",
            meta: { stage: "field", section: "Tone of Voice", field: "Voice" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "sec-1", fieldId: "fld-1", value: "New voice" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("skips a field change that does not resolve to a kit field", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "sections.X.Y",
            summary: "Y",
            after: "v",
            meta: { stage: "field", section: "X", field: "Y" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
  });

  it("seeds the kit with every document when the plan creates a kit", async () => {
    brandApi.seedBrandKit.mockResolvedValue({ kit: { id: "kit-9", name: "New" } });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: 'Create brand kit "New"',
            after: "New",
            meta: { stage: "kit" },
          },
          {
            kind: "create",
            path: "documents[0]",
            summary: "ingest a",
            after: "https://x.test/a.pdf",
            meta: { stage: "document", document: { url: "https://x.test/a.pdf" } },
          },
          {
            kind: "create",
            path: "documents[1]",
            summary: "ingest b",
            after: "https://x.test/b.pdf",
            meta: { stage: "document", document: { url: "https://x.test/b.pdf" } },
          },
        ],
      },
      { kind: "brand-kit", id: "New" },
      ctx
    );

    expect(brandApi.seedBrandKit).toHaveBeenCalledOnce();
    // Gap-2 fix: all documents in the plan reach seedBrandKit, not just the first.
    const seedArgs = brandApi.seedBrandKit.mock.calls[0][0] as { documents: unknown[] };
    expect(seedArgs.documents).toHaveLength(2);
    expect(result.applied).toHaveLength(3);
  });

  it("forwards the seed onProgress callback to the logger", async () => {
    brandApi.seedBrandKit.mockImplementation(
      async (args: {
        onProgress?: (e: { elapsedSec: number; stage: string; message: string }) => void;
      }) => {
        args.onProgress?.({ elapsedSec: 3, stage: "ingest", message: "running" });
        return { kit: { id: "kit-9", name: "New" } };
      }
    );
    brandApi.listBrandKitSections.mockResolvedValue([]);
    const info = vi.fn();
    const progressCtx: SyncContext = {
      environmentName: "test",
      logger: { info } as unknown as Logger,
    };

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: "create",
            after: "New",
            meta: { stage: "kit", description: "desc", industry: "tech" },
          },
          {
            kind: "create",
            path: "documents[0]",
            summary: "doc",
            after: "https://x.test/a.pdf",
            meta: { stage: "document", document: { url: "https://x.test/a.pdf" } },
          },
        ],
      },
      { kind: "brand-kit", id: "New" },
      progressCtx
    );

    const seedArgs = brandApi.seedBrandKit.mock.calls[0][0] as {
      description?: string;
      industry?: string;
    };
    expect(seedArgs.description).toBe("desc");
    expect(seedArgs.industry).toBe("tech");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[+3s] ingest: running"));
  });

  it("creates a bare kit (no seed) when the plan has a kit change but no documents", async () => {
    brandApi.createBrandKit.mockResolvedValue({ id: "kit-bare", name: "Bare" });
    brandApi.listBrandKitSections.mockResolvedValue([]);

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "kit",
            summary: "create",
            after: "Bare",
            meta: { stage: "kit", description: "d", industry: "i" },
          },
        ],
      },
      { kind: "brand-kit", id: "Bare" },
      ctx
    );

    expect(brandApi.createBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Bare", description: "d", industry: "i" })
    );
    expect(brandApi.seedBrandKit).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(1);
  });

  it("throws INPUT_INVALID when no kit change exists and the kit is not found", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });

    await expect(
      brandKitKind.apply(
        {
          changes: [
            {
              kind: "update",
              path: "sections.A.B",
              summary: "B",
              after: "v",
              meta: { stage: "field", section: "A", field: "B" },
            },
          ],
        },
        { kind: "brand-kit", id: "Ghost" },
        ctx
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("pages findKitByName to locate a kit on a later page", async () => {
    brandApi.listBrandKits
      .mockResolvedValueOnce({ totalCount: 3, pageSize: 2, data: [{ id: "k1", name: "Globex" }] })
      .mockResolvedValueOnce({ totalCount: 3, pageSize: 2, data: [{ id: "k2", name: "Acme" }] });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([{ id: "fld-1", name: "F", type: "text" }]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.F",
            summary: "F",
            after: "v",
            meta: { stage: "field", section: "S", field: "F" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.listBrandKits).toHaveBeenCalledTimes(2);
    expect(result.applied).toHaveLength(1);
  });

  it("passes richArray entry objects through toApiValue unchanged", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Claims", type: "richArray" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.Claims",
            summary: "Claims",
            after: [{ name: "Fast", tags: ["Marketing"] }],
            meta: { stage: "field", section: "S", field: "Claims" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ value: [{ name: "Fast", tags: ["Marketing"] }] })
    );
  });

  it("converts a string-array field value into { name } API entries", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "fld-1", name: "Pillars", type: "array" },
    ]);
    brandApi.updateBrandKitField.mockResolvedValue({});

    await brandKitKind.apply(
      {
        changes: [
          {
            kind: "update",
            path: "sections.S.Pillars",
            summary: "Pillars",
            after: ["Trust", "Speed"],
            meta: { stage: "field", section: "S", field: "Pillars" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).toHaveBeenCalledWith(
      expect.objectContaining({ value: [{ name: "Trust" }, { name: "Speed" }] })
    );
  });

  it("records noop field changes as skipped", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });

    const result = await brandKitKind.apply(
      {
        changes: [
          {
            kind: "noop",
            path: "sections.A.B",
            summary: "B",
            after: "v",
            meta: { stage: "field", section: "A", field: "B" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(brandApi.updateBrandKitField).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
  });
});

describe("plan", () => {
  it("diffs the desired recipe against the live kit", async () => {
    brandApi.listBrandKits.mockResolvedValue({ totalCount: 0, data: [] });

    const recipePlan = await brandKitKind.plan(
      { name: "Acme", documents: [{ url: "https://x.test/a.pdf" }], sections: {} },
      ref,
      ctx
    );

    // Kit absent → the plan stages a kit-create change.
    expect(recipePlan.changes.some((c) => c.meta?.stage === "kit")).toBe(true);
  });
});

describe("readCurrent — value projection", () => {
  it("keeps a description and projects richArray entries with tags", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme", description: "A kit" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Messaging" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      {
        id: "fld-1",
        name: "Claims",
        type: "richArray",
        value: [{ id: "e1", name: "Fast", tags: ["Marketing"], restrictions: "no scarcity" }],
      },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe?.description).toBe("A kit");
    expect(recipe?.sections.Messaging.Claims).toEqual([
      { name: "Fast", tags: ["Marketing"], restrictions: "no scarcity" },
    ]);
  });

  it("projects a richArray entry missing tags/restrictions with undefined slots", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "Messaging" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      {
        id: "fld-1",
        name: "Claims",
        type: "richArray",
        value: [
          { id: "e1", name: "Tagged", tags: ["Marketing"] },
          { id: "e2", name: "Plain" },
        ],
      },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    expect(recipe?.sections.Messaging.Claims).toEqual([
      { name: "Tagged", tags: ["Marketing"], restrictions: undefined },
      { name: "Plain", tags: undefined, restrictions: undefined },
    ]);
  });

  it("drops empty-string and empty-array field values", async () => {
    brandApi.listBrandKits.mockResolvedValue({
      totalCount: 1,
      data: [{ id: "kit-1", name: "Acme" }],
    });
    brandApi.listBrandKitSections.mockResolvedValue([{ id: "sec-1", name: "S" }]);
    brandApi.listBrandKitFields.mockResolvedValue([
      { id: "f1", name: "Empty", type: "text", value: "" },
      { id: "f2", name: "EmptyArr", type: "array", value: [] },
    ]);

    const recipe = await brandKitKind.readCurrent(ref, ctx);
    // No fields survive → the section is not added at all.
    expect(recipe?.sections).toEqual({});
  });
});

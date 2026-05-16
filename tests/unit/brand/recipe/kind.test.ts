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
});

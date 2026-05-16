import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

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
vi.mock("../../../../src/brief", () => briefApi);

import { briefTypeKind } from "../../../../src/brief/recipe/kind";

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "brief-type", id: "CreativeBrief" } as const;

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

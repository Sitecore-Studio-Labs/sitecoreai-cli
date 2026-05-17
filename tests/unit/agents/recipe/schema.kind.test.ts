import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `schema.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the schemas API surface the kind composes.
const schemasApi = vi.hoisted(() => ({
  createSchema: vi.fn(),
  listSchemas: vi.fn(),
}));
vi.mock("../../../../src/agents/api/schemas", () => schemasApi);

import { schemaKind } from "../../../../src/agents/recipe/schema.kind";
import { SchemaRecipeSchema } from "../../../../src/agents/recipe/schema.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "schema", id: "ReportShape" } as const;

const recipe = (input: unknown) => SchemaRecipeSchema.parse(input);

const makeSchema = (overrides: Record<string, unknown> = {}) => ({
  id: "schema-id-1",
  name: "ReportShape",
  description: "Output shape for reports",
  fields: { schema: { type: "object" }, strict: true },
  tags: ["docs"],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
});

describe("schemaKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(schemaKind.name).toBe("schema");
    expect(schemaKind.schema).toBe(SchemaRecipeSchema);
    expect(typeof schemaKind.readCurrent).toBe("function");
    expect(typeof schemaKind.plan).toBe("function");
    expect(typeof schemaKind.apply).toBe("function");
  });
});

describe("schemaKind.readCurrent", () => {
  it("returns null when no schema matches the ref name", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema({ name: "Other" })]);

    expect(await schemaKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live schema into the recipe shape, unwrapping fields.schema", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema()]);

    const result = await schemaKind.readCurrent(ref, ctx);

    expect(result).toEqual({
      name: "ReportShape",
      description: "Output shape for reports",
      schema: { type: "object" },
      strict: true,
      tags: ["docs"],
    });
  });

  it("defaults schema to an empty object when fields is absent", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema({ fields: undefined })]);

    const result = await schemaKind.readCurrent(ref, ctx);

    expect(result?.schema).toEqual({});
  });

  it("defaults schema to an empty object when fields lacks a schema key", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema({ fields: { strict: false } })]);

    const result = await schemaKind.readCurrent(ref, ctx);

    expect(result?.schema).toEqual({});
    expect(result?.strict).toBe(false);
  });

  it("defaults strict to true when fields omits it", async () => {
    schemasApi.listSchemas.mockResolvedValue([
      makeSchema({ fields: { schema: { type: "object" } } }),
    ]);

    const result = await schemaKind.readCurrent(ref, ctx);

    expect(result?.strict).toBe(true);
  });

  it("defaults tags to an empty array when the live schema omits them", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema({ tags: undefined })]);

    const result = await schemaKind.readCurrent(ref, ctx);

    expect(result?.tags).toEqual([]);
  });
});

describe("schemaKind.plan", () => {
  it("plans a create when the schema does not exist remotely", async () => {
    schemasApi.listSchemas.mockResolvedValue([]);

    const plan = await schemaKind.plan(
      recipe({ name: "ReportShape", schema: { type: "object" } }),
      ref,
      ctx
    );

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "schema.ReportShape" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "ReportShape" });
  });

  it("plans a noop when the schema already exists — create-only kind", async () => {
    schemasApi.listSchemas.mockResolvedValue([makeSchema()]);

    const plan = await schemaKind.plan(
      recipe({ name: "ReportShape", schema: { type: "string" } }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("noop");
  });
});

describe("schemaKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await schemaKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(schemasApi.createSchema).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await schemaKind.apply(
      { changes: [{ kind: "noop", path: "schema.ReportShape", summary: "exists" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(schemasApi.createSchema).not.toHaveBeenCalled();
  });
});

describe("schemaKind.apply — create", () => {
  it("creates the schema from the change's meta.recipe", async () => {
    schemasApi.createSchema.mockResolvedValue(makeSchema());

    const result = await schemaKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "schema.ReportShape",
            summary: "create schema",
            meta: { recipe: recipe({ name: "ReportShape", schema: { type: "object" } }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(schemasApi.createSchema).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "ReportShape", schema: { type: "object" } })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    schemasApi.createSchema.mockResolvedValue(makeSchema());

    await schemaKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "schema.ReportShape",
            summary: "create schema",
            after: { name: "ReportShape", schema: { from: "after" } },
          },
        ],
      },
      ref,
      ctx
    );

    expect(schemasApi.createSchema).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ schema: { from: "after" }, strict: true })
    );
  });

  it("throws when change.after is invalid (missing schema) and no meta.recipe is present", async () => {
    await expect(
      schemaKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "schema.ReportShape",
              summary: "create schema",
              after: { name: "ReportShape" },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow();
    expect(schemasApi.createSchema).not.toHaveBeenCalled();
  });
});

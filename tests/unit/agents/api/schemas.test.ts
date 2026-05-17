/**
 * `src/agents/api/schemas.ts` — structured-output schema CRUD.
 *
 * `listSchemas` / `getSchema` / `deleteSchema` ride `agentsRequest`;
 * `createSchema` / `updateSchema` replay the `/schemas/create` server action
 * via `agentsServerAction`. Both transports are mocked here so the request
 * shape (path, method, body, server-action args / hash / router tree) and
 * response handling — including the snake_case function-name derivation, the
 * `strict ?? true` default, and the `RSC_UNDEFINED` optional substitution —
 * can be asserted in isolation.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsSession } from "../../../../src/agents/session/types";
import type { StructuredSchema } from "../../../../src/agents/api/schema";

vi.mock("../../../../src/agents/api/request", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/agents/api/request")>(
    "../../../../src/agents/api/request"
  );
  return {
    agentsRequest: vi.fn(),
    agentsServerAction: vi.fn(),
    RSC_UNDEFINED: actual.RSC_UNDEFINED,
  };
});

let schemas: typeof import("../../../../src/agents/api/schemas");
let request: typeof import("../../../../src/agents/api/request");

const session: AgentsSession = {
  baseUrl: "https://agentic-studio-euw.sitecorecloud.io",
  authHeaders: () => ({ Cookie: "x=1" }),
};

const schemaFixture = (over: Partial<StructuredSchema> = {}): StructuredSchema =>
  ({ id: "sc-1", schemaId: "sc-1", name: "Lead", ...over }) as StructuredSchema;

const jsonSchema: Record<string, unknown> = {
  type: "object",
  properties: { email: { type: "string" } },
};

beforeAll(async () => {
  schemas = await import("../../../../src/agents/api/schemas");
  request = await import("../../../../src/agents/api/request");
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SITECOREAI_SCHEMA_ACTION;
});

describe("listSchemas", () => {
  it("returns the array when the API responds with a schema list", async () => {
    const list = [schemaFixture({ id: "sc-1" }), schemaFixture({ id: "sc-2", name: "Order" })];
    vi.mocked(request.agentsRequest).mockResolvedValue(list as never);

    const result = await schemas.listSchemas(session);

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/schemas");
    expect(result).toEqual(list);
  });

  it("coerces a non-array response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue({ unexpected: true } as never);
    expect(await schemas.listSchemas(session)).toEqual([]);
  });

  it("coerces a null response to an empty list", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(null as never);
    expect(await schemas.listSchemas(session)).toEqual([]);
  });
});

describe("getSchema", () => {
  it("finds a schema by id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      schemaFixture({ id: "sc-1", schemaId: "x", name: "Lead" }),
      schemaFixture({ id: "sc-2", schemaId: "y", name: "Order" }),
    ] as never);

    const found = await schemas.getSchema(session, "sc-2");
    expect(found?.id).toBe("sc-2");
  });

  it("finds a schema by schemaId when no id matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      schemaFixture({ id: "sc-1", schemaId: "lead-schema", name: "Lead" }),
    ] as never);

    const found = await schemas.getSchema(session, "lead-schema");
    expect(found?.id).toBe("sc-1");
  });

  it("finds a schema by name when neither id nor schemaId matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      schemaFixture({ id: "sc-1", schemaId: "x", name: "Lead" }),
    ] as never);

    const found = await schemas.getSchema(session, "Lead");
    expect(found?.id).toBe("sc-1");
  });

  it("returns undefined when nothing matches", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([
      schemaFixture({ id: "sc-1", schemaId: "x", name: "Lead" }),
    ] as never);

    expect(await schemas.getSchema(session, "missing")).toBeUndefined();
  });

  it("returns undefined when the schema list is empty", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue([] as never);
    expect(await schemas.getSchema(session, "sc-1")).toBeUndefined();
  });
});

describe("createSchema", () => {
  it("replays the /schemas/create server action with the full arg tuple", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, {
      name: "Sales Lead",
      description: "A lead",
      schema: jsonSchema,
      strict: true,
      tags: ["crm"],
    });

    expect(request.agentsServerAction).toHaveBeenCalledTimes(1);
    const [, path, payload] = vi.mocked(request.agentsServerAction).mock.calls[0];
    expect(path).toBe("/schemas/create");
    expect(payload.routerStateTree).toContain('"schemas"');
    expect(payload.args).toEqual([
      null,
      {
        schemaId: "Sales Lead",
        name: "Sales Lead",
        description: "A lead",
        fields: {
          name: "sales_lead",
          strict: true,
          schema: jsonSchema,
        },
        tags: ["crm"],
      },
    ]);
  });

  it("derives a snake_case function name and collapses non-alphanumerics", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, { name: "  Q3 — Report!! ", schema: jsonSchema });

    const args = vi.mocked(request.agentsServerAction).mock.calls[0][2].args as [
      unknown,
      { fields: { name: string } },
    ];
    expect(args[1].fields.name).toBe("q3_report");
  });

  it("falls back to the function name 'schema' when the name has no alphanumerics", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, { name: "!!!", schema: jsonSchema });

    const args = vi.mocked(request.agentsServerAction).mock.calls[0][2].args as [
      unknown,
      { fields: { name: string } },
    ];
    expect(args[1].fields.name).toBe("schema");
  });

  it("defaults strict to true and substitutes RSC_UNDEFINED for absent optionals", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, { name: "Lead", schema: jsonSchema });

    const payload = vi.mocked(request.agentsServerAction).mock.calls[0][2];
    const body = (payload.args as [unknown, Record<string, unknown>])[1];
    expect(body.description).toBe(request.RSC_UNDEFINED);
    expect(body.tags).toBe(request.RSC_UNDEFINED);
    expect((body.fields as { strict: unknown }).strict).toBe(true);
  });

  it("honors strict=false rather than overriding it with the default", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, { name: "Lead", schema: jsonSchema, strict: false });

    const args = vi.mocked(request.agentsServerAction).mock.calls[0][2].args as [
      unknown,
      { fields: { strict: boolean } },
    ];
    expect(args[1].fields.strict).toBe(false);
  });

  it("uses the session's discovered action hash when present", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(
      { ...session, actionHashes: { "/schemas/create": "session-hash" } },
      { name: "Lead", schema: jsonSchema }
    );

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash).toBe("session-hash");
  });

  it("falls back to SITECOREAI_SCHEMA_ACTION when no session hash exists", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);
    process.env.SITECOREAI_SCHEMA_ACTION = "env-hash";

    await schemas.createSchema(session, { name: "Lead", schema: jsonSchema });

    expect(vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash).toBe("env-hash");
  });

  it("falls back to the bundled constant hash when neither session nor env is set", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.createSchema(session, { name: "Lead", schema: jsonSchema });

    const hash = vi.mocked(request.agentsServerAction).mock.calls[0][2].actionHash;
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe("updateSchema", () => {
  it("re-runs the /schemas/create action (upsert-by-name) ignoring input.id", async () => {
    vi.mocked(request.agentsServerAction).mockResolvedValue(undefined as never);

    await schemas.updateSchema(session, {
      id: "ignored-id",
      name: "Lead",
      schema: jsonSchema,
    });

    const [, path, payload] = vi.mocked(request.agentsServerAction).mock.calls[0];
    expect(path).toBe("/schemas/create");
    const body = (payload.args as [unknown, Record<string, unknown>])[1];
    expect(body.schemaId).toBe("Lead");
    expect(JSON.stringify(payload.args)).not.toContain("ignored-id");
  });
});

describe("deleteSchema", () => {
  it("DELETEs the id-scoped path via agentsRequest", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await schemas.deleteSchema(session, "sc-1");

    expect(request.agentsRequest).toHaveBeenCalledWith(session, "/api/schemas/sc-1", {
      method: "DELETE",
    });
  });

  it("url-encodes the schema id", async () => {
    vi.mocked(request.agentsRequest).mockResolvedValue(undefined as never);

    await schemas.deleteSchema(session, "sc/1 a");

    expect(vi.mocked(request.agentsRequest).mock.calls[0][1]).toBe("/api/schemas/sc%2F1%20a");
  });
});

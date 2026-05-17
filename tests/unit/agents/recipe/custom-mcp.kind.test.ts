import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncContext } from "../../../../src/sync";
import type { Logger } from "../../../../src/shared/logger";

// Stub the env → session bridge so the kind never reads real config or
// touches the keychain. `custom-mcp.kind.ts` imports `resolveAgentsSession`
// from `./client` — i.e. src/agents/recipe/client.ts.
const resolveAgentsSession = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/agents/recipe/client", () => ({ resolveAgentsSession }));

// Mock the custom-MCP API surface the kind composes.
const customMcpsApi = vi.hoisted(() => ({
  createCustomMcp: vi.fn(),
  listCustomMcps: vi.fn(),
}));
vi.mock("../../../../src/agents/api/custom-mcps", () => customMcpsApi);

import { customMcpKind } from "../../../../src/agents/recipe/custom-mcp.kind";
import { CustomMcpRecipeSchema } from "../../../../src/agents/recipe/custom-mcp.schema";

const SESSION = { baseUrl: "https://agentic-studio-euw.sitecorecloud.io" } as never;

const ctx: SyncContext = {
  environmentName: "test",
  logger: { info: vi.fn() } as unknown as Logger,
};
const ref = { kind: "custom-mcp", id: "local" } as const;

const recipe = (input: unknown) => CustomMcpRecipeSchema.parse(input);

const makeMcp = (overrides: Record<string, unknown> = {}) => ({
  id: "mcp-id-1",
  name: "local",
  url: "https://example.test/mcp",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveAgentsSession.mockResolvedValue(SESSION);
});

describe("customMcpKind — recipe-kind contract", () => {
  it("exposes the name, schema, and the three operations", () => {
    expect(customMcpKind.name).toBe("custom-mcp");
    expect(customMcpKind.schema).toBe(CustomMcpRecipeSchema);
    expect(typeof customMcpKind.readCurrent).toBe("function");
    expect(typeof customMcpKind.plan).toBe("function");
    expect(typeof customMcpKind.apply).toBe("function");
  });
});

describe("customMcpKind.readCurrent", () => {
  it("returns null when no MCP matches the ref name", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([makeMcp({ name: "other" })]);

    expect(await customMcpKind.readCurrent(ref, ctx)).toBeNull();
  });

  it("projects a live MCP into the recipe shape", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([makeMcp()]);

    const result = await customMcpKind.readCurrent(ref, ctx);

    expect(result).toEqual({ name: "local", url: "https://example.test/mcp" });
  });

  it("matches the MCP by exact name only — not by id", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([makeMcp({ name: "local" })]);

    const result = await customMcpKind.readCurrent({ kind: "custom-mcp", id: "mcp-id-1" }, ctx);

    expect(result).toBeNull();
  });

  it("throws when a live MCP has an invalid (non-URL) endpoint", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([makeMcp({ url: "not-a-url" })]);

    await expect(customMcpKind.readCurrent(ref, ctx)).rejects.toThrow();
  });
});

describe("customMcpKind.plan", () => {
  it("plans a create when the MCP does not exist remotely", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([]);

    const plan = await customMcpKind.plan(
      recipe({ name: "local", url: "https://x.test" }),
      ref,
      ctx
    );

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ kind: "create", path: "custom-mcp.local" });
    expect(plan.changes[0].meta?.recipe).toMatchObject({ name: "local" });
  });

  it("plans a noop when the MCP already exists — create-only kind", async () => {
    customMcpsApi.listCustomMcps.mockResolvedValue([makeMcp()]);

    const plan = await customMcpKind.plan(
      recipe({ name: "local", url: "https://changed.test/mcp" }),
      ref,
      ctx
    );

    expect(plan.changes[0].kind).toBe("noop");
  });
});

describe("customMcpKind.apply — noop / empty plan", () => {
  it("returns nothing applied and nothing skipped for an empty plan", async () => {
    const result = await customMcpKind.apply({ changes: [] }, ref, ctx);

    expect(result).toEqual({ applied: [], skipped: [] });
    expect(customMcpsApi.createCustomMcp).not.toHaveBeenCalled();
  });

  it("skips a noop change without touching the API", async () => {
    const result = await customMcpKind.apply(
      { changes: [{ kind: "noop", path: "custom-mcp.local", summary: "exists" }] },
      ref,
      ctx
    );

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(customMcpsApi.createCustomMcp).not.toHaveBeenCalled();
  });
});

describe("customMcpKind.apply — create", () => {
  it("registers the MCP from the change's meta.recipe", async () => {
    customMcpsApi.createCustomMcp.mockResolvedValue(makeMcp());

    const result = await customMcpKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "custom-mcp.local",
            summary: "create custom-mcp",
            meta: { recipe: recipe({ name: "local", url: "https://x.test/mcp" }) },
          },
        ],
      },
      ref,
      ctx
    );

    expect(customMcpsApi.createCustomMcp).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ name: "local", url: "https://x.test/mcp" })
    );
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });

  it("falls back to parsing change.after when meta.recipe is absent", async () => {
    customMcpsApi.createCustomMcp.mockResolvedValue(makeMcp());

    await customMcpKind.apply(
      {
        changes: [
          {
            kind: "create",
            path: "custom-mcp.local",
            summary: "create custom-mcp",
            after: { name: "local", url: "https://from-after.test/mcp" },
          },
        ],
      },
      ref,
      ctx
    );

    expect(customMcpsApi.createCustomMcp).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ url: "https://from-after.test/mcp" })
    );
  });

  it("throws when change.after is invalid and no meta.recipe is present", async () => {
    await expect(
      customMcpKind.apply(
        {
          changes: [
            {
              kind: "create",
              path: "custom-mcp.local",
              summary: "create custom-mcp",
              after: { name: "local", url: "not-a-url" },
            },
          ],
        },
        ref,
        ctx
      )
    ).rejects.toThrow();
    expect(customMcpsApi.createCustomMcp).not.toHaveBeenCalled();
  });
});

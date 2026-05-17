import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpToolsCommand } from "../../../../src/commands/mcp/tools";

/**
 * `scai mcp tools {list, schema}` — offline registry inspectors. These
 * commands build the real `buildScaiMcpRegistry()` (no tenant binding),
 * so the tests drive the live commander tree and assert on what each
 * branch writes to stdout: TSV vs JSON, names-only vs detailed, single
 * tool vs all-tools schema, and the unknown-tool error path.
 */

// `createMcpToolsCommand()` returns the `tools` command itself; with
// `from: "user"` the arg vector begins at its first subcommand.
const runList = (args: string[]): string => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const cmd = createMcpToolsCommand().exitOverride();
  cmd.parse(["list", ...args], { from: "user" });
  const out = stdout.mock.calls.map((c) => String(c[0])).join("");
  stdout.mockRestore();
  return out;
};

const runSchema = (args: string[]): string => {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const cmd = createMcpToolsCommand().exitOverride();
  cmd.parse(["schema", ...args], { from: "user" });
  const out = stdout.mock.calls.map((c) => String(c[0])).join("");
  stdout.mockRestore();
  return out;
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMcpToolsCommand — command tree", () => {
  it("registers a `list` and a `schema` subcommand", () => {
    const cmd = createMcpToolsCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain("list");
    expect(names).toContain("schema");
  });

  it("`list` declares --json and --names options", () => {
    const list = createMcpToolsCommand().commands.find((c) => c.name() === "list")!;
    const longs = new Set(list.options.map((o) => o.long));
    expect(longs.has("--json")).toBe(true);
    expect(longs.has("--names")).toBe(true);
  });

  it("`schema` declares --name and --json options", () => {
    const schema = createMcpToolsCommand().commands.find((c) => c.name() === "schema")!;
    const longs = new Set(schema.options.map((o) => o.long));
    expect(longs.has("--name")).toBe(true);
    expect(longs.has("--json")).toBe(true);
  });
});

describe("tools list — detailed (default) branch", () => {
  it("writes TSV rows with name, auth class, and description", () => {
    const out = runList([]);
    // TSV: each row is `name\t[auth]\tdescription`.
    expect(out).toMatch(/\t\[(read|write)\]\t/);
    // A well-known tool from the registry.
    expect(out).toContain("audit_inspect");
  });

  it("emits a structured JSON `tools` array with --json", () => {
    const out = runList(["--json"]);
    const parsed = JSON.parse(out) as {
      tools: Array<{ name: string; auth: string; description: string; annotations: unknown }>;
    };
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools.length).toBeGreaterThan(0);
    expect(parsed.tools[0]).toHaveProperty("name");
    expect(parsed.tools[0]).toHaveProperty("auth");
    expect(parsed.tools[0]).toHaveProperty("annotations");
  });
});

describe("tools list — names-only branch", () => {
  it("--names emits one bare tool name per line (no auth/description)", () => {
    const out = runList(["--names"]);
    const lines = out.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    // No TSV separators or auth brackets in names-only mode.
    expect(out).not.toContain("\t");
    expect(out).not.toMatch(/\[(read|write)\]/);
    expect(lines).toContain("audit_inspect");
  });

  it("--names --json emits a JSON object with a string[] `tools`", () => {
    const out = runList(["--names", "--json"]);
    const parsed = JSON.parse(out) as { tools: string[] };
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools.every((t) => typeof t === "string")).toBe(true);
    expect(parsed.tools).toContain("audit_inspect");
  });
});

describe("tools schema — single tool branch", () => {
  it("prints the named tool's JSON schema (text form: name header + schema)", () => {
    const out = runSchema(["--name", "audit_inspect"]);
    // Text branch (json=true is passed internally regardless, but the
    // single-tool path returns JSON either way) — assert the payload.
    const trimmed = out.trim();
    const parsed = JSON.parse(trimmed) as { name: string; schema: { properties?: unknown } };
    expect(parsed.name).toBe("audit_inspect");
    expect(parsed.schema).toHaveProperty("properties");
  });

  it("throws a helpful error for an unknown tool name", () => {
    expect(() => runSchema(["--name", "not_a_real_tool"])).toThrow(
      /Unknown tool 'not_a_real_tool'/
    );
  });

  it("the unknown-tool error lists the known tool names", () => {
    let message = "";
    try {
      runSchema(["--name", "bogus"]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("Known tools:");
    expect(message).toContain("audit_inspect");
  });
});

describe("tools schema — all-tools branch", () => {
  it("with no --name emits a `schemas` array covering every tool", () => {
    const out = runSchema([]);
    const parsed = JSON.parse(out) as {
      schemas: Array<{ name: string; schema: unknown }>;
    };
    expect(Array.isArray(parsed.schemas)).toBe(true);
    expect(parsed.schemas.length).toBeGreaterThan(1);
    expect(parsed.schemas.every((s) => typeof s.name === "string")).toBe(true);
    expect(parsed.schemas.map((s) => s.name)).toContain("audit_inspect");
  });
});

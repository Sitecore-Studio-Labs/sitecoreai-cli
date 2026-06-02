import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai://env/current/*` MCP resource handlers. Two resources:
 *
 *  - `manifest`: pure projection of the bound EnvBinding — covered by
 *    invoking the handler against a hand-built context and asserting
 *    the JSON it emits.
 *
 *  - `last-deploy`: lazy fetch. Branches:
 *      1. `env.environmentId` missing → empty payload
 *      2. fetchEnvironmentDeployments returns [] → empty payload
 *      3. fetchEnvironmentDeployments returns non-array → coerced to []
 *         → empty payload (defensive)
 *      4. latest exists with id → fetchDeploymentLogs succeeds, logs included
 *      5. latest exists with id → fetchDeploymentLogs throws → logs: null
 *      6. latest exists without id → no log fetch, logs: null
 *      7. fetchEnvironmentDeployments throws → error payload (outer catch)
 *      8. fetchEnvironmentDeployments throws non-Error → stringified
 */

const apiMocks = vi.hoisted(() => ({
  fetchEnvironmentDeployments: vi.fn(),
  fetchDeploymentLogs: vi.fn(),
}));

vi.mock("../../../../src/deploy/api", () => apiMocks);

import { registerEnvironmentResources } from "../../../../src/mcp/resources/env";

type ResourceDescriptor = {
  uri: string;
  handler: (context: unknown) => Promise<{ contents: Array<{ text: string }> }>;
};

class FakeRegistry {
  resources = new Map<string, ResourceDescriptor>();
  registerResource(d: ResourceDescriptor): void {
    this.resources.set(d.uri, d);
  }
  registerTool(): void {}
  registerPrompt(): void {}
}

const buildContext = (
  overrides: Partial<{ envName: string; environment: Record<string, unknown> }> = {}
) => ({
  envName: overrides.envName ?? "sandbox",
  configPath: "/cfg/sitecoreai.cli.json",
  allowWriteEnabled: false,
  deployToken: "tok-deploy",
  resolved: {
    environment: {
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      environmentType: "Sandbox",
      host: "https://example.cm/",
      ...(overrides.environment ?? {}),
    },
  },
});

const runHandler = async (
  registry: FakeRegistry,
  uri: string,
  context: unknown
): Promise<unknown> => {
  const descriptor = registry.resources.get(uri)!;
  const result = await descriptor.handler(context);
  return JSON.parse(result.contents[0].text);
};

let registry: FakeRegistry;

beforeEach(() => {
  registry = new FakeRegistry();
  registerEnvironmentResources(registry as never);
  apiMocks.fetchEnvironmentDeployments.mockReset();
  apiMocks.fetchDeploymentLogs.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerEnvironmentResources — manifest", () => {
  it("registers both URIs", () => {
    expect(registry.resources.has("scai://env/current/manifest")).toBe(true);
    expect(registry.resources.has("scai://env/current/last-deploy")).toBe(true);
  });

  it("returns a snapshot of the bound env metadata", async () => {
    const payload = (await runHandler(
      registry,
      "scai://env/current/manifest",
      buildContext()
    )) as Record<string, unknown>;
    expect(payload).toEqual({
      name: "sandbox",
      configPath: "/cfg/sitecoreai.cli.json",
      allowWriteEnabled: false,
      organizationId: "org-1",
      projectId: "proj-1",
      environmentId: "env-1",
      environmentType: "Sandbox",
      host: "https://example.cm/",
    });
  });
});

describe("registerEnvironmentResources — last-deploy branches", () => {
  it("returns the empty payload when environmentId is missing", async () => {
    const ctx = buildContext({ environment: { environmentId: undefined } });
    const payload = (await runHandler(registry, "scai://env/current/last-deploy", ctx)) as Record<
      string,
      unknown
    >;
    expect(payload.deployment).toBeNull();
    expect(payload.logs).toBeNull();
    expect(payload.message).toMatch(/No deployment/);
    expect(apiMocks.fetchEnvironmentDeployments).not.toHaveBeenCalled();
  });

  it("returns the empty payload when fetchEnvironmentDeployments yields an empty list", async () => {
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue([]);
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as Record<string, unknown>;
    expect(payload.deployment).toBeNull();
  });

  it("returns the empty payload when fetchEnvironmentDeployments returns a non-array (defensive)", async () => {
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue({ unexpected: "object" });
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as Record<string, unknown>;
    expect(payload.deployment).toBeNull();
  });

  it("attaches logs when the latest deployment has an id and logs fetch succeeds", async () => {
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue([{ id: "dep-1", status: "completed" }]);
    apiMocks.fetchDeploymentLogs.mockResolvedValue([{ line: "ok" }]);
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as { deployment: { id: string }; logs: unknown };
    expect(payload.deployment).toEqual({ id: "dep-1", status: "completed" });
    expect(payload.logs).toEqual([{ line: "ok" }]);
    expect(apiMocks.fetchDeploymentLogs).toHaveBeenCalledWith("dep-1", "tok-deploy");
  });

  it("falls back to logs=null when fetchDeploymentLogs throws (inner catch)", async () => {
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue([{ id: "dep-2" }]);
    apiMocks.fetchDeploymentLogs.mockRejectedValue(new Error("boom"));
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as { logs: unknown };
    expect(payload.logs).toBeNull();
  });

  it("skips fetching logs when the latest deployment has no id", async () => {
    apiMocks.fetchEnvironmentDeployments.mockResolvedValue([{ status: "queued" }]);
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as { logs: unknown };
    expect(payload.logs).toBeNull();
    expect(apiMocks.fetchDeploymentLogs).not.toHaveBeenCalled();
  });

  it("returns an error payload when fetchEnvironmentDeployments throws (outer catch)", async () => {
    apiMocks.fetchEnvironmentDeployments.mockRejectedValue(new Error("network down"));
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as Record<string, unknown>;
    expect(payload.error).toBe("network down");
    expect(payload.deployment).toBeNull();
  });

  it("stringifies a non-Error rejection in the outer catch", async () => {
    apiMocks.fetchEnvironmentDeployments.mockRejectedValue("plain string failure");
    const payload = (await runHandler(
      registry,
      "scai://env/current/last-deploy",
      buildContext()
    )) as Record<string, unknown>;
    expect(payload.error).toBe("plain string failure");
  });
});

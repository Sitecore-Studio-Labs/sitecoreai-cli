import { describe, expect, it } from "vitest";
import { buildScaiMcpRegistry } from "../../../src/mcp/build-registry";
import type { McpContext } from "../../../src/mcp/auth";

const fakeContext: McpContext = {
  envName: "test-env",
  configPath: "/tmp/scai-test",
  resolved: {
    envName: "test-env",
    environment: { environmentId: "env-id", host: "https://example.test" } as never,
    root: {} as never,
    timeoutMs: undefined,
  },
  allowWriteEnabled: false,
  deployToken: "fake-token",
};

describe("MCP resources", () => {
  const registry = buildScaiMcpRegistry();

  it("registers the 8 required URIs", () => {
    const uris = registry
      .listResources()
      .map((r) => r.uri)
      .sort();
    expect(uris).toEqual([
      "https://api-docs.sitecore.com/",
      "scai://env/current/last-deploy",
      "scai://env/current/manifest",
      "scai://help/deploy-lifecycle",
      "scai://help/overview",
      "scai://help/recipes-grammar",
      "scai://help/recipes-workflow",
      "scai://help/sitecore-apis",
    ]);
  });

  it("help/sitecore-apis returns the curated API catalog markdown", async () => {
    const resource = registry.listResources().find((r) => r.uri === "scai://help/sitecore-apis")!;
    const result = await resource.handler(fakeContext);
    const body = result.contents[0] as { text: string };
    expect(body.text).toContain("api-docs.sitecore.com");
    expect(body.text).toContain("XM Cloud Deploy API");
    expect(body.text).toContain("Authoring & Management GraphQL API");
  });

  it("api-docs.sitecore.com external resource resolves with a pointer body", async () => {
    const resource = registry
      .listResources()
      .find((r) => r.uri === "https://api-docs.sitecore.com/")!;
    const result = await resource.handler(fakeContext);
    const body = result.contents[0] as { text: string };
    expect(body.text).toContain("https://api-docs.sitecore.com/");
  });

  it("help/overview returns non-empty markdown content", async () => {
    const resource = registry.listResources().find((r) => r.uri === "scai://help/overview")!;
    const result = await resource.handler(fakeContext);
    expect(result.contents).toHaveLength(1);
    const body = result.contents[0] as { text: string };
    expect(body.text.length).toBeGreaterThan(100);
  });

  it("help/recipes-grammar returns non-empty markdown content", async () => {
    const resource = registry.listResources().find((r) => r.uri === "scai://help/recipes-grammar")!;
    const result = await resource.handler(fakeContext);
    const body = result.contents[0] as { text: string };
    expect(body.text.length).toBeGreaterThan(100);
  });

  it("help/deploy-lifecycle returns non-empty markdown content", async () => {
    const resource = registry
      .listResources()
      .find((r) => r.uri === "scai://help/deploy-lifecycle")!;
    const result = await resource.handler(fakeContext);
    const body = result.contents[0] as { text: string };
    expect(body.text.length).toBeGreaterThan(100);
  });

  it("env/current/manifest returns the bound env metadata", async () => {
    const resource = registry.listResources().find((r) => r.uri === "scai://env/current/manifest")!;
    const result = await resource.handler(fakeContext);
    const body = result.contents[0] as { text: string };
    const parsed = JSON.parse(body.text);
    expect(parsed.name).toBe("test-env");
    expect(parsed.environmentId).toBe("env-id");
    expect(parsed.host).toBe("https://example.test");
  });
});

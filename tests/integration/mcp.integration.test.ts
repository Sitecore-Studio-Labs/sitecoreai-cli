/**
 * MCP server end-to-end integration — spawns `scai mcp serve` as a
 * subprocess, drives it with the SDK's Client class over the stdio
 * transport, and asserts the tool / resource / prompt envelopes.
 *
 * This test does NOT make live HTTP calls to Sitecore. Tools that hit
 * the Deploy API or the Authoring/Management API will fail with an
 * AUTH_REQUIRED or NETWORK error inside the envelope, which is
 * acceptable — we're verifying the SDK round-trip + envelope shape,
 * not API integration.
 */

import "./setup";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "src", "cli.ts");

interface ToolResultEnvelope {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

describe("scai mcp serve — stdio integration", () => {
  let tempDir: string;
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "scai-mcp-int-"));
    await mkdir(path.join(tempDir), { recursive: true });
    const configPath = path.join(tempDir, "sitecoreai.cli.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          modules: ["**/*.module.json"],
          defaultEnvProfile: "test-env",
          envProfiles: {
            "test-env": {
              host: "https://example.test",
              authority: "https://auth.test",
              audience: "https://api.test",
              clientId: "stub",
              clientSecret: "stub",
              deployToken: "stub-deploy-token",
              organizationId: "org-stub",
              projectId: "proj-stub",
              environmentId: "env-stub",
            },
          },
          serialization: { excludedFields: [] },
        },
        null,
        2
      ),
      "utf8"
    );

    const tsxBin = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
    transport = new StdioClientTransport({
      command: tsxBin,
      args: [
        "-r",
        path.join(REPO_ROOT, "node_modules", "tsconfig-paths", "register.js"),
        CLI_ENTRY,
        "mcp",
        "serve",
        "--config",
        tempDir,
        "--environment-name",
        "test-env",
      ],
      env: {
        ...process.env,
        SITECOREAI_AUTO_WIZARD: "0",
        SITECOREAI_QUIET: "1",
        SITECOREAI_JSON: "1",
        SITECOREAI_MCP_SERVE: "1",
        SITECOREAI_NON_INTERACTIVE: "1",
      },
    });
    client = new Client({ name: "scai-mcp-int-test", version: "0.0.0" });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("lists at least 18 tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBeGreaterThanOrEqual(18);
  });

  it("lists the 7 required resources", async () => {
    const result = await client.listResources();
    const uris = result.resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "https://api-docs.sitecore.com/",
      "scai://env/current/last-deploy",
      "scai://env/current/manifest",
      "scai://help/deploy-lifecycle",
      "scai://help/overview",
      "scai://help/recipes-grammar",
      "scai://help/sitecore-apis",
    ]);
  });

  it("lists the 3 workflow prompts", async () => {
    const result = await client.listPrompts();
    const names = result.prompts.map((p) => p.name).sort();
    expect(names).toEqual(["scai.deploy_recipe", "scai.diff_envs", "scai.recover_failed_deploy"]);
  });

  it("scai_overview returns server metadata envelope", async () => {
    const result = (await client.callTool({
      name: "scai_overview",
      arguments: {},
    })) as ToolResultEnvelope;
    expect(result.isError).not.toBe(true);
    expect(result.content).toBeTruthy();
    const structured = result.structuredContent as {
      server: { name: string };
      environment: { name: string };
    };
    expect(structured.server.name).toBe("scai");
    expect(structured.environment.name).toBe("test-env");
  });

  it("rejects a write tool called without allowWrite", async () => {
    const result = (await client.callTool({
      name: "deploy_environment_lifecycle",
      arguments: { action: "restart", environmentId: "env-stub", allowWrite: false },
    })) as ToolResultEnvelope;
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("INPUT_INVALID");
  });

  it("write tool with allowWrite=true reaches the handler (network error envelope acceptable)", async () => {
    const result = (await client.callTool({
      name: "deploy_environment_lifecycle",
      arguments: { action: "restart", environmentId: "env-stub", allowWrite: true },
    })) as ToolResultEnvelope;
    // Network call will fail against example.test — we only require the
    // envelope to be an error envelope with a known code, not isError=false.
    if (result.isError) {
      const code = (result.structuredContent as { code: string }).code;
      expect([
        "NETWORK",
        "AUTH_REQUIRED",
        "UNKNOWN",
        "DEPLOY_FAILED",
        "SITES_API_FAILED",
      ]).toContain(code);
    } else {
      expect(result.content).toBeTruthy();
    }
  });

  it("reads scai://help/overview", async () => {
    const result = await client.readResource({ uri: "scai://help/overview" });
    expect(result.contents).toHaveLength(1);
    const body = result.contents[0] as { text: string };
    expect(body.text.length).toBeGreaterThan(100);
  });

  it("reads scai://env/current/manifest with the bound env name", async () => {
    const result = await client.readResource({ uri: "scai://env/current/manifest" });
    const body = result.contents[0] as { text: string };
    const parsed = JSON.parse(body.text);
    expect(parsed.name).toBe("test-env");
  });

  it("fetches the scai.deploy_recipe prompt template", async () => {
    const result = await client.getPrompt({
      name: "scai.deploy_recipe",
      arguments: { recipeName: "demo", targetEnv: "test-env" },
    });
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0] as { content: { type: string; text: string } };
    expect(message.content.text).toContain("recipe_compile");
  });

  it("converts a pre-aborted client call into a CANCELLED envelope", async () => {
    // The SDK's Client.callTool accepts an `AbortSignal` via the third
    // RequestOptions argument; firing it before the call resolves
    // surfaces as the server emitting CANCELLED.
    const controller = new AbortController();
    controller.abort();
    let captured: { isError?: boolean; structuredContent?: { code?: string } } | undefined;
    try {
      captured = (await client.callTool({ name: "scai_overview", arguments: {} }, undefined, {
        signal: controller.signal,
      })) as never;
    } catch (error) {
      // The SDK may surface a client-side abort as a thrown error
      // before the round-trip completes — that's also a valid signal
      // that cancellation worked. Either path is acceptable for v1.
      expect((error as Error).message.toLowerCase()).toMatch(/abort|cancel/);
      return;
    }
    if (captured) {
      expect(captured.isError).toBe(true);
      expect(captured.structuredContent?.code).toBe("CANCELLED");
    }
  });
});

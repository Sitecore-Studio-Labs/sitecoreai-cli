/**
 * Wires the in-house `McpRegistry` to the MCP SDK's `McpServer` and
 * starts the stdio transport.
 *
 * Why a separate registry first? See `registry.ts` — we need to gate
 * writes (allowWrite), serialize calls, and shape error envelopes
 * before the SDK sees the handler. Here the bridge is intentionally
 * thin: every registered tool becomes a forwarder that delegates to
 * `dispatchTool`, every resource becomes a single-URI ReadCallback,
 * every prompt forwards its args object through unchanged.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpContext } from "./auth";
import { dispatchTool } from "./dispatch";
import type { McpRegistry } from "./registry";
import packageJson from "../../package.json";

export interface McpServerOptions {
  context: McpContext;
  registry: McpRegistry;
}

export const buildMcpServer = (options: McpServerOptions): McpServer => {
  const { context, registry } = options;

  const server = new McpServer({
    name: "scai",
    version: packageJson.version,
  });

  for (const tool of registry.listTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.annotations.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => dispatchTool(tool, args ?? {}, { context })
    );
  }

  for (const resource of registry.listResources()) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async () => resource.handler(context)
    );
  }

  for (const prompt of registry.listPrompts()) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.name,
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      async (args: Record<string, unknown>) => prompt.handler(args as never, context)
    );
  }

  return server;
};

export const startStdioTransport = async (server: McpServer): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

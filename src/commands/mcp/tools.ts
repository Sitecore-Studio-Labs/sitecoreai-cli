/**
 * `scai mcp tools {list, schema}` — offline inspectors for the
 * registered tool surface. Both commands instantiate the same registry
 * `mcp serve` uses but without binding to a tenant, so the output is
 * deterministic and safe to run anywhere.
 */

import { Command, Option } from "commander";
import { z } from "zod";
import { buildScaiMcpRegistry } from "@/mcp/build-registry";

const formatToolsList = (json: boolean): string => {
  const registry = buildScaiMcpRegistry();
  const tools = registry.listTools().map((tool) => ({
    name: tool.name,
    auth: tool.auth,
    description: tool.description,
    annotations: tool.annotations,
  }));
  if (json) {
    return JSON.stringify({ tools }, null, 2);
  }
  return tools.map((tool) => `${tool.name}\t[${tool.auth}]\t${tool.description}`).join("\n");
};

const formatToolsSchema = (name: string | undefined, json: boolean): string => {
  const registry = buildScaiMcpRegistry();
  if (name) {
    const tool = registry.getTool(name);
    if (!tool) {
      const known = registry
        .listTools()
        .map((t) => t.name)
        .join(", ");
      throw new Error(`Unknown tool '${name}'. Known tools: ${known}`);
    }
    const schema = z.toJSONSchema(z.object({ ...tool.inputSchema }));
    if (json) {
      return JSON.stringify({ name: tool.name, schema }, null, 2);
    }
    return `${tool.name}\n${JSON.stringify(schema, null, 2)}`;
  }
  const schemas = registry.listTools().map((tool) => ({
    name: tool.name,
    schema: z.toJSONSchema(z.object({ ...tool.inputSchema })),
  }));
  return JSON.stringify({ schemas }, null, 2);
};

export const createMcpToolsCommand = (): Command => {
  const tools = new Command("tools").description("Inspect the scai MCP tool surface (offline).");

  tools
    .command("list")
    .description("List every registered tool with its description and auth class.")
    .addOption(new Option("--json", "Emit JSON instead of TSV."))
    .action((options: { json?: boolean }) => {
      process.stdout.write(`${formatToolsList(Boolean(options.json))}\n`);
    });

  tools
    .command("schema")
    .description("Print the Zod-derived JSON schema for one tool (--name) or all tools.")
    .addOption(new Option("--name <name>", "Tool name. When omitted, returns every tool's schema."))
    .addOption(
      new Option("--json", "Emit JSON (always JSON for schema output; flag retained for parity).")
    )
    .action((options: { name?: string; json?: boolean }) => {
      void options.json;
      process.stdout.write(`${formatToolsSchema(options.name, true)}\n`);
    });

  return tools;
};

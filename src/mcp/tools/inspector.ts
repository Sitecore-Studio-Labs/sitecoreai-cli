/**
 * Inspector tools — used by humans (and orchestrating agents) to peek
 * at the registered tool surface without round-tripping through SDK
 * introspection.
 *
 * `tools_list` returns names + descriptions + auth class.
 * `tools_schema` returns the Zod-derived JSON schema for one tool or
 * all tools. Implementation note: we use `zod`'s `z.toJSONSchema`
 * (Zod 4+) to keep the surface dependency-free.
 */

import { z } from "zod";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { ToolDescriptor } from "../registry";
import { McpRegistry } from "../registry";

const toolJsonSchema = (tool: ToolDescriptor): unknown =>
  z.toJSONSchema(z.object({ ...tool.inputSchema }));

export const registerInspectorTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "tools_list",
    description: TOOL_DESCRIPTIONS.tools_list,
    auth: "read",
    annotations: {
      title: "List MCP tools",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {},
    handler: async () => {
      const tools = registry.listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        auth: tool.auth,
        annotations: tool.annotations,
      }));
      return {
        content: [
          {
            type: "text",
            text: `${tools.length} tool(s) registered on this MCP server.`,
          },
        ],
        structuredContent: { tools },
      };
    },
  });

  registry.registerTool({
    name: "tools_schema",
    description: TOOL_DESCRIPTIONS.tools_schema,
    auth: "read",
    annotations: {
      title: "Get tool input schema(s)",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      name: z
        .string()
        .optional()
        .describe("Optional tool name. When omitted, returns schemas for every registered tool."),
    },
    handler: async (input) => {
      if (input.name) {
        const tool = registry.getTool(input.name);
        if (!tool) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `What happened: Tool '${input.name}' is not registered.\n` +
                  `Why: The provided name does not match any tool on this MCP server.\n` +
                  `Next: Call tools_list to discover available tool names.`,
              },
            ],
            structuredContent: {
              code: "INPUT_INVALID",
              what: "Unknown tool",
              why: `Tool '${input.name}' is not registered.`,
              next: "Call tools_list to discover available tool names.",
            },
          };
        }
        return {
          content: [{ type: "text", text: `Schema for tool '${tool.name}'.` }],
          structuredContent: { name: tool.name, schema: toolJsonSchema(tool) },
        };
      }
      const schemas = registry.listTools().map((tool) => ({
        name: tool.name,
        schema: toolJsonSchema(tool),
      }));
      return {
        content: [{ type: "text", text: `Schemas for ${schemas.length} tool(s).` }],
        structuredContent: { schemas },
      };
    },
  });
};

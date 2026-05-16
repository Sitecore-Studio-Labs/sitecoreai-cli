/**
 * Agentic Studio domain — read + run tools over the Agentic Studio BFF.
 *
 * Two tools, workflow-shaped:
 *   - `agents_inspect` (read) discriminates on `verb` — list agents,
 *     skills, the tool catalog, widgets, schemas, or registered custom
 *     MCP servers, or report session status.
 *   - `agents_run` (write) runs an agent by slug and returns its output.
 *
 * Creating/updating agents, skills, widgets, and MCPs is declarative —
 * the recipe kinds + `scai sync`, not an MCP tool.
 */
import { z } from "zod";
import { acquireAgentsSession } from "@/agents/session";
import { agentsRequest } from "@/agents/api/request";
import { listAgents } from "@/agents/api/agents";
import { listSkills } from "@/agents/api/skills";
import { listTools } from "@/agents/api/tools";
import { listWidgets } from "@/agents/api/widgets";
import { listSchemas } from "@/agents/api/schemas";
import { listCustomMcps } from "@/agents/api/custom-mcps";
import { runAgent } from "@/agents/api/runs";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape } from "../schemas/common";

export const registerAgentsTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "agents_inspect",
    description: TOOL_DESCRIPTIONS.agents_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore Agentic Studio",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["agents", "skills", "tools", "widgets", "schemas", "mcps", "status"])
        .describe(
          "Read operation: agents | skills | tools (catalog) | widgets | schemas | mcps (custom MCP servers) | status (session validity)."
        ),
    },
    handler: async (input, context) => {
      const session = await acquireAgentsSession(context.envName);
      switch (input.verb) {
        case "agents": {
          const result = await listAgents(session);
          return {
            content: [{ type: "text", text: `${result.length} agent(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "skills": {
          const result = await listSkills(session);
          return {
            content: [{ type: "text", text: `${result.length} skill(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "tools": {
          const result = await listTools(session);
          return {
            content: [{ type: "text", text: `${result.length} tool(s) in the catalog.` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "widgets": {
          const result = await listWidgets(session);
          return {
            content: [{ type: "text", text: `${result.length} widget(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "schemas": {
          const result = await listSchemas(session);
          return {
            content: [{ type: "text", text: `${result.length} schema(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "mcps": {
          const result = await listCustomMcps(session);
          return {
            content: [{ type: "text", text: `${result.length} custom MCP(s).` }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "status": {
          const refresh = await agentsRequest<{ success?: boolean; expiresAt?: string }>(
            session,
            "/api/token-refresh"
          );
          const valid = refresh?.success !== false;
          return {
            content: [
              { type: "text", text: `Agentic Studio session is ${valid ? "valid" : "invalid"}.` },
            ],
            structuredContent: {
              verb: input.verb,
              result: { endpoint: session.baseUrl, valid, expiresAt: refresh?.expiresAt },
            },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "agents_run",
    description: TOOL_DESCRIPTIONS.agents_run,
    auth: "write",
    annotations: {
      title: "Run a Sitecore Agentic Studio agent",
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      agentSlug: z
        .string()
        .describe("Slug of the agent to run (see agents_inspect verb='agents')."),
      message: z.string().describe("The user message / prompt to send to the agent."),
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const session = await acquireAgentsSession(context.envName);
      const { spaceId, events } = await runAgent(session, {
        agentSlug: input.agentSlug,
        message: input.message,
      });
      let output = "";
      const eventCounts: Record<string, number> = {};
      for await (const event of events) {
        eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
        if (event.type === "text-delta" && typeof event.delta === "string") {
          output += event.delta;
        } else if (event.type === "data-artifactDelta") {
          const data = event.data as { content?: string } | undefined;
          if (typeof data?.content === "string") output += data.content;
        }
      }
      return {
        content: [{ type: "text", text: output || `Run completed (space ${spaceId}).` }],
        structuredContent: { spaceId, output, eventCounts },
      };
    },
  });
};

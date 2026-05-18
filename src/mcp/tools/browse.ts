/**
 * `content_browse` — read-only content-tree browse.
 *
 * Enumerates the items under a path (bounded depth) so an agent can see
 * "what is under here" in one call. The thin MCP wrapper over
 * `runContentBrowse` (`@/hygiene/tasks/browse`).
 */

import { z } from "zod";
import { MAX_BROWSE_DEPTH, runContentBrowse } from "@/hygiene/tasks/browse";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { environmentBindingShape } from "../schemas/common";

export const registerBrowseTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "content_browse",
    description: TOOL_DESCRIPTIONS.content_browse,
    auth: "read",
    annotations: {
      title: "Browse the content tree",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      path: z
        .string()
        .min(1)
        .describe("Content-tree path to browse, e.g. /sitecore/templates/Project."),
      depth: z
        .number()
        .int()
        .min(1)
        .max(MAX_BROWSE_DEPTH)
        .default(1)
        .describe(`Recursion depth — 1 is direct children only (max ${MAX_BROWSE_DEPTH}).`),
      ...environmentBindingShape,
    },
    handler: async (input, context) => {
      const result = await runContentBrowse({
        config: context.configPath,
        environmentName: input.environmentName ?? context.envName,
        path: input.path,
        depth: input.depth,
      });
      const text =
        result.totalCount === 0
          ? `No items under '${result.path}'.`
          : `${result.totalCount} item(s) under '${result.path}' (depth ${result.depth}).`;
      return {
        content: [{ type: "text", text }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  });
};

/**
 * Shared Zod schemas reused across MCP tool input shapes.
 *
 * Every shape exported here is composable as a `ZodRawShape` (record of
 * Zod schemas) so it can be spread into a tool's `inputSchema` config
 * object passed to `McpServer.registerTool`.
 */

import { z } from "zod";

export const allowWriteShape = {
  allowWrite: z
    .boolean()
    .default(false)
    .describe(
      "Required to be true for any mutating call. Per-call gate — never persisted. Set true only after the user has explicitly approved the change."
    ),
} as const;

export const whatIfShape = {
  whatIf: z
    .boolean()
    .default(false)
    .describe(
      "Dry-run flag. When true, the underlying operation plans the work and reports the outcome without applying mutations."
    ),
} as const;

export const paginationShape = {
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(25)
    .describe("Maximum number of items to return for paginated listings (max 100, default 25)."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque pagination cursor from a previous response's `nextCursor`."),
} as const;

export const environmentBindingShape = {
  environmentName: z
    .string()
    .optional()
    .describe(
      "Optional override for the bound environment name. When omitted, uses the environment the MCP server was started with."
    ),
} as const;

export const ALLOW_WRITE_ERROR_HINT =
  "Re-invoke the same tool with `allowWrite: true` after the user has authorized this change. Reads are always free; writes require explicit consent.";

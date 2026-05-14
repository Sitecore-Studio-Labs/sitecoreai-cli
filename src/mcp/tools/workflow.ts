/**
 * Workflow domain — inspect + lifecycle.
 *
 * Two tools, workflow-shaped:
 *
 *   - `workflow_inspect` (read) discriminates on `verb` so a single
 *     entry point covers state inspection, available-command lookup,
 *     workflow-definition enumeration, per-site rollup (XM Apps REST),
 *     and workflow-state search ("assigned to me" queries).
 *
 *   - `workflow_lifecycle` (write) currently exposes a single `verb`
 *     (`advance`) but is shaped as a discriminated input so future
 *     mutations (reset to initial, bulk-advance) slot in without
 *     forcing a tool-name change.
 *
 * Each handler delegates to the `runWorkflow*` task function shared
 * with the CLI; the MCP layer adds only the discriminator routing
 * and the structured-content envelope.
 */

import { z } from "zod";
import {
  runWorkflowAdvance,
  runWorkflowAssigned,
  runWorkflowInspect,
  runWorkflowListCommands,
  runWorkflowListDefs,
  runWorkflowStatus,
} from "@/workflow/tasks";
import { createScaiError } from "@/shared/errors";
import { TOOL_DESCRIPTIONS } from "../descriptions";
import type { McpRegistry } from "../registry";
import { allowWriteShape, whatIfShape } from "../schemas/common";

const baseTaskOptions = (
  config: string,
  envName: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  config,
  environmentName: envName,
  quiet: true,
  json: false,
  ...overrides,
});

export const registerWorkflowTools = (registry: McpRegistry): void => {
  registry.registerTool({
    name: "workflow_inspect",
    description: TOOL_DESCRIPTIONS.workflow_inspect,
    auth: "read",
    annotations: {
      title: "Inspect Sitecore workflows",
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["inspect", "list-commands", "list-defs", "status", "assigned"])
        .describe("Which read operation to run."),
      item: z
        .string()
        .optional()
        .describe(
          "Item GUID or content-tree path. Required for verb='inspect' and verb='list-commands'."
        ),
      root: z
        .string()
        .optional()
        .describe(
          "Content-tree root for verb='list-defs' (defaults to /sitecore/system/Workflows)."
        ),
      site: z
        .string()
        .optional()
        .describe("Site identifier. Required for verb='status'."),
      contentEnvironmentId: z
        .string()
        .optional()
        .describe(
          "Optional Content Services environment ID for verb='status' (e.g. 'main')."
        ),
      state: z
        .string()
        .optional()
        .describe("Workflow state GUID. Required for verb='assigned'."),
      field: z
        .string()
        .optional()
        .describe(
          "Search field override for verb='assigned' (default: '__workflow state'). Use '__workflow_state' if the default returns no hits."
        ),
      index: z
        .string()
        .optional()
        .describe("Override the search index (verb='assigned')."),
      limit: z
        .number()
        .int()
        .positive()
        .max(2000)
        .optional()
        .describe("Cap on items returned (verb='assigned'; default 500)."),
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(context.configPath, context.envName);
      switch (input.verb) {
        case "inspect": {
          if (!input.item) {
            throw createScaiError("verb='inspect' requires `item`.", "INPUT_INVALID");
          }
          const result = await runWorkflowInspect({
            ...taskOpts,
            item: input.item,
          } as never);
          // `result` is a discriminated union — `kind: "item"` for items
          // under workflow, `kind: "definition"` for Workflow-templated
          // items, `null` when neither resolves.
          let text: string;
          if (!result) {
            text = `Item '${input.item}' is not under workflow and isn't a workflow definition.`;
          } else if (result.kind === "definition") {
            text = `Workflow definition '${
              result.definition.displayName ?? result.definition.name
            }' (${result.definition.path}) — ${result.definition.states.length} state(s).`;
          } else {
            const i = result.item;
            text = `Workflow '${i.workflow.workflowName}' state '${i.state.stateName ?? "?"}' on ${i.path ?? i.itemId}; ${i.availableCommands.length} command(s) available.`;
          }
          return {
            content: [{ type: "text", text }],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "list-commands": {
          if (!input.item) {
            throw createScaiError("verb='list-commands' requires `item`.", "INPUT_INVALID");
          }
          const result = await runWorkflowListCommands({
            ...taskOpts,
            item: input.item,
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result
                  ? `${result.commands.length} command(s) available on ${result.path ?? result.itemId}.`
                  : `Item ${input.item} is not under workflow.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "list-defs": {
          const result = await runWorkflowListDefs({
            ...taskOpts,
            ...(input.root !== undefined && { root: input.root }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.workflows.length} workflow definition(s) under ${result.rootPath}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "status": {
          if (!input.site) {
            throw createScaiError("verb='status' requires `site`.", "INPUT_INVALID");
          }
          const result = await runWorkflowStatus({
            ...taskOpts,
            site: input.site,
            ...(input.contentEnvironmentId !== undefined && {
              contentEnvironmentId: input.contentEnvironmentId,
            }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `Workflow status for site ${result.siteId}: ${(result.statistics.workflows ?? []).length} workflow(s).`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
        case "assigned": {
          if (!input.state) {
            throw createScaiError("verb='assigned' requires `state`.", "INPUT_INVALID");
          }
          const result = await runWorkflowAssigned({
            ...taskOpts,
            state: input.state,
            ...(input.field !== undefined && { field: input.field }),
            ...(input.index !== undefined && { index: input.index }),
            ...(input.limit !== undefined && { limit: input.limit }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: `${result.items.length} item(s) in state ${result.stateId}.`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });

  registry.registerTool({
    name: "workflow_lifecycle",
    description: TOOL_DESCRIPTIONS.workflow_lifecycle,
    auth: "write",
    annotations: {
      title: "Advance a workflow item",
      readOnlyHint: false,
      // Workflow advance writes server-side state and triggers any
      // attached submit/validation webhooks — surface as destructive so
      // the host's confirmation UX kicks in.
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["advance"])
        .describe("Which mutation to run. Only `advance` is supported today."),
      item: z
        .string()
        .describe("Item GUID or content-tree path of the workflow-bound item."),
      command: z
        .string()
        .describe(
          "Workflow command display name (matched case-insensitively against commands available at the item's current state). Use workflow_inspect to enumerate options."
        ),
      comments: z
        .string()
        .optional()
        .describe("Comment recorded with the transition (audit trail)."),
      ...whatIfShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      switch (input.verb) {
        case "advance": {
          const result = await runWorkflowAdvance({
            ...baseTaskOptions(context.configPath, context.envName),
            item: input.item,
            command: input.command,
            ...(input.comments !== undefined && { comments: input.comments }),
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text:
                  result.status === "advanced"
                    ? `Advanced ${result.path ?? result.itemId} via '${result.commandUsed}' → ${result.toState ?? "(unspecified)"}.`
                    : result.status === "what-if"
                      ? `Would execute '${result.commandUsed}' on ${result.path ?? result.itemId}.`
                      : `${result.status}: ${result.message ?? ""}`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }
      }
    },
  });
};

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
  runWorkflowApply,
  runWorkflowAssigned,
  runWorkflowInspect,
  runWorkflowListCommands,
  runWorkflowListDefs,
  runWorkflowReset,
  runWorkflowStatus,
} from "@/workflow/tasks";
import { runCleanupWorkflowAdvance, runCleanupWorkflowApply } from "@/hygiene/tasks";
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
          "Item reference. Required for verb='inspect' and verb='list-commands'. Accepts one of: a Sitecore item GUID (with or without braces/hyphens), a content-tree path starting with /sitecore/, OR a workflow display name / item name (case-insensitive, matched against `Workflow`-templated items under /sitecore/system/Workflows). For verb='inspect', the result is a discriminated `{ kind: 'item' | 'definition', ... }` envelope — `definition` for Workflow-templated refs (returns states/commands/actions tree), `item` for items under workflow (returns current state + available commands). Branch on `result.kind` before reading further fields."
        ),
      root: z
        .string()
        .optional()
        .describe(
          "Content-tree root for verb='list-defs' (defaults to /sitecore/system/Workflows)."
        ),
      site: z.string().optional().describe("Site identifier. Required for verb='status'."),
      contentEnvironmentId: z
        .string()
        .optional()
        .describe("Optional Content Services environment ID for verb='status' (e.g. 'main')."),
      state: z.string().optional().describe("Workflow state GUID. Required for verb='assigned'."),
      field: z
        .string()
        .optional()
        .describe(
          "Search field override for verb='assigned' (default: '__workflow state'). Use '__workflow_state' if the default returns no hits."
        ),
      index: z.string().optional().describe("Override the search index (verb='assigned')."),
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
      title: "Mutate workflow state (advance / reset / bulk-advance / apply)",
      readOnlyHint: false,
      // Every verb writes server-side state and/or triggers attached
      // webhooks. Surface as destructive so the host's confirmation
      // UX kicks in.
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      verb: z
        .enum(["advance", "reset", "bulk-advance", "apply-workflow", "bulk-apply"])
        .describe(
          "Which mutation to run. `advance` moves one item through one command. `reset` force-writes one item back to its workflow's initial state (bypasses validation + submit actions). `bulk-advance` sweeps stale items under a root and advances each via a named command (wraps `scai cleanup workflow advance`). `apply-workflow` attaches a workflow to an item not yet under one (sets `__Workflow` + `__Workflow state` directly). `bulk-apply` does the same as `apply-workflow` but sweeps every item under a root, optionally filtered by template — wraps `scai cleanup workflow apply`."
        ),

      // advance / reset / apply-workflow target
      item: z
        .string()
        .optional()
        .describe(
          "Item GUID or content-tree path. Required for `advance`, `reset`, `apply-workflow`."
        ),

      // advance
      command: z
        .string()
        .optional()
        .describe(
          "Workflow command display name (advance only). Matched case-insensitively against commands available at the item's current state."
        ),
      comments: z
        .string()
        .optional()
        .describe("Comment recorded with the transition (advance only; audit trail)."),

      // apply-workflow + bulk-apply
      workflow: z
        .string()
        .optional()
        .describe(
          "Workflow GUID, content-tree path, or display/item name (apply-workflow / bulk-apply). Same resolver as workflow_inspect verb=inspect."
        ),
      state: z
        .string()
        .optional()
        .describe(
          "Target state (state GUID or name) for apply-workflow / bulk-apply. Defaults to the workflow's `__Initial state`."
        ),

      // bulk-apply
      template: z
        .string()
        .optional()
        .describe(
          "bulk-apply: only attach to items conforming to this template (GUID or absolute /sitecore/templates path). Omit to attach to every item under `root`."
        ),
      reattach: z
        .boolean()
        .optional()
        .describe(
          "bulk-apply: overwrite items already attached to a different workflow. Off by default — already-attached items are skipped."
        ),
      maxApplies: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .describe("bulk-apply blast-radius cap. Default 100."),

      // bulk-advance + bulk-apply
      root: z
        .string()
        .optional()
        .describe(
          "Content-tree root to scan for bulk-advance / bulk-apply. Default `/sitecore/content`."
        ),
      commandName: z
        .string()
        .optional()
        .describe(
          "Workflow command name for bulk-advance (e.g. 'Approve'). Required for bulk-advance."
        ),
      fromState: z
        .string()
        .optional()
        .describe("Limit bulk-advance to items currently in this state name."),
      staleDays: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          "Eligibility window: only items not updated for at least this many days. Bulk-advance defaults to 30; bulk-apply has no default (omit to attach to every match)."
        ),
      maxAdvances: z
        .number()
        .int()
        .positive()
        .max(10000)
        .optional()
        .describe("Bulk-advance blast-radius cap. Default 100."),

      ...whatIfShape,
      ...allowWriteShape,
    },
    handler: async (input, context) => {
      const taskOpts = baseTaskOptions(context.configPath, context.envName);
      switch (input.verb) {
        case "advance": {
          if (!input.item || !input.command) {
            throw createScaiError("verb='advance' requires `item` and `command`.", "INPUT_INVALID");
          }
          const result = await runWorkflowAdvance({
            ...taskOpts,
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

        case "reset": {
          if (!input.item) {
            throw createScaiError("verb='reset' requires `item`.", "INPUT_INVALID");
          }
          const result = await runWorkflowReset({
            ...taskOpts,
            item: input.item,
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result.message ?? `reset → ${result.status}`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }

        case "apply-workflow": {
          if (!input.item || !input.workflow) {
            throw createScaiError(
              "verb='apply-workflow' requires `item` and `workflow`.",
              "INPUT_INVALID"
            );
          }
          const result = await runWorkflowApply({
            ...taskOpts,
            item: input.item,
            workflow: input.workflow,
            ...(input.state !== undefined && { state: input.state }),
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          return {
            content: [
              {
                type: "text",
                text: result.message ?? `apply-workflow → ${result.status}`,
              },
            ],
            structuredContent: { verb: input.verb, result },
          };
        }

        case "bulk-advance": {
          if (!input.commandName) {
            throw createScaiError("verb='bulk-advance' requires `commandName`.", "INPUT_INVALID");
          }
          // Delegates to the existing `runCleanupWorkflowAdvance` task
          // — same semantics as `scai cleanup workflow advance`. Kept
          // MCP-only (no `scai workflow bulk-advance` CLI alias) per
          // the "leave cleanup verbs in place" decision.
          const actions = await runCleanupWorkflowAdvance({
            ...taskOpts,
            commandName: input.commandName,
            ...(input.fromState !== undefined && { fromState: input.fromState }),
            ...(input.root !== undefined && { root: input.root }),
            ...(input.staleDays !== undefined && { staleDays: input.staleDays }),
            ...(input.maxAdvances !== undefined && { maxAdvances: input.maxAdvances }),
            ...(input.comments !== undefined && { comments: input.comments }),
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          const advanced = actions.filter((a) => a.status === "advanced").length;
          const failed = actions.filter((a) => a.status === "failed").length;
          const skipped = actions.filter((a) => a.status === "skipped-no-command").length;
          const whatIfCount = actions.filter((a) => a.status === "what-if").length;
          return {
            content: [
              {
                type: "text",
                text:
                  input.whatIf === true
                    ? `bulk-advance plan: ${whatIfCount} item(s) would advance.`
                    : `bulk-advance: advanced ${advanced}, failed ${failed}, skipped ${skipped}.`,
              },
            ],
            structuredContent: { verb: input.verb, actions },
          };
        }

        case "bulk-apply": {
          if (!input.workflow) {
            throw createScaiError("verb='bulk-apply' requires `workflow`.", "INPUT_INVALID");
          }
          // Delegates to `runCleanupWorkflowApply` — same semantics as
          // `scai cleanup workflow apply`. Workflow-shaped here for
          // discovery; the cleanup tool also exposes it as
          // `verb: 'workflow-apply'` for symmetry with `workflow-advance`.
          const actions = await runCleanupWorkflowApply({
            ...taskOpts,
            workflow: input.workflow,
            ...(input.state !== undefined && { state: input.state }),
            ...(input.template !== undefined && { template: input.template }),
            ...(input.reattach !== undefined && { reattach: input.reattach }),
            ...(input.root !== undefined && { root: input.root }),
            ...(input.staleDays !== undefined && { staleDays: input.staleDays }),
            ...(input.maxApplies !== undefined && { maxApplies: input.maxApplies }),
            ...(input.whatIf !== undefined && { whatIf: input.whatIf }),
            ...(input.allowWrite !== undefined && { allowWrite: input.allowWrite }),
          } as never);
          const applied = actions.filter((a) => a.status === "applied").length;
          const failed = actions.filter((a) => a.status === "failed").length;
          const skippedAttached = actions.filter(
            (a) => a.status === "skipped-already-attached"
          ).length;
          const whatIfCount = actions.filter((a) => a.status === "what-if").length;
          return {
            content: [
              {
                type: "text",
                text:
                  input.whatIf === true
                    ? `bulk-apply plan: ${whatIfCount} item(s) would attach to '${input.workflow}'.`
                    : `bulk-apply: attached ${applied}, failed ${failed}, ${skippedAttached} already attached.`,
              },
            ],
            structuredContent: { verb: input.verb, actions },
          };
        }
      }
    },
  });
};

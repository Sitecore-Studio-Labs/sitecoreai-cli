import { createScaiError, ScaiError } from "@/shared/errors";
import type {
  ItemSelector,
  ItemWorkflowState,
  WorkflowCommandSummary,
  WorkflowDefinitionDetail,
} from "../api";
import {
  dashifyItemId,
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowInspectOptions extends WorkflowTaskOptions {
  /**
   * One of:
   *   - Sitecore item GUID (with or without braces/hyphens)
   *   - content-tree path (starts with `/sitecore/`)
   *   - workflow display name or item name (free-form text)
   *
   * When given free-form text, the inspect task walks the workflow
   * definition list and matches case-insensitively against `name` or
   * `displayName`. Useful for `scai workflow inspect "Blog Article Approval"`.
   */
  item: string;
}

/**
 * Result shape depends on what the ref resolved to:
 *
 *   - `kind: "item"` — the ref pointed at an item under workflow.
 *     Includes the item's state + available transitions.
 *   - `kind: "definition"` — the ref pointed at a Workflow item.
 *     Includes the workflow's full structure (states, commands,
 *     actions, validations).
 *
 * `null` is returned (without error) when no workflow can be located
 * for the ref.
 */
export type WorkflowInspectResult =
  | { kind: "item"; item: WorkflowInspectItemResult }
  | { kind: "definition"; definition: WorkflowDefinitionDetail };

export interface WorkflowInspectItemResult {
  itemId: string;
  path: string | null;
  workflow: {
    workflowId: string;
    workflowName: string | null;
  };
  state: {
    stateId: string | null;
    stateName: string | null;
    final: boolean;
  };
  availableCommands: WorkflowCommandSummary[];
}

const parseSelectorOrName = (
  value: string
): { selector?: ItemSelector; name?: string } => {
  try {
    return { selector: parseItemReference(value) };
  } catch (error) {
    // parseItemReference throws INPUT_INVALID for anything that isn't a
    // GUID or `/sitecore/`-prefixed path. Treat that as the name-lookup
    // signal rather than re-throwing — `runWorkflowInspect` will try
    // `findWorkflowDefinitionByName(value)` next.
    if (error instanceof ScaiError && error.code === "INPUT_INVALID") {
      return { name: value.trim() };
    }
    throw error;
  }
};

const renderDefinitionLines = (def: WorkflowDefinitionDetail): string[] => {
  const lines: string[] = [
    `Workflow:      ${def.displayName ?? def.name} (${def.itemId})`,
    `Path:          ${def.path}`,
    `States:        ${def.states.length}`,
  ];
  for (const state of def.states) {
    const stateLabel = `${state.displayName ?? state.name}${
      state.templateName && state.templateName !== "State" ? ` [${state.templateName}]` : ""
    }`;
    lines.push("");
    lines.push(`  ${stateLabel}`);
    if (state.commands.length > 0) {
      lines.push(`    Commands:`);
      for (const cmd of state.commands) {
        lines.push(`      - ${cmd.displayName ?? cmd.name} (${cmd.itemId})`);
        for (const v of cmd.validations) {
          lines.push(`          ↳ validation: ${v.displayName ?? v.name} [${v.templateName ?? "?"}]`);
        }
      }
    }
    if (state.actions.length > 0) {
      lines.push(`    Actions:`);
      for (const a of state.actions) {
        lines.push(`      - ${a.displayName ?? a.name} [${a.templateName ?? "?"}]`);
      }
    }
    if (state.commands.length === 0 && state.actions.length === 0) {
      lines.push(`    (no commands or actions)`);
    }
  }
  return lines;
};

/**
 * Inspect either a Sitecore workflow definition OR an item under
 * workflow, depending on what the ref resolves to.
 *
 *   - Ref looks like a workflow item path / GUID / name → definition view.
 *     Walks the workflow's state + command + action tree.
 *   - Ref looks like a content item under workflow → item view.
 *     Current state + available transitions.
 *
 * Returns `null` (without error) if neither shape resolves.
 */
export const runWorkflowInspect = async (
  options: WorkflowInspectOptions
): Promise<WorkflowInspectResult | null> => {
  const logger = toLogger(options);
  const parsed = parseSelectorOrName(options.item);
  const { envName, client } = resolveWorkflowTenant(options);

  // Resolve a definition selector (itemId|path) for the workflow-def
  // attempt. For name lookups, walk the definition list first.
  let defSelector: ItemSelector | null = null;
  let nameDuplicates = 0;
  if (parsed.selector) {
    defSelector = parsed.selector;
  } else if (parsed.name) {
    const found = await client.findWorkflowDefinitionByName(parsed.name);
    if (found) {
      defSelector = { itemId: found.summary.itemId };
      nameDuplicates = found.duplicateMatches;
      if (nameDuplicates > 1) {
        logger.warn(
          `Found ${nameDuplicates} workflows matching '${parsed.name}' — inspecting the first (${found.summary.path}). Pass a path or GUID to disambiguate.`
        );
      }
    }
  }

  // Try the workflow-definition view first when we have a selector.
  if (defSelector) {
    const definition = await client.getWorkflowDefinitionDetail(defSelector);
    if (definition) {
      printWorkflowResult({
        logger,
        command: "workflow.inspect",
        envName,
        result: { kind: "definition", definition },
        humanLines: renderDefinitionLines(definition),
      });
      return { kind: "definition", definition };
    }
  }

  // If a name was given but no definition matched, surface a clear
  // "not found" rather than treating the name as an item ref (it's not
  // a valid GUID or path).
  if (parsed.name && !defSelector) {
    if (logger.isJson()) {
      logger.json({
        command: "workflow.inspect",
        environment: envName,
        result: null,
        reason: "no-workflow-with-that-name",
      });
    } else {
      logger.info(
        `No workflow definition matched '${parsed.name}'. Run 'scai workflow list-defs' to see what's available.`
      );
    }
    return null;
  }

  // Fall through to item-under-workflow inspection.
  const selector = parsed.selector!;
  const wf: ItemWorkflowState | null = await client.getItemWorkflow(selector);
  if (!wf) {
    if (logger.isJson()) {
      logger.json({
        command: "workflow.inspect",
        environment: envName,
        result: null,
        reason: "item-not-found-or-not-under-workflow",
      });
    } else {
      logger.info(`No workflow on ${selector.path ?? selector.itemId ?? "(unknown)"}.`);
    }
    return null;
  }
  if (!wf.workflowId) {
    throw createScaiError(`Item ${wf.itemId} returned a workflow with no workflowId.`, "UNKNOWN");
  }

  const commands = await client.getWorkflowCommandsForItem({
    workflowId: wf.workflowId,
    itemId: dashifyItemId(wf.itemId),
  });

  const itemResult: WorkflowInspectItemResult = {
    itemId: wf.itemId,
    path: wf.path,
    workflow: {
      workflowId: wf.workflowId,
      workflowName: wf.workflowName,
    },
    state: {
      stateId: wf.stateId,
      stateName: wf.stateName,
      final: wf.stateIsFinal,
    },
    availableCommands: commands,
  };

  const cmdLines =
    commands.length > 0
      ? commands.map((c) => `  - ${c.displayName} (${c.commandId})`)
      : ["  (none — terminal state or no transitions for this item)"];

  printWorkflowResult({
    logger,
    command: "workflow.inspect",
    envName,
    result: { kind: "item", item: itemResult },
    humanLines: [
      `Item:     ${wf.path ?? wf.itemId}`,
      `Workflow: ${wf.workflowName ?? "?"} (${wf.workflowId})`,
      `State:    ${wf.stateName ?? "?"}${wf.stateIsFinal ? " [final]" : ""}`,
      `Commands available:`,
      ...cmdLines,
    ],
  });

  return { kind: "item", item: itemResult };
};

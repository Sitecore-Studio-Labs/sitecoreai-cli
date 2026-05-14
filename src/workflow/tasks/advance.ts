import { ensureAllowWrite } from "@/shared/allow-write";
import { createScaiError } from "@/shared/errors";
import { resolveWorkflowCommandId } from "../api";
import {
  dashifyItemId,
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowAdvanceOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path. Required. */
  item: string;
  /** Workflow command display name (case-insensitive). Required. */
  command: string;
  /** Comment recorded with the workflow execution (audit trail). */
  comments?: string;
  /** Plan-only — don't issue the mutation. */
  whatIf?: boolean;
  /** Per-invocation write gate override (matches the `cleanup` `--allow-write` flag). */
  allowWrite?: boolean;
}

export type WorkflowAdvanceStatus =
  | "advanced"
  | "what-if"
  | "failed"
  | "skipped-no-workflow"
  | "skipped-final"
  | "skipped-no-command";

export interface WorkflowAdvanceResult {
  itemId: string | null;
  path: string | null;
  workflowName: string | null;
  fromState: string | null;
  toState: string | null;
  commandRequested: string;
  commandUsed: string | null;
  status: WorkflowAdvanceStatus;
  message?: string;
}

/**
 * Advance a single Sitecore item through one workflow transition.
 *
 * The single-item primitive — counterpart to
 * `scai cleanup workflow advance`, which sweeps stale items in batch.
 * Use this verb for surgical "push this approval through now"
 * operations; use the cleanup verb for scheduled backlog flushes.
 *
 * Gating: same `allowWrite` model as cleanup (env config /
 * `SITECOREAI_ENV_<NAME>_ALLOW_WRITE=true` / `--allow-write`).
 * `--what-if` skips the gate and reports the planned action without
 * issuing the mutation.
 */
export const runWorkflowAdvance = async (
  options: WorkflowAdvanceOptions
): Promise<WorkflowAdvanceResult> => {
  const logger = toLogger(options);
  if (!options.command) {
    throw createScaiError("--command is required.", "INPUT_INVALID");
  }
  const selector = parseItemReference(options.item);
  const { envName, root, client } = resolveWorkflowTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no workflow command will be executed.", "yellow");
  }

  const wf = await client.getItemWorkflow(selector);
  if (!wf || !wf.workflowId) {
    const result: WorkflowAdvanceResult = {
      itemId: wf?.itemId ?? null,
      path: wf?.path ?? selector.path ?? null,
      workflowName: null,
      fromState: null,
      toState: null,
      commandRequested: options.command,
      commandUsed: null,
      status: "skipped-no-workflow",
      message: `Item ${selector.path ?? selector.itemId} is not under workflow.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }
  if (wf.stateIsFinal) {
    const result: WorkflowAdvanceResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toState: null,
      commandRequested: options.command,
      commandUsed: null,
      status: "skipped-final",
      message: `Item is already in a final workflow state ('${wf.stateName ?? "?"}'); no transition needed.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  const command = await resolveWorkflowCommandId(client, {
    workflowId: wf.workflowId,
    itemId: dashifyItemId(wf.itemId),
    commandName: options.command,
  });
  if (!command) {
    const result: WorkflowAdvanceResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toState: null,
      commandRequested: options.command,
      commandUsed: null,
      status: "skipped-no-command",
      message: `Workflow '${wf.workflowName}' has no command named '${options.command}' at state '${wf.stateName ?? "?"}'. Run 'scai workflow list-commands ${selector.path ?? selector.itemId}' to see available commands.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }
  if (command.duplicateMatches > 1) {
    logger.warn(
      `Workflow '${wf.workflowName}' has ${command.duplicateMatches} commands named '${options.command}' at this state — using the first match (${command.commandId}). Disambiguate if this is wrong.`
    );
  }

  if (options.whatIf) {
    const result: WorkflowAdvanceResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toState: null,
      commandRequested: options.command,
      commandUsed: command.displayName,
      status: "what-if",
      message: `Would execute '${command.displayName}' (${command.commandId}) on ${wf.path ?? wf.itemId}.`,
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [result.message ?? ""],
    });
    return result;
  }

  try {
    const exec = await client.executeWorkflowCommand({
      commandId: command.commandId,
      itemId: dashifyItemId(wf.itemId),
      ...(options.comments !== undefined && { comments: options.comments }),
    });
    const result: WorkflowAdvanceResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toState: exec.nextStateId,
      commandRequested: options.command,
      commandUsed: command.displayName,
      status: exec.successful ? "advanced" : "failed",
      ...(exec.successful
        ? {}
        : { message: exec.message ?? "Workflow command returned successful=false." }),
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [
        exec.successful
          ? `Advanced ${wf.path ?? wf.itemId} via '${command.displayName}' — next state: ${exec.nextStateId ?? "(unspecified)"}.`
          : `Failed to advance ${wf.path ?? wf.itemId}: ${result.message}`,
      ],
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: WorkflowAdvanceResult = {
      itemId: wf.itemId,
      path: wf.path,
      workflowName: wf.workflowName,
      fromState: wf.stateName,
      toState: null,
      commandRequested: options.command,
      commandUsed: command.displayName,
      status: "failed",
      message,
    };
    printWorkflowResult({
      logger,
      command: "workflow.advance",
      envName,
      result,
      humanLines: [`Failed to advance ${wf.path ?? wf.itemId}: ${message}`],
    });
    return result;
  }
};

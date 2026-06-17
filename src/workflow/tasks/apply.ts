import { ensureAllowWrite } from "@/policy/allow-write";
import { createScaiError } from "@/shared/errors";
import type { WorkflowDefinitionDetail } from "@/workflow/api/client";
import {
  parseItemReference,
  printWorkflowResult,
  resolveWorkflowRef,
  resolveWorkflowState,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowApplyOptions extends WorkflowTaskOptions {
  /** Item GUID or content-tree path to attach the workflow to. Required. */
  item: string;
  /**
   * Workflow GUID, content-tree path, or display/item name. Required.
   * Same resolution as `runWorkflowGet`: GUID → direct, path →
   * lookup, free text → name match against `listWorkflowDefinitions`.
   */
  workflow: string;
  /**
   * Override the state to land on. Defaults to the workflow's
   * `__Initial state`. Pass either a state GUID or a state name (e.g.
   * "Draft") to start the item somewhere other than initial.
   */
  state?: string;
  /** Plan-only — don't issue the field write. */
  whatIf?: boolean;
  /** Per-invocation write gate override. */
  allowWrite?: boolean;
}

export type WorkflowApplyStatus =
  | "applied"
  | "what-if"
  | "failed"
  | "skipped-already-attached"
  | "skipped-workflow-not-found"
  | "skipped-state-not-found";

export interface WorkflowApplyResult {
  itemId: string | null;
  path: string | null;
  workflowItemId: string | null;
  workflowName: string | null;
  stateItemId: string | null;
  stateName: string | null;
  status: WorkflowApplyStatus;
  message?: string;
}

const normalizeGuid = (id: string): string => id.replace(/[{}]/g, "").toLowerCase();

const workflowLabel = (detail: WorkflowDefinitionDetail): string =>
  detail.displayName ?? detail.name;

type Logger = ReturnType<typeof toLogger>;

/** Emit a result via `printWorkflowResult` and return it unchanged. */
const emitWorkflowResult = (
  logger: Logger,
  envName: string,
  result: WorkflowApplyResult,
  humanLines?: string[]
): WorkflowApplyResult => {
  printWorkflowResult({
    logger,
    command: "workflow.apply",
    envName,
    result,
    humanLines: humanLines ?? [result.message ?? ""],
  });
  return result;
};

interface ResolvedTargetState {
  /** A short-circuit result when the requested state didn't resolve. */
  failure?: WorkflowApplyResult;
  stateId?: string;
  stateName?: string | null;
}

/** True when the item is already attached to this workflow + state. */
const isAlreadyAttached = (
  existingWf: Awaited<
    ReturnType<ReturnType<typeof resolveWorkflowTenant>["client"]["getItemWorkflow"]>
  >,
  workflowItemId: string,
  targetStateId: string
): boolean =>
  Boolean(
    existingWf &&
    existingWf.workflowId &&
    normalizeGuid(existingWf.workflowId) === normalizeGuid(workflowItemId) &&
    existingWf.stateId &&
    normalizeGuid(existingWf.stateId) === normalizeGuid(targetStateId)
  );

/**
 * Resolve the target state for the apply: an explicit `options.state`
 * (by GUID or name) or the workflow's `__Initial state`. Returns a
 * `failure` result when an explicit state name doesn't match.
 */
const resolveTargetState = async (
  options: WorkflowApplyOptions,
  client: ReturnType<typeof resolveWorkflowTenant>["client"],
  workflowDetail: WorkflowDefinitionDetail,
  itemSelector: ReturnType<typeof parseItemReference>
): Promise<ResolvedTargetState> => {
  if (options.state) {
    const stateRef = options.state.trim();
    const match = resolveWorkflowState(workflowDetail, stateRef);
    if (!match) {
      return {
        failure: {
          itemId: null,
          path: itemSelector.path ?? null,
          workflowItemId: workflowDetail.itemId,
          workflowName: workflowLabel(workflowDetail),
          stateItemId: null,
          stateName: null,
          status: "skipped-state-not-found",
          message: `Workflow '${workflowLabel(workflowDetail)}' has no state named or matching '${stateRef}'.`,
        },
      };
    }
    return { stateId: match.itemId, stateName: match.name };
  }

  const initialStateId = await client.getWorkflowInitialStateId(workflowDetail.itemId);
  if (!initialStateId) {
    throw createScaiError(
      `Workflow '${workflowLabel(workflowDetail)}' has no __Initial state set.`,
      "UNKNOWN"
    );
  }
  const initial = workflowDetail.states.find(
    (s) => normalizeGuid(s.itemId) === normalizeGuid(initialStateId)
  );
  return {
    stateId: initialStateId,
    stateName: initial?.displayName ?? initial?.name ?? null,
  };
};

/**
 * Attach a workflow to an item — sets the item's `__Workflow` and
 * `__Workflow state` fields directly via `updateItem`. Bypasses the
 * workflow engine; no submit/validation actions fire.
 *
 * Useful when content was authored before the workflow existed, or
 * when an item was orphaned by a workflow rename. For new items
 * created via recipe / CMS UX, attach the workflow via Standard
 * Values (`__Default workflow` field) on the template instead.
 *
 * The `workflow` ref accepts any of: workflow GUID, content-tree path,
 * or display/item name (resolved against `listWorkflowDefinitions`).
 * Same resolver as `workflow_inspect verb=get`.
 */
export const runWorkflowApply = async (
  options: WorkflowApplyOptions
): Promise<WorkflowApplyResult> => {
  const logger = toLogger(options);
  if (!options.workflow) {
    throw createScaiError("--workflow is required.", "INPUT_INVALID");
  }
  const itemSelector = parseItemReference(options.item);
  const { envName, root, client } = resolveWorkflowTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(root, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode — no field write will happen.", "yellow");
  }

  // Resolve workflow ref → workflow definition detail.
  const wfRef = options.workflow.trim();
  const workflowDetail = await resolveWorkflowRef(client, wfRef);
  if (!workflowDetail) {
    return emitWorkflowResult(logger, envName, {
      itemId: null,
      path: itemSelector.path ?? null,
      workflowItemId: null,
      workflowName: null,
      stateItemId: null,
      stateName: null,
      status: "skipped-workflow-not-found",
      message: `Workflow '${wfRef}' did not resolve to a Workflow-templated item.`,
    });
  }

  // Resolve target state. Default to initial state.
  const targetState = await resolveTargetState(options, client, workflowDetail, itemSelector);
  if (targetState.failure) {
    return emitWorkflowResult(logger, envName, targetState.failure);
  }
  const targetStateId = targetState.stateId as string;
  const targetStateName = targetState.stateName ?? null;
  const wfLabel = workflowLabel(workflowDetail);
  const stateLabel = targetStateName ?? "?";
  const itemLabel = itemSelector.path ?? itemSelector.itemId;

  // Idempotency: item already attached to this workflow + state.
  const existingWf = await client.getItemWorkflow(itemSelector);
  if (isAlreadyAttached(existingWf, workflowDetail.itemId, targetStateId)) {
    return emitWorkflowResult(logger, envName, {
      itemId: existingWf?.itemId ?? null,
      path: existingWf?.path ?? null,
      workflowItemId: workflowDetail.itemId,
      workflowName: wfLabel,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "skipped-already-attached",
      message: `Item already attached to workflow '${wfLabel}' at state '${stateLabel}'.`,
    });
  }

  // Resolved item/path for the remaining (write-path) result shapes, all
  // of which prefer the existing-workflow values then fall back to the
  // selector. Computed once to keep the branch bodies flat.
  const resolvedItemId = existingWf?.itemId ?? itemSelector.itemId ?? null;
  const resolvedPath = existingWf?.path ?? itemSelector.path ?? null;

  if (options.whatIf) {
    return emitWorkflowResult(logger, envName, {
      itemId: existingWf?.itemId ?? null,
      path: resolvedPath,
      workflowItemId: workflowDetail.itemId,
      workflowName: wfLabel,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "what-if",
      message: `Would attach ${itemLabel} to workflow '${wfLabel}' at state '${stateLabel}'.`,
    });
  }

  try {
    await client.setItemWorkflowState({
      ...(itemSelector.itemId ? { itemId: itemSelector.itemId } : { path: itemSelector.path }),
      workflowId: workflowDetail.itemId,
      stateId: targetStateId,
    });
    return emitWorkflowResult(logger, envName, {
      itemId: resolvedItemId,
      path: resolvedPath,
      workflowItemId: workflowDetail.itemId,
      workflowName: wfLabel,
      stateItemId: targetStateId,
      stateName: targetStateName,
      status: "applied",
      message: `Attached ${itemLabel} to workflow '${wfLabel}' at state '${stateLabel}'.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emitWorkflowResult(
      logger,
      envName,
      {
        itemId: resolvedItemId,
        path: resolvedPath,
        workflowItemId: workflowDetail.itemId,
        workflowName: wfLabel,
        stateItemId: null,
        stateName: null,
        status: "failed",
        message,
      },
      [`Failed to apply workflow: ${message}`]
    );
  }
};

import { mapWithConcurrency } from "@/shared/cli-tasks";
import { resolveEnvironment } from "@/policy/environment";
import { createScaiError } from "@/shared/errors";
import type { HygieneApiClient } from "../../api/client";
import {
  createWorkflowApiClient,
  type WorkflowApiClient,
  type WorkflowDefinitionDetail,
} from "@/workflow/api/client";
import { resolveWorkflowRef, resolveWorkflowState } from "@/workflow/tasks/shared";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  dashifyItemId,
  ensureAllowWrite,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "../shared";

export interface CleanupWorkflowApplyOptions extends HygieneCommonOptions {
  /**
   * Workflow ref — GUID, content-tree path, or display/item name.
   * Required. Same resolution as `scai content workflow apply` /
   * `scai content workflow get`.
   */
  workflow: string;
  /**
   * Optional target state ref (GUID or state name). Defaults to the
   * workflow's `__Initial state`.
   */
  state?: string;
  /**
   * Optional template filter. Accepts a Sitecore template GUID or
   * absolute content-tree path (e.g.
   * `/sitecore/templates/Foundation/Article`). When set, only items
   * whose `_template` matches are attached. Unset = every item under
   * `--root` is eligible (subject to the other filters).
   */
  template?: string;
  /**
   * When true, overwrite the assignment on items already attached to
   * any workflow. Default false — items already on a workflow are
   * skipped with status `skipped-already-attached` so the verb defaults
   * to a safe backfill.
   */
  reattach?: boolean;
  /**
   * Optional stale-days filter — only items not updated for at least
   * this many days are eligible. Unset = no recency filter.
   */
  staleDays?: number;
  /** Content root to scope. Default `/sitecore/content`. */
  root?: string;
  /** Cap on items attached per run. Default 100. */
  maxApplies?: number;
  /** Cap on items inspected. Default 5000. */
  limit?: number;
  /** Override the search index. */
  index?: string;
  /** Include `/sitecore/system` results. Off by default. */
  includeSystem?: boolean;
  pageParallelism?: number;
  concurrency?: number;
  exclude?: string[];
  since?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export type WorkflowApplyActionStatus =
  | "applied"
  | "what-if"
  | "failed"
  | "skipped-already-attached"
  | "skipped-template-mismatch";

export interface WorkflowApplyAction {
  itemId: string;
  path: string;
  templateId: string | null;
  workflowItemId: string;
  workflowName: string;
  stateItemId: string;
  stateName: string;
  status: WorkflowApplyActionStatus;
  /** Workflow currently attached, when present and we're not reattaching. */
  existingWorkflowId?: string | null;
  /** State currently attached, when present and we're not reattaching. */
  existingStateId?: string | null;
  error?: string;
}

/**
 * Bulk-attach a workflow to items under `--root`, writing `__Workflow`
 * and `__Workflow state` directly via `setItemWorkflowState`. Bypasses
 * the workflow engine: submit/validation actions on the target state
 * do NOT fire — this is a raw field write, the same one used by
 * `scai content workflow apply <item>` for the single-item case.
 *
 * Strategy:
 *   1. Resolve `--workflow` to a `WorkflowDefinitionDetail`. Resolve
 *      `--state` (or fall back to the workflow's `__Initial state`).
 *   2. Optionally resolve `--template` (path → GUID via search) for
 *      the `_template` filter clause.
 *   3. Enumerate items under `--root` via the search index, applying
 *      template / system / staleness filters in-stream.
 *   4. For each candidate, fetch its `ItemWorkflow`. If already
 *      attached to the target workflow + state, skip (idempotent). If
 *      attached to any workflow and `--reattach` is false, skip with
 *      `skipped-already-attached`. Otherwise call
 *      `setItemWorkflowState({ workflowId, stateId })`.
 *
 * Safety:
 *   - `--max-applies` caps the blast radius (default 100).
 *   - `--what-if` reports the plan without mutating.
 *   - `--allow-write` (or `allowWrite` opt) required outside `--what-if`.
 *   - `--reattach` defaults off so the verb is safe to run against
 *     mixed content — items already on a workflow stay put.
 */
export const runCleanupWorkflowApply = async (
  options: CleanupWorkflowApplyOptions
): Promise<WorkflowApplyAction[]> => {
  const logger = toLogger(options);
  if (!options.workflow) {
    throw createScaiError("--workflow is required.", "INPUT_INVALID");
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWrite(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no workflow attachments will be written.", "yellow");
  }

  // Build a workflow API client off the same resolved environment as the
  // hygiene client so both share the request timeout config.
  const { environment, timeoutMs } = resolveEnvironment(options);
  const workflowClient: WorkflowApiClient = createWorkflowApiClient({
    environment,
    request: { timeoutMs },
  });

  // Phase 0: resolve workflow + target state.
  const workflowDetail = await resolveWorkflowRef(workflowClient, options.workflow);
  if (!workflowDetail) {
    throw createScaiError(
      `Workflow '${options.workflow}' did not resolve to a Workflow-templated item.`,
      "INPUT_INVALID",
      {
        hint: "Pass a workflow GUID, content-tree path under /sitecore/system/Workflows, or the workflow's display/item name (case-insensitive).",
      }
    );
  }
  const { stateId: targetStateId, stateName: targetStateName } = await resolveTargetState(
    workflowClient,
    workflowDetail,
    options.state
  );

  // Phase 1: optional template filter — resolve path → GUID once.
  const root = options.root ?? "/sitecore/content";
  let templateId: string | null = null;
  if (options.template) {
    templateId = await resolveTemplateRef(client, options.template, options.index);
    if (!templateId) {
      throw createScaiError(
        `--template '${options.template}' did not resolve to a template item.`,
        "INPUT_INVALID",
        {
          hint: "Pass a Sitecore template GUID or an absolute content-tree path under /sitecore/templates.",
        }
      );
    }
  }

  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;
  const maxApplies = options.maxApplies ?? 100;
  const includeSystem = Boolean(options.includeSystem);
  const staleDays = options.staleDays;
  const cutoff =
    staleDays !== undefined && staleDays > 0 ? Date.now() - staleDays * 24 * 60 * 60 * 1000 : null;

  // Phase 2: resolve root → itemId for the `_path` filter.
  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  // Phase 3: enumerate candidates with the strongest filter we can push
  // into the search index — `_path` contains rootItemId AND (optionally)
  // `_template` matches the resolved templateId. The staleness / system
  // path filters run in-stream because the search field grammar doesn't
  // expose them uniformly across tenants.
  const searchStatement = buildCandidateStatement(rootItemId, templateId);

  type Candidate = { itemId: string; path: string; templateId: string | null };
  const candidates: Candidate[] = [];
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(searchStatement ? { searchStatement } : {}),
    },
    100,
    knobs.pageParallelism
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    scanned += 1;
    if (cutoff !== null) {
      if (!r.updatedDate) continue;
      const t = Date.parse(r.updatedDate);
      if (!Number.isFinite(t) || t >= cutoff) continue;
    }
    candidates.push({
      itemId: normalizeItemId(r.itemId),
      path: r.path,
      templateId: r.templateId ?? null,
    });
    if (candidates.length >= (options.limit ?? 5000)) break;
  }
  logger.verbose(`Scanned ${scanned} items; ${candidates.length} candidates.`);

  // Phase 4: per-candidate idempotency check + write.
  const targetWorkflowGuid = normalizeItemId(workflowDetail.itemId);
  const targetStateGuid = normalizeItemId(targetStateId);

  const actions: WorkflowApplyAction[] = (
    await mapWithConcurrency(
      candidates,
      async (c, idx): Promise<WorkflowApplyAction | null> => {
        if (idx >= maxApplies) return null;

        const existingWf = await workflowClient.getItemWorkflow({ itemId: c.itemId });
        const existingWorkflowGuid = existingWf?.workflowId
          ? normalizeItemId(existingWf.workflowId)
          : null;
        const existingStateGuid = existingWf?.stateId ? normalizeItemId(existingWf.stateId) : null;

        // Already on the target workflow + state — idempotent skip.
        if (existingWorkflowGuid === targetWorkflowGuid && existingStateGuid === targetStateGuid) {
          return {
            itemId: c.itemId,
            path: c.path,
            templateId: c.templateId,
            workflowItemId: workflowDetail.itemId,
            workflowName: workflowDetail.displayName ?? workflowDetail.name,
            stateItemId: targetStateId,
            stateName: targetStateName,
            status: "skipped-already-attached",
            existingWorkflowId: existingWorkflowGuid,
            existingStateId: existingStateGuid,
          };
        }

        // Attached to a different workflow and we're not reattaching.
        if (
          existingWorkflowGuid &&
          existingWorkflowGuid !== targetWorkflowGuid &&
          !options.reattach
        ) {
          return {
            itemId: c.itemId,
            path: c.path,
            templateId: c.templateId,
            workflowItemId: workflowDetail.itemId,
            workflowName: workflowDetail.displayName ?? workflowDetail.name,
            stateItemId: targetStateId,
            stateName: targetStateName,
            status: "skipped-already-attached",
            existingWorkflowId: existingWorkflowGuid,
            existingStateId: existingStateGuid,
          };
        }

        if (options.whatIf) {
          return {
            itemId: c.itemId,
            path: c.path,
            templateId: c.templateId,
            workflowItemId: workflowDetail.itemId,
            workflowName: workflowDetail.displayName ?? workflowDetail.name,
            stateItemId: targetStateId,
            stateName: targetStateName,
            status: "what-if",
            existingWorkflowId: existingWorkflowGuid,
            existingStateId: existingStateGuid,
          };
        }

        try {
          await workflowClient.setItemWorkflowState({
            itemId: dashifyItemId(c.itemId),
            workflowId: workflowDetail.itemId,
            stateId: targetStateId,
          });
          return {
            itemId: c.itemId,
            path: c.path,
            templateId: c.templateId,
            workflowItemId: workflowDetail.itemId,
            workflowName: workflowDetail.displayName ?? workflowDetail.name,
            stateItemId: targetStateId,
            stateName: targetStateName,
            status: "applied",
            existingWorkflowId: existingWorkflowGuid,
            existingStateId: existingStateGuid,
          };
        } catch (error) {
          return {
            itemId: c.itemId,
            path: c.path,
            templateId: c.templateId,
            workflowItemId: workflowDetail.itemId,
            workflowName: workflowDetail.displayName ?? workflowDetail.name,
            stateItemId: targetStateId,
            stateName: targetStateName,
            status: "failed",
            existingWorkflowId: existingWorkflowGuid,
            existingStateId: existingStateGuid,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      concurrency
    )
  ).filter((a): a is WorkflowApplyAction => a !== null);

  const applied = actions.filter((a) => a.status === "applied").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const skippedAttached = actions.filter((a) => a.status === "skipped-already-attached").length;
  const summary = options.whatIf
    ? `Plan: would attach ${actions.filter((a) => a.status === "what-if").length} item(s) to '${workflowDetail.displayName ?? workflowDetail.name}' at '${targetStateName}'.`
    : `Attached ${applied}, ${failed} failed, ${skippedAttached} already attached.`;

  printReport({
    logger,
    command: "cleanup.workflow.apply",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would attach] " : a.status === "failed" ? "[failed] " : a.status === "skipped-already-attached" ? "[skipped] " : ""}${a.path} — ${a.workflowName}/${a.stateName}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      root,
      workflow: workflowDetail.displayName ?? workflowDetail.name,
      workflowItemId: workflowDetail.itemId,
      state: targetStateName,
      stateItemId: targetStateId,
      template: options.template ?? null,
      templateId,
      reattach: Boolean(options.reattach),
      staleDays: staleDays ?? null,
      whatIf: Boolean(options.whatIf),
      maxApplies,
      scannedCount: scanned,
      appliedCount: applied,
      failedCount: failed,
      skippedAlreadyAttachedCount: skippedAttached,
    },
    options,
  });

  return actions;
};

const resolveTargetState = async (
  client: WorkflowApiClient,
  workflow: WorkflowDefinitionDetail,
  stateRef: string | undefined
): Promise<{ stateId: string; stateName: string }> => {
  if (stateRef) {
    const match = resolveWorkflowState(workflow, stateRef);
    if (!match) {
      throw createScaiError(
        `Workflow '${workflow.displayName ?? workflow.name}' has no state matching '${stateRef}'.`,
        "INPUT_INVALID",
        {
          hint: `Available states: ${workflow.states.map((s) => s.displayName ?? s.name).join(", ")}.`,
        }
      );
    }
    return { stateId: match.itemId, stateName: match.name };
  }
  const initialStateId = await client.getWorkflowInitialStateId(workflow.itemId);
  if (!initialStateId) {
    throw createScaiError(
      `Workflow '${workflow.displayName ?? workflow.name}' has no __Initial state set.`,
      "UNKNOWN"
    );
  }
  const initial = workflow.states.find(
    (s) => normalizeItemId(s.itemId) === normalizeItemId(initialStateId)
  );
  return {
    stateId: initialStateId,
    stateName: initial?.displayName ?? initial?.name ?? "(initial)",
  };
};

/**
 * Resolve a template ref to its itemId. Accepts a GUID directly or an
 * absolute content-tree path (looked up via the search index). Returns
 * `null` when the path doesn't resolve.
 */
const resolveTemplateRef = async (
  client: HygieneApiClient,
  ref: string,
  index: string | undefined
): Promise<string | null> => {
  const trimmed = ref.trim();
  if (/^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i.test(trimmed)) {
    return normalizeItemId(trimmed);
  }
  if (!trimmed.startsWith("/sitecore/")) {
    return null;
  }
  const r = await client.search({
    index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: trimmed.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  return r.results[0]?.itemId ? normalizeItemId(r.results[0]!.itemId) : null;
};

const buildCandidateStatement = (
  rootItemId: string | undefined,
  templateId: string | null
):
  | {
      operator?: "MUST";
      criteria?: { field: string; value: string; criteriaType: "EXACT" | "CONTAINS" };
      subStatements?: Array<{
        criteria: { field: string; value: string; criteriaType: "EXACT" | "CONTAINS" };
      }>;
    }
  | undefined => {
  const clauses: Array<{
    criteria: { field: string; value: string; criteriaType: "EXACT" | "CONTAINS" };
  }> = [];
  if (rootItemId) {
    clauses.push(
      buildPathFilterStatement(rootItemId) as {
        criteria: { field: string; value: string; criteriaType: "CONTAINS" };
      }
    );
  }
  if (templateId) {
    clauses.push({
      criteria: {
        field: "_template",
        value: normalizeItemId(templateId),
        criteriaType: "EXACT",
      },
    });
  }
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0]!;
  return { operator: "MUST", subStatements: clauses };
};

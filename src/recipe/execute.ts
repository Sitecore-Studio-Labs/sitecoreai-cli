import { createCliError } from "@/shared/errors";
import type { AuthoringApiClient } from "./api/client";
import type { SitesApiClient } from "./api/sites-client";
import type { OperationIr } from "./ir/operations";
import {
  buildAction,
  buildPlan,
  type Plan,
  type PlanEvent,
  type PlannedAction,
  type PlanSummary,
} from "./plan";
import { rollback, type RollbackError, type RollbackEvent, type RollbackResult } from "./rollback";

/**
 * `scai recipe push` and `scai recipe plan` share the same per-op
 * read-then-diff loop. Apply mode interleaves plan-and-apply: each op's
 * plan sees the cascading effect of earlier ops' applies — required for
 * idempotency.
 *
 * **Captured-itemId map.** Sitecore's Authoring API server-assigns
 * itemIds on `createItem`. The IR uses recipe-internal uuidv5 refKeys
 * for cross-references (parents, datasource template, params template,
 * insertOptions, etc.). Each push maintains a `capturedItemIds: Map<refKey,
 * sitecoreItemId>`:
 *   - Populated from `getItem(by path)` when the planner finds an
 *     existing item.
 *   - Populated from `createItem` responses when the executor creates
 *     a new item.
 *   - Read by `resolveRecipeRefs` to substitute ref-recipe values into
 *     concrete GUID strings before mutations dispatch.
 *
 * On apply error: forward execution stops and `rollback` runs over the
 * already-applied actions in LIFO order. Snapshots captured at plan time
 * drive the inverse mutations.
 */

export type ExecutionMode = "plan" | "apply";

export interface ExecutionFailedEvent {
  kind: "failed";
  failedAt: number;
  applied: number;
  rolledBack: number;
  rollbackErrors: RollbackError[];
  /** The planning or apply error that triggered the rollback. */
  error: string;
}

export type ExecutionEvent =
  | PlanEvent
  | RollbackEvent
  | { kind: "apply-start"; action: PlannedAction }
  | { kind: "apply-success"; action: PlannedAction }
  | { kind: "apply-error"; action: PlannedAction; error: string }
  /**
   * Emitted on each Sites API job poll while waiting for an async op
   * (createSite, deleteSite). Lets operators and orchestrators see
   * progress on long-running jobs (cold tenants can take >30s) instead
   * of staring at a silent CLI.
   */
  | {
      kind: "site-job-poll";
      jobHandle: string;
      /** Normalized phase string read from `Job.state ?? Job.status`. */
      phase: string;
      /** Milliseconds elapsed since polling began. */
      elapsedMs: number;
    }
  | ExecutionFailedEvent;

export interface ExecutionResult {
  plan: Plan;
  summary: PlanSummary;
  /** True when push aborted before all ops were dispatched. */
  aborted: boolean;
  /** Present only when the apply phase aborted; tracks the rollback outcome. */
  rollback?: RollbackResult;
}

export interface ExecuteOptions {
  mode: ExecutionMode;
  emit?: (event: ExecutionEvent) => void;
  /**
   * Cross-recipe ref pre-seed: `refKey → expectedPath` for items
   * produced by OTHER recipes in the same workspace. The executor
   * walks this map at start, calls `getItem({path})` for each entry,
   * and if found seeds `capturedItemIds` so the planner can resolve
   * `ref-recipe` / `ref-recipe-list` / `ref-source-fields` values
   * pointing at items the current recipe doesn't itself produce
   * (e.g. accordion-block's `insertOptions: ["accordion-item@1"]`).
   *
   * Entries whose path doesn't yet exist on the tenant are silently
   * skipped — those are first-push cross-recipe refs that need the
   * producer recipe to land first. Push a second time once producers
   * land, or order recipes topologically.
   */
  crossRecipeRefs?: ReadonlyMap<string, string>;
  /**
   * Sites API client — required when the IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets without SiteRecipes can
   * pass undefined; site ops without a client produce an `error`
   * action at plan time and don't dispatch.
   */
  sitesClient?: SitesApiClient;
}

/**
 * Wait for an async Sites API job (createSite, deleteSite, etc.) to
 * reach a terminal state. The Sites API's `getJobStatus` returns
 * a Job whose `state` field carries the lifecycle ("Initial",
 * "Running", "Done", "Failed"). Poll with linear backoff until
 * terminal or until we exceed a generous wall-clock budget.
 *
 * Site creation is typically a few seconds on warm tenants, but cold
 * tenants and content-tree-heavy SiteTemplates can take significantly
 * longer. The 90s budget covers worst-case sandbox cold-starts; in
 * production we'd surface a slow-job event so operators see progress.
 */
const SITES_JOB_POLL_BUDGET_MS = 90_000;
const SITES_JOB_POLL_INTERVAL_MS = 1_000;

const awaitSitesJob = async (
  sitesClient: SitesApiClient,
  jobHandle: string,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
  const start = Date.now();
  const deadline = start + SITES_JOB_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    const job = await sitesClient.getJobStatus(jobHandle);
    // Sites API deployments return either `state` (runtime) or `status`
    // (OpenAPI-spec) — accept either. See `Job` type in src/sites/api/jobs.ts.
    const phase = job.state ?? job.status ?? "";
    emit?.({ kind: "site-job-poll", jobHandle, phase, elapsedMs: Date.now() - start });
    if (phase === "Done" || phase === "Completed" || phase === "Succeeded") {
      return;
    }
    if (phase === "Failed" || phase === "Errored") {
      throw createCliError(
        `Sites API job ${jobHandle} reported terminal state '${phase}'.`,
        "SITES_API_FAILED"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SITES_JOB_POLL_INTERVAL_MS));
  }
  throw createCliError(
    `Sites API job ${jobHandle} did not finish within ${SITES_JOB_POLL_BUDGET_MS}ms.`,
    "SITES_API_FAILED"
  );
};

const dispatchMutation = async (
  client: AuthoringApiClient,
  sitesClient: SitesApiClient | undefined,
  action: PlannedAction,
  capturedItemIds: Map<string, string>,
  emit?: (event: ExecutionEvent) => void
): Promise<void> => {
  if (!action.mutation) return;
  if (action.mutation.kind === "createItem") {
    const result = await client.createItem(action.mutation.input);
    // Capture the assigned itemId so subsequent ops can resolve refs.
    if (action.operation.op === "CreateItem") {
      capturedItemIds.set(action.operation.id, result.itemId);
    }
    return;
  }
  if (action.mutation.kind === "updateItem") {
    await client.updateItem(action.mutation.input);
    return;
  }
  // createSite: dispatch through Sites API, await the async job, then
  // look up the materialised site by name to capture its itemId so
  // subsequent SetField overrides (dictionary, taxonomy) targeting
  // items under the site can resolve via late-path seeding.
  if (!sitesClient) {
    throw createCliError(
      "createSite mutation requires a SitesApiClient — none threaded into the executor.",
      "UNKNOWN"
    );
  }
  const { input, siteRefKey } = action.mutation;
  const jobResponse = await sitesClient.createSite(input);
  const jobHandle = jobResponse.handle ?? jobResponse.jobHandle;
  if (!jobHandle) {
    throw createCliError(
      `createSite for '${input.siteName}' returned a JobResponse with no handle: ${JSON.stringify(jobResponse)}`,
      "SITES_API_FAILED"
    );
  }
  await awaitSitesJob(sitesClient, jobHandle, emit);
  // Re-list and capture the new site's itemId. The Sites API doesn't
  // return the materialised site object from createSite directly —
  // listSites is the canonical way to get the assigned id.
  const sites = await sitesClient.listSites();
  const created = sites.find((s) => s.name === input.siteName);
  if (created?.id) {
    capturedItemIds.set(siteRefKey, created.id);
  } else {
    throw createCliError(
      `createSite for '${input.siteName}' completed but the site is not present in listSites — cannot capture itemId.`,
      "SITES_API_FAILED"
    );
  }
};

const buildResult = (
  ir: OperationIr,
  actions: PlannedAction[],
  summary: PlanSummary,
  aborted: boolean,
  rollbackResult?: RollbackResult
): ExecutionResult => ({
  plan: { schemaVersion: "1", recipeHandle: ir.recipeHandle, actions, summary },
  summary,
  aborted,
  rollback: rollbackResult,
});

const runRollback = async (
  applied: PlannedAction[],
  client: AuthoringApiClient,
  capturedItemIds: ReadonlyMap<string, string>,
  options: ExecuteOptions
): Promise<RollbackResult> => rollback(applied, client, capturedItemIds, { emit: options.emit });

const emitFailed = (
  options: ExecuteOptions,
  failedAt: number,
  applied: PlannedAction[],
  rollbackResult: RollbackResult,
  error: string
): void => {
  options.emit?.({
    kind: "failed",
    failedAt,
    applied: applied.length,
    rolledBack: rollbackResult.rolledBack,
    rollbackErrors: rollbackResult.errors,
    error,
  });
};

/**
 * Look up each cross-recipe ref's expected path on the tenant; capture
 * any that exist. Skips refs the current IR produces (those land via
 * dispatchMutation as the current recipe applies). Best-effort: a
 * missing item is fine — that ref won't resolve, the dependent op will
 * skip with a clear "refKey ... not in captured map" error.
 */
const seedCrossRecipeRefs = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  refs: ReadonlyMap<string, string>,
  capturedItemIds: Map<string, string>
): Promise<void> => {
  const ownRefs = new Set<string>();
  for (const op of ir.operations) {
    if (op.op === "CreateItem") ownRefs.add(op.id);
  }
  for (const [refKey, expectedPath] of refs) {
    if (ownRefs.has(refKey)) continue;
    if (capturedItemIds.has(refKey)) continue;
    const remote = await client.getItem({ path: expectedPath });
    if (remote) capturedItemIds.set(refKey, remote.itemId);
  }
};

export const executeIr = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: ExecuteOptions
): Promise<ExecutionResult> => {
  if (options.mode === "plan") {
    const capturedItemIds = new Map<string, string>();
    if (options.crossRecipeRefs) {
      await seedCrossRecipeRefs(ir, client, options.crossRecipeRefs, capturedItemIds);
    }
    const plan = await buildPlan(ir, client, {
      emit: options.emit,
      capturedItemIds,
      sitesClient: options.sitesClient,
    });
    return { plan, summary: plan.summary, aborted: false };
  }

  const actions: PlannedAction[] = [];
  const applied: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0 };
  const capturedItemIds = new Map<string, string>();
  if (options.crossRecipeRefs) {
    await seedCrossRecipeRefs(ir, client, options.crossRecipeRefs, capturedItemIds);
  }

  for (let index = 0; index < ir.operations.length; index += 1) {
    const op = ir.operations[index];
    options.emit?.({ kind: "op-start", index, operation: op });

    let action: PlannedAction;
    try {
      action = await buildAction(index, op, client, capturedItemIds, options.sitesClient);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = { index, operation: op, status: "error", reason: message };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
      summary.error += 1;
      actions.push(action);
      const rollbackResult = await runRollback(applied, client, capturedItemIds, options);
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }

    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });

    if (!action.mutation) continue;

    options.emit?.({ kind: "apply-start", action });
    try {
      await dispatchMutation(client, options.sitesClient, action, capturedItemIds, options.emit);
      applied.push(action);
      options.emit?.({ kind: "apply-success", action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.emit?.({ kind: "apply-error", action, error: message });
      const rollbackResult = await runRollback(applied, client, capturedItemIds, options);
      emitFailed(options, index, applied, rollbackResult, message);
      return buildResult(ir, actions, summary, true, rollbackResult);
    }
  }

  return buildResult(ir, actions, summary, false);
};

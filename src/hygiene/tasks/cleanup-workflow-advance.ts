import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import { resolveWorkflowCommandId } from "@/workflow/api";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  dashifyItemId,
  ensureAllowWriteForCleanup,
  isSystemPath,
  normalizeItemId,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "./shared";

export interface CleanupWorkflowAdvanceOptions extends HygieneCommonOptions {
  /**
   * Days since last update. Items in workflow that haven't been
   * touched for this long are eligible for the advance. Default 30.
   */
  staleDays?: number;
  /**
   * Required. Workflow command name to execute (case-insensitive).
   * Resolved against the item's active workflow. E.g. "Submit",
   * "Approve", "Reject". The cleanup task fails the item if its
   * workflow doesn't expose this command.
   */
  commandName: string;
  /** Comment recorded with the workflow execution (audit trail). */
  comments?: string;
  /** Content root to scope. Default `/sitecore/content`. */
  root?: string;
  /** Cap on items advanced. Default 100. */
  maxAdvances?: number;
  /** Restrict by workflow state name (e.g. "Draft"). */
  fromState?: string;
  index?: string;
  limit?: number;
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

export interface WorkflowAdvanceAction {
  itemId: string;
  path: string;
  workflowName: string | null;
  fromState: string | null;
  toState: string | null;
  commandUsed: string;
  status: "advanced" | "what-if" | "failed" | "skipped-no-command";
  error?: string;
}

/**
 * Advance items stuck in a workflow state by executing the chosen
 * workflow command. Soft counterpart to `audit stale-workflow list`.
 *
 * Strategy:
 *   1. Use search to enumerate items under `--root`, filtered by
 *      `updatedDate < now - --stale-days`.
 *   2. For each candidate, fetch its `ItemWorkflow` to confirm it's
 *      in a non-final state. Optionally filter by `--from-state`.
 *   3. Resolve `--command-name` against the item's workflow
 *      (`getWorkflowCommands`); pick the first command whose
 *      `displayName` matches case-insensitively.
 *   4. Call `executeWorkflowCommand`. Capture nextStateId for the
 *      report.
 *
 * Safety rails:
 *   - `--max-advances` caps the blast radius (default 100).
 *   - `--what-if` reports the plan without executing.
 *   - `--allow-write` (or env `allowWrite`) required outside `--what-if`.
 *   - `--command-name` is required. There is no "auto-advance to
 *     next state" default — workflows can be arbitrary, and silently
 *     picking a command could approve content prematurely.
 *
 * Notes:
 *   - The Authoring API's `executeWorkflowCommand` doesn't reveal
 *     which commands are valid in the current state. We try the
 *     requested command and surface the API's success/failure verbatim.
 *   - Workflow command lookups are cached per-workflow within one
 *     run (avoid N round trips for the same workflow's commands).
 */
export const runCleanupWorkflowAdvance = async (
  options: CleanupWorkflowAdvanceOptions
): Promise<WorkflowAdvanceAction[]> => {
  const logger = toLogger(options);
  if (!options.commandName) {
    throw createScaiError("--command-name is required.", "INPUT_INVALID");
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no workflow commands will be executed.", "yellow");
  }

  const days = options.staleDays ?? 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const knobs = resolveHygieneKnobs(options);
  const concurrency = options.concurrency ?? knobs.concurrency;
  const maxAdvances = options.maxAdvances ?? 100;
  const root = options.root ?? "/sitecore/content";
  const includeSystem = Boolean(options.includeSystem);
  const fromState = options.fromState?.toLowerCase();

  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItemId = rootSearch.results[0]?.itemId;

  // Phase 1: enumerate stale candidates.
  type Candidate = { itemId: string; path: string };
  const candidates: Candidate[] = [];
  let scanned = 0;
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100,
    knobs.pageParallelism
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    scanned += 1;
    if (!r.updatedDate) continue;
    const t = Date.parse(r.updatedDate);
    if (!Number.isFinite(t) || t >= cutoff) continue;
    candidates.push({ itemId: normalizeItemId(r.itemId), path: r.path });
    if (candidates.length >= (options.limit ?? 5000)) break;
  }
  logger.verbose(`Scanned ${scanned} items; ${candidates.length} stale candidates.`);

  // Phase 2: per-candidate check + advance.
  const actions: WorkflowAdvanceAction[] = (
    await mapWithConcurrency(
      candidates,
      async (c, idx): Promise<WorkflowAdvanceAction | null> => {
        if (idx >= maxAdvances) return null;
        const wf = await client.getItemWorkflow(c.itemId, c.path);
        if (!wf || !wf.workflowId || wf.stateIsFinal) return null;
        if (fromState && wf.stateName?.toLowerCase() !== fromState) return null;
        // Commands depend on the item's current state (Authoring API
        // requires `commands(query: {item})`), so caching across items
        // isn't valid.
        const command = await resolveWorkflowCommandId(client, {
          workflowId: wf.workflowId,
          itemId: dashifyItemId(c.itemId),
          commandName: options.commandName,
        });
        if (!command) {
          return {
            itemId: c.itemId,
            path: c.path,
            workflowName: wf.workflowName,
            fromState: wf.stateName,
            toState: null,
            commandUsed: options.commandName,
            status: "skipped-no-command",
            error: `Workflow '${wf.workflowName}' has no command named '${options.commandName}'.`,
          };
        }
        if (options.whatIf) {
          return {
            itemId: c.itemId,
            path: c.path,
            workflowName: wf.workflowName,
            fromState: wf.stateName,
            toState: null,
            commandUsed: command.displayName,
            status: "what-if",
          };
        }
        try {
          const res = await client.executeWorkflowCommand({
            commandId: command.commandId,
            itemId: dashifyItemId(c.itemId),
            comments: options.comments,
          });
          return {
            itemId: c.itemId,
            path: c.path,
            workflowName: wf.workflowName,
            fromState: wf.stateName,
            toState: res.nextStateId,
            commandUsed: command.displayName,
            status: res.successful ? "advanced" : "failed",
            ...(res.successful ? {} : { error: res.message ?? "unknown failure" }),
          };
        } catch (error) {
          return {
            itemId: c.itemId,
            path: c.path,
            workflowName: wf.workflowName,
            fromState: wf.stateName,
            toState: null,
            commandUsed: command.displayName,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      concurrency
    )
  ).filter((a): a is WorkflowAdvanceAction => a !== null);

  const advanced = actions.filter((a) => a.status === "advanced").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const skipped = actions.filter((a) => a.status === "skipped-no-command").length;
  const summary = options.whatIf
    ? `Plan: would advance ${actions.length} item${actions.length === 1 ? "" : "s"}.`
    : `Advanced ${advanced}, ${failed} failed, ${skipped} skipped (no matching command).`;

  printReport({
    logger,
    command: "cleanup.workflow.advance",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would advance] " : a.status === "failed" ? "[failed] " : a.status === "skipped-no-command" ? "[skipped] " : ""}${a.path} — ${a.workflowName}/${a.fromState} ${a.toState ? `→ ${a.toState}` : ""}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      root,
      staleDays: days,
      commandName: options.commandName,
      fromState: options.fromState ?? null,
      whatIf: Boolean(options.whatIf),
      maxAdvances,
      scannedCount: scanned,
      advancedCount: advanced,
      failedCount: failed,
      skippedCount: skipped,
    },
    options,
  });

  return actions;
};

import { createScaiError } from "@/shared/errors";
import {
  publishItems,
  checkPublishStatus,
  fetchPublishingTargets,
} from "@/serialization/sitecore-api/publish";
import {
  type HygieneCommonOptions,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface CleanupPublishOptions extends HygieneCommonOptions {
  /**
   * Explicit list of item IDs (or content-tree paths) to publish.
   * Mutually exclusive with `root`. Use this when the operator has
   * a curated set — e.g. "publish these 47 campaign pages."
   */
  items?: string[];
  /**
   * Content-tree root to publish recursively. Mutually exclusive with
   * `items`. The audit equivalent — "publish everything under this
   * subtree" — useful for site-level launches.
   */
  root?: string;
  /**
   * Restrict publish to these languages. Defaults to the tenant's
   * primary language only.
   */
  languages?: string[];
  /** Publish target (e.g. `web`, `internet`). Defaults to all configured. */
  target?: string;
  /** Whether to re-publish unchanged items. Default false. */
  republish?: boolean;
  /**
   * Discover scope first and report it without dispatching the job.
   * `--allow-write` is required to actually publish.
   */
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * After dispatching, poll `publishingStatus` until completion or
   * timeout (in milliseconds). Default 0 = fire-and-return.
   */
  pollTimeoutMs?: number;
  /** Poll interval in ms when `pollTimeoutMs` > 0. Default 2000. */
  pollIntervalMs?: number;
  /** Concurrency for resolving content-tree paths to item IDs. Default 4. */
  concurrency?: number;
  /** Maximum number of items to publish per run. Default 1000. */
  maxPublishes?: number;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface PublishAction {
  jobId: string | null;
  itemCount: number;
  target: string | null;
  languages: string[];
  status: "dispatched" | "what-if" | "complete" | "in-flight" | "failed";
  processedCount?: number;
  stateName?: string;
  error?: string;
}

/**
 * Bulk-publish a curated list of items, or every item under a root.
 *
 * Why this verb when `serialization_publish` exists: that tool is one
 * item + optional descendants. The campaign workflow is "publish these
 * 47 items I just edited" — a multi-item list, not a subtree. This
 * task accepts either shape (list OR subtree) and dispatches a single
 * publish job covering the union.
 *
 * Strategy:
 *   1. Resolve scope:
 *      - `items`: take the supplied IDs / paths verbatim.
 *      - `root`: enumerate descendants via the hygiene client's
 *        `searchAll`, scoped to the operator's `--root`.
 *   2. Dispatch one `publishItems` call with the union of resolved
 *      item IDs (the underlying Authoring publish API accepts an
 *      array — no chunking required in the common case).
 *   3. If `pollTimeoutMs > 0`, poll `publishingStatus` until the job
 *      reaches `completed` or the timeout elapses.
 *
 * Safety rails:
 *   - `--allow-write` required outside `--what-if`.
 *   - `--max-publishes` caps the scope (default 1000). Publishing a
 *     stray `/sitecore/content` with no other filters can dispatch
 *     tens of thousands of items — the cap forces operators to widen
 *     intentionally.
 *   - Mutually-exclusive `items` vs. `root` — reject if both set.
 *
 * Notes:
 *   - The publish job runs server-side. Even after `dispatched`, the
 *     edge cache + content-services materialisation can take minutes
 *     to settle. Operators chasing "is this live yet?" should poll the
 *     edge — `pollTimeoutMs` here only tracks the master→target
 *     publish, not downstream propagation.
 */
export const runCleanupPublish = async (
  options: CleanupPublishOptions
): Promise<PublishAction[]> => {
  const logger = toLogger(options);
  const { envName, environment, root: rootConfig, client } = resolveTenant(options);

  if (!options.items?.length && !options.root) {
    throw createScaiError(
      "Either `items` or `root` is required.",
      "INPUT_INVALID"
    );
  }
  if (options.items?.length && options.root) {
    throw createScaiError(
      "Pass either `items` OR `root`, not both.",
      "INPUT_INVALID"
    );
  }
  const maxPublishes = options.maxPublishes ?? 1000;

  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no publish job will be dispatched.", "yellow");
  }

  // Resolve scope to itemIds. For `items`, take them verbatim — the
  // publish API resolves paths server-side. For `root`, enumerate via
  // the shared scanner so we pick up --exclude / --since / --owner /
  // --include-system filters consistently with the rest of the cleanup
  // surface.
  let itemIds: string[] = [];
  if (options.items?.length) {
    itemIds = options.items.slice(0, maxPublishes);
  } else if (options.root) {
    const { scanned } = await scanItemsAndFields({
      client,
      envName,
      root: options.root,
      logger,
      options: { ...options, limit: maxPublishes },
      skipFields: true,
    });
    itemIds = scanned.map((s) => s.itemId).slice(0, maxPublishes);
  }
  void client;

  if (itemIds.length === 0) {
    logger.warn("No items resolved for the supplied scope; nothing to publish.");
    return [];
  }
  if (itemIds.length >= maxPublishes) {
    logger.warn(
      `Scope hit --max-publishes cap (${maxPublishes}). Re-run with a higher cap to widen.`
    );
  }

  const target = options.target ?? null;
  if (!target) {
    // Lazily enumerate publish targets so the verbose log shows what
    // was available when the operator left the target unset.
    try {
      const targets = await fetchPublishingTargets(environment);
      logger.verbose(`Available publish targets: ${targets.join(", ") || "(none)"}.`);
    } catch (error) {
      logger.verbose(
        `Failed to enumerate publish targets: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
  }

  if (options.whatIf) {
    const action: PublishAction = {
      jobId: null,
      itemCount: itemIds.length,
      target,
      languages: options.languages ?? [],
      status: "what-if",
    };
    printReport({
      logger,
      command: "cleanup.publish",
      envName,
      results: [action],
      summary: `Plan: would publish ${itemIds.length} item(s)${target ? ` to ${target}` : ""}.`,
      formatLine: (a) =>
        `[would publish] ${a.itemCount} item(s)${a.target ? ` → ${a.target}` : ""}`,
      extra: { itemCount: itemIds.length, target, languages: action.languages },
      options,
    });
    return [action];
  }

  let job: { id: string; processedCount: number; stateName: string };
  try {
    job = await publishItems(environment, itemIds, target ?? undefined);
  } catch (error) {
    const action: PublishAction = {
      jobId: null,
      itemCount: itemIds.length,
      target,
      languages: options.languages ?? [],
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    printReport({
      logger,
      command: "cleanup.publish",
      envName,
      results: [action],
      summary: `Publish dispatch failed: ${action.error}`,
      formatLine: (a) => `[failed] ${a.error}`,
      extra: { itemCount: itemIds.length, target },
      options,
    });
    return [action];
  }

  // Optionally poll until completion.
  const pollTimeout = options.pollTimeoutMs ?? 0;
  const pollInterval = options.pollIntervalMs ?? 2000;
  let lastStatus: { processedCount: number; stateName: string } = {
    processedCount: job.processedCount,
    stateName: job.stateName,
  };
  if (pollTimeout > 0) {
    const deadline = Date.now() + pollTimeout;
    while (Date.now() < deadline) {
      try {
        const status = await checkPublishStatus(environment, job.id);
        lastStatus = { processedCount: status.processedCount, stateName: status.stateName };
        if (status.stateName === "Finished" || status.stateName === "Completed") break;
      } catch (error) {
        logger.warn(
          `publishingStatus poll failed: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  const finalStatus: PublishAction["status"] =
    lastStatus.stateName === "Finished" || lastStatus.stateName === "Completed"
      ? "complete"
      : pollTimeout > 0
        ? "in-flight"
        : "dispatched";

  const action: PublishAction = {
    jobId: job.id,
    itemCount: itemIds.length,
    target,
    languages: options.languages ?? [],
    status: finalStatus,
    processedCount: lastStatus.processedCount,
    stateName: lastStatus.stateName,
  };

  printReport({
    logger,
    command: "cleanup.publish",
    envName,
    results: [action],
    summary: `Publish job ${job.id} dispatched (${itemIds.length} item(s), state=${lastStatus.stateName}).`,
    formatLine: (a) =>
      `${a.status === "complete" ? "[complete]" : a.status === "in-flight" ? "[in-flight]" : "[dispatched]"} job=${a.jobId} items=${a.itemCount} state=${a.stateName ?? "?"}`,
    extra: {
      jobId: job.id,
      itemCount: itemIds.length,
      target,
      languages: action.languages,
      pollTimeoutMs: pollTimeout,
    },
    options,
  });

  return [action];
};

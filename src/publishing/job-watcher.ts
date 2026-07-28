import type { Logger } from "@/shared/logger";
import { sleep } from "@/shared/concurrency";
import { createScaiError } from "@/shared/errors";
import { getPublishJob } from "./api/client";
import { extractFailureDiagnostics, formatFailureDiagnostics } from "./job-diagnostics";
import type { PublishJob, PublishJobState, PublishingApiClientOptions } from "./api/types";

/**
 * Job-watch + summary printing helpers. Used by `scai content publish status
 * --watch` and by `scai content publish all` in non-interactive mode (where
 * "submit and exit" leaves CI blind to job failure). Single source of
 * truth so the two surfaces emit identical event streams.
 */

const TERMINAL_STATES = new Set<PublishJobState>(["completed", "failed", "cancelled"]);

export const DEFAULT_POLL_INTERVAL_S = 5;
export const DEFAULT_WATCH_TIMEOUT_S = 1800;

export const clampPollInterval = (raw: number | undefined): number => {
  const v = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_POLL_INTERVAL_S;
  return Math.min(60, Math.max(2, v));
};

/**
 * Watch a job until it reaches a terminal state. Emits one log line
 * per state change (or per processedCount delta in verbose mode);
 * in --json mode, writes one JSON object per emitted change to stdout.
 *
 * Returns the terminal job. Caller decides whether to throw on
 * failed/cancelled — different verbs have different exit-code
 * conventions.
 *
 * Throws ScaiError on the watch timeout (NETWORK) so CI pipelines fail
 * loudly instead of swallowing a hung publish.
 */
export const watchPublishJob = async (
  logger: Logger,
  client: PublishingApiClientOptions,
  jobId: string,
  pollIntervalS: number,
  timeoutS: number
): Promise<PublishJob> => {
  const deadlineMs = Date.now() + timeoutS * 1000;
  let lastState: PublishJobState | undefined;
  let lastProcessed: number | undefined;

  for (;;) {
    if (Date.now() > deadlineMs) {
      throw createScaiError(
        `Watch timed out after ${timeoutS}s waiting for job ${jobId} to reach a terminal state.`,
        "NETWORK",
        {
          hint: `Re-check manually: scai content publish status ${jobId}. Increase --timeout-s if the publish is genuinely longer-running.`,
        }
      );
    }
    const job = await getPublishJob(client, jobId);

    const stateChanged = job.state !== lastState;
    const processedChanged =
      job.processedCount !== undefined && job.processedCount !== lastProcessed;

    if (stateChanged || (processedChanged && logger.isVerbose())) {
      if (logger.isJson()) {
        process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...job })}\n`);
      } else {
        logger.info(
          `[${new Date().toISOString()}] ${job.id} → ${job.state}${
            job.processedCount !== undefined ? `  (${job.processedCount} processed)` : ""
          }`,
          stateChanged ? "cyan" : "gray"
        );
      }
      lastState = job.state;
      lastProcessed = job.processedCount;
    }

    if (TERMINAL_STATES.has(job.state)) {
      return job;
    }

    await sleep(pollIntervalS * 1000);
  }
};

/**
 * Print the human-readable summary for a single job, including
 * failure diagnostics when the job ended in `failed`. Used by both
 * the one-shot status path and the final transition in --watch.
 */
export const printJobSummary = (logger: Logger, job: PublishJob): void => {
  logger.info(`Job ${job.id}: ${job.state}`, "cyan");
  if (job.processedCount !== undefined) {
    logger.info(`  Processed: ${job.processedCount}`);
  }
  if (job.totalCount !== undefined) {
    logger.info(`  Total:     ${job.totalCount}`);
  }
  if (job.startedAt) {
    logger.info(`  Started:   ${job.startedAt}`);
  }
  if (job.completedAt) {
    logger.info(`  Completed: ${job.completedAt}`);
  }
  if (job.state === "failed") {
    const diag = extractFailureDiagnostics(job);
    const formatted = formatFailureDiagnostics(diag);
    if (formatted.length > 0) {
      logger.info("  Failure:", "red");
      for (const line of formatted) {
        logger.info(`    ${line}`, "red");
      }
    }
  }
};

/**
 * Translate a terminal job state into a ScaiError throw (or pass-through
 * for `completed`). Centralizes the exit-code mapping so every verb that
 * watches a job exits consistently:
 *   - completed → no throw, caller proceeds
 *   - failed    → DEPLOY_FAILED (exit 6)
 *   - cancelled → CANCELLED (exit 130, matches POSIX SIGINT convention)
 */
export const throwOnTerminalFailure = (job: PublishJob): void => {
  if (job.state === "failed") {
    const diag = extractFailureDiagnostics(job);
    throw createScaiError(`Publish job ${job.id} ended in state 'failed'.`, "DEPLOY_FAILED", {
      hint: diag.reason ?? "Inspect statistics on the raw job for failure detail.",
    });
  }
  if (job.state === "cancelled") {
    throw createScaiError(`Publish job ${job.id} was cancelled.`, "CANCELLED", {
      hint: "The job did not complete. Re-submit if needed.",
    });
  }
};

import { Logger } from "@/shared/logger";
import { resolveEnvironment } from "@/policy/environment";
import { createScaiError } from "@/shared/errors";
import { acquirePublishingToken } from "../api/auth";
import { getPublishJob, listPublishJobs } from "../api/client";
import {
  DEFAULT_WATCH_TIMEOUT_S,
  clampPollInterval,
  printJobSummary,
  throwOnTerminalFailure,
  watchPublishJob,
} from "../job-watcher";
import type { PublishJob, PublishingApiClientOptions } from "../api/types";

export interface RunPublishStatusOptions {
  config?: string;
  environmentName?: string;
  jobId?: string;
  /** Poll until the job reaches a terminal state. Requires a jobId. */
  watch?: boolean;
  /** Poll interval in seconds. Clamped to [2, 60]. Default 5. */
  pollIntervalS?: number;
  /** Hard timeout for --watch in seconds. Default 1800 (30 min). */
  timeoutS?: number;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunPublishStatusOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const formatJobLine = (job: PublishJob): string => {
  const parts: string[] = [job.id, job.state];
  if (job.processedCount !== undefined) {
    parts.push(`${job.processedCount} processed`);
  }
  if (job.startedAt) {
    parts.push(`started ${job.startedAt}`);
  }
  return parts.join("  ");
};

export const runPublishStatus = async (options: RunPublishStatusOptions): Promise<void> => {
  const logger = toLogger(options);

  if (options.watch && !options.jobId) {
    throw createScaiError("--watch requires a <jobId> argument.", "INPUT_INVALID", {
      hint: "Run `scai content publish status <jobId> --watch` against a specific job.",
    });
  }

  const { envName, environment, timeoutMs } = resolveEnvironment(options);

  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = {
    accessToken,
    timeoutMs,
  };

  if (options.jobId) {
    if (options.watch) {
      const pollIntervalS = clampPollInterval(options.pollIntervalS);
      const timeoutS = options.timeoutS ?? DEFAULT_WATCH_TIMEOUT_S;
      const job = await watchPublishJob(logger, client, options.jobId, pollIntervalS, timeoutS);
      if (logger.isJson()) {
        process.stdout.write(`${JSON.stringify({ terminal: true, ...job }, null, 2)}\n`);
      } else {
        printJobSummary(logger, job);
      }
      throwOnTerminalFailure(job);
      return;
    }

    const job = await getPublishJob(client, options.jobId);
    if (logger.isJson()) {
      // stdout is reserved for the JSON payload when --json is set;
      // logger.info() suppresses output in json mode.
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    printJobSummary(logger, job);
    return;
  }

  const running = await listPublishJobs(client, {
    statuses: ["Queued", "Running"],
  });
  if (logger.isJson()) {
    process.stdout.write(`${JSON.stringify(running, null, 2)}\n`);
    return;
  }
  if (running.length === 0) {
    logger.info(`No publish jobs queued or running in environment '${envName}'.`, "yellow");
    return;
  }
  logger.info(`Running publish jobs in '${envName}':`, "cyan");
  for (const job of running) {
    logger.info(`  ${formatJobLine(job)}`);
  }
};

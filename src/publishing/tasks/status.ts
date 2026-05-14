import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { getAccessToken } from "@/serialization/sitecore-api/auth";
import { getPublishJob, listPublishJobs } from "../sitecore-api/client";
import type { PublishJob, PublishingApiClientOptions } from "../sitecore-api/types";

export interface RunPublishStatusOptions {
  config?: string;
  environmentName?: string;
  jobId?: string;
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
  const { envName, environment, timeoutMs } = resolveEnvironment(options);

  const accessToken = await getAccessToken(environment);
  if (!accessToken) {
    throw createScaiError(
      `Could not acquire an access token for environment '${envName}'.`,
      "AUTH_REQUIRED",
      { hint: `Run 'scai login --environment-name ${envName}' first.` }
    );
  }

  const client: PublishingApiClientOptions = {
    accessToken,
    timeoutMs,
  };

  if (options.jobId) {
    const job = await getPublishJob(client, options.jobId);
    if (logger.isJson()) {
      // stdout is reserved for the JSON payload when --json is set;
      // logger.info() suppresses output in json mode.
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
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
    return;
  }

  const running = await listPublishJobs(client, {
    states: ["queued", "running"],
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

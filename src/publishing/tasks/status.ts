import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { checkPublishStatus } from "@/serialization/sitecore-api/publish";
import { normalizePublishJob, type GraphQLPublishStatus } from "../sitecore-api/normalize";

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

export const runPublishStatus = async (options: RunPublishStatusOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment, timeoutMs } = resolveEnvironment(options);

  if (!options.jobId) {
    // Authoring GraphQL surfaces only `publishingStatus(id)` — no
    // list-running-jobs endpoint. CLI keeps a running-jobs view as
    // a future enhancement backed by the audit log (when that ships
    // in PR 2b); for now, the verb requires an explicit job id.
    throw createScaiError(
      "A publish job id is required.",
      "INPUT_INVALID",
      {
        hint: "Capture the id printed by `scai publish item` or `scai publish all`. The Authoring GraphQL surface does not expose a list-jobs endpoint; track jobs via the audit log in `~/.sitecoreai/audit.log` once PR 2b ships.",
      }
    );
  }

  const raw = (await checkPublishStatus(environment, options.jobId, {
    timeoutMs,
  })) as GraphQLPublishStatus;
  const job = normalizePublishJob(raw);

  if (logger.isJson()) {
    process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return;
  }
  logger.info(`Job ${job.id} (env '${envName}'): ${job.state}`, "cyan");
  if (job.processedCount !== undefined) {
    logger.info(`  Processed: ${job.processedCount}`);
  }
  if (job.stateCode !== undefined) {
    logger.info(`  State code: ${job.stateCode}`);
  }
};

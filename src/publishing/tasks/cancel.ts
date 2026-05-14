import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { acquirePublishingToken } from "../sitecore-api/auth";
import { cancelPublishJob, getPublishJob } from "../sitecore-api/client";
import type { PublishingApiClientOptions } from "../sitecore-api/types";
import { recordPublishAudit, type PublishAuditCaller } from "../audit";

export interface RunPublishCancelOptions {
  config?: string;
  environmentName?: string;
  jobId?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunPublishCancelOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export const runPublishCancel = async (options: RunPublishCancelOptions): Promise<void> => {
  const logger = toLogger(options);
  if (!options.jobId) {
    throw createScaiError("publish cancel requires a job id.", "INPUT_INVALID", {
      hint: "Pass the job id from `scai publish item` or `scai publish status`.",
    });
  }
  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  // Fetch first so the audit entry captures scope context the API
  // doesn't echo on cancel (which returns 202 no-content).
  const job = await getPublishJob(client, options.jobId);
  if (!job.canCancel) {
    throw createScaiError(
      `Job ${options.jobId} is not cancellable (state '${job.state}').`,
      "INPUT_INVALID",
      {
        hint: "Only Queued / Running jobs can be cancelled; Completed / Failed / already-Cancelled jobs cannot.",
      }
    );
  }

  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  try {
    await cancelPublishJob(client, options.jobId);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish cancel",
      caller,
      scope: {
        envName,
        resolvedTenantId: environment.tenantId,
        target: "Edge",
        kind: job.raw.options?.xmc?.site ? "full" : "item",
      },
      risk: job.raw.options?.xmc?.site ? "high" : "normal",
      scopeHash: "n/a",
      jobId: options.jobId,
      outcome: "cancelled",
    });
    if (logger.isJson()) {
      process.stdout.write(
        `${JSON.stringify({ id: options.jobId, outcome: "cancellation-requested" }, null, 2)}\n`
      );
      return;
    }
    logger.info(`Cancel requested for job ${options.jobId}.`, "green");
    logger.info(`Track with: scai publish status ${options.jobId} -n ${envName}`, "gray");
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish cancel",
      caller,
      scope: {
        envName,
        resolvedTenantId: environment.tenantId,
        target: "Edge",
        kind: job.raw.options?.xmc?.site ? "full" : "item",
      },
      risk: job.raw.options?.xmc?.site ? "high" : "normal",
      scopeHash: "n/a",
      jobId: options.jobId,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};

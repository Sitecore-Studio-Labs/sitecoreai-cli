import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import { promptText } from "@/shared/prompt";
import { acquirePublishingToken } from "../api/auth";
import { cancelPublishJob, getPublishJob, listPublishJobs } from "../api/client";
import type { PublishJob, PublishingApiClientOptions } from "../api/types";
import { recordPublishAudit, type PublishAuditCaller } from "@/shared/publish-audit";

export interface RunPublishCancelOptions {
  config?: string;
  environmentName?: string;
  jobId?: string;
  /** Cancel every queued+running job in the env. Mutually exclusive
   *  with a positional jobId. Always requires a typed env-name
   *  confirmation (skippable with --yes in CI). */
  allQueued?: boolean;
  /** Skip the typed env-name prompt on --all-queued (CI use). */
  yes?: boolean;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

const toLogger = (options: RunPublishCancelOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

interface CancelOutcome {
  jobId: string;
  state: string;
  outcome: "cancelled" | "error";
  errorCode?: string;
  errorMessage?: string;
}

const cancelOne = async (
  client: PublishingApiClientOptions,
  envName: string,
  envTenantId: string | undefined,
  job: PublishJob
): Promise<CancelOutcome> => {
  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  // API returns a flattened `xmc.type: "Site"` discriminator on response,
  // but submitted-side jobs may still carry the nested `xmc.site` shape.
  // Treat either as "whole-env" for audit + risk classification.
  const xmc = job.raw.options?.xmc as { site?: unknown; type?: string } | undefined;
  const isWholeEnv = Boolean(xmc?.site) || xmc?.type === "Site";
  const auditScope = {
    envName,
    resolvedTenantId: envTenantId,
    target: "Edge" as const,
    kind: (isWholeEnv ? "full" : "item") as "full" | "item",
  };
  const risk: "high" | "normal" = isWholeEnv ? "high" : "normal";
  try {
    await cancelPublishJob(client, job.id);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish cancel",
      caller,
      scope: auditScope,
      risk,
      scopeHash: "n/a",
      jobId: job.id,
      outcome: "cancelled",
    });
    return { jobId: job.id, state: job.state, outcome: "cancelled" };
  } catch (err) {
    const errorCode =
      err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN";
    const errorMessage = err instanceof Error ? err.message : String(err);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish cancel",
      caller,
      scope: auditScope,
      risk,
      scopeHash: "n/a",
      jobId: job.id,
      outcome: "error",
      errorCode,
      errorMessage,
    });
    return { jobId: job.id, state: job.state, outcome: "error", errorCode, errorMessage };
  }
};

export const runPublishCancel = async (options: RunPublishCancelOptions): Promise<void> => {
  const logger = toLogger(options);
  if (options.allQueued && options.jobId) {
    throw createScaiError(
      "publish cancel: pass either <jobId> OR --all-queued, not both.",
      "INPUT_INVALID"
    );
  }
  if (!options.allQueued && !options.jobId) {
    throw createScaiError("publish cancel requires a job id (or --all-queued).", "INPUT_INVALID", {
      hint: "Pass the job id from `scai content publish item` / `scai content publish status`, or --all-queued to sweep the whole env.",
    });
  }
  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  if (options.allQueued) {
    const inflight = await listPublishJobs(client, { statuses: ["Queued", "Running"] });
    if (inflight.length === 0) {
      logger.info(`No queued or running publish jobs in env '${envName}'.`, "yellow");
      if (logger.isJson()) {
        process.stdout.write(`${JSON.stringify({ cancelled: [], skipped: [] }, null, 2)}\n`);
      }
      return;
    }
    if (!logger.isJson()) {
      logger.warn(
        `⚠️  About to cancel ${inflight.length} publish job(s) in env '${envName}'.`,
        "yellow"
      );
      for (const j of inflight) {
        logger.info(
          `  ${j.id} (${j.state})${j.startedAt ? `  started ${j.startedAt}` : ""}`,
          "gray"
        );
      }
    }
    if (!options.yes) {
      if (options.nonInteractive) {
        throw createScaiError(
          "publish cancel --all-queued in non-interactive mode requires --yes.",
          "INPUT_INVALID"
        );
      }
      const typed = await promptText(
        `Type the env name '${envName}' to confirm cancelling ${inflight.length} job(s):`
      );
      if (typed !== envName) {
        throw createScaiError(
          `Confirmation mismatch: typed '${typed}', expected '${envName}'. Aborting.`,
          "INPUT_INVALID"
        );
      }
    }
    const outcomes: CancelOutcome[] = [];
    for (const job of inflight) {
      // Only cancellable states pass to cancelOne; the rest get skipped
      // silently (a job that's been racing to a terminal state between
      // list and cancel shouldn't fail the whole sweep).
      if (!job.canCancel) {
        outcomes.push({
          jobId: job.id,
          state: job.state,
          outcome: "error",
          errorCode: "NOT_CANCELLABLE",
        });
        continue;
      }
      outcomes.push(await cancelOne(client, envName, environment.tenantId, job));
    }
    const successes = outcomes.filter((o) => o.outcome === "cancelled");
    const failures = outcomes.filter((o) => o.outcome === "error");
    if (logger.isJson()) {
      process.stdout.write(
        `${JSON.stringify({ cancelled: successes, errors: failures, total: outcomes.length }, null, 2)}\n`
      );
      return;
    }
    logger.info(
      `Cancel requested for ${successes.length}/${outcomes.length} job(s).`,
      successes.length === outcomes.length ? "green" : "yellow"
    );
    if (failures.length > 0) {
      logger.warn(`${failures.length} job(s) could not be cancelled:`, "yellow");
      for (const f of failures) {
        logger.warn(
          `  ${f.jobId} (${f.errorCode ?? "?"})${f.errorMessage ? ` — ${f.errorMessage}` : ""}`,
          "yellow"
        );
      }
    }
    return;
  }

  // Single-job path (unchanged behavior).
  const jobId = options.jobId as string;
  const job = await getPublishJob(client, jobId);
  if (!job.canCancel) {
    throw createScaiError(
      `Job ${jobId} is not cancellable (state '${job.state}').`,
      "INPUT_INVALID",
      {
        hint: "Only Queued / Running jobs can be cancelled; Completed / Failed / already-Cancelled jobs cannot.",
      }
    );
  }
  const outcome = await cancelOne(client, envName, environment.tenantId, job);
  if (outcome.outcome === "error") {
    throw createScaiError(`Failed to cancel ${jobId}: ${outcome.errorMessage}`, "NETWORK", {
      hint: outcome.errorCode,
    });
  }
  if (logger.isJson()) {
    process.stdout.write(
      `${JSON.stringify({ id: jobId, outcome: "cancellation-requested" }, null, 2)}\n`
    );
    return;
  }
  logger.info(`Cancel requested for job ${jobId}.`, "green");
  logger.info(`Track with: scai content publish status ${jobId} -n ${envName}`, "gray");
};

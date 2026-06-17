import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import { promptText } from "@/shared/prompt";
import { buildScaiEnvelope } from "@/shared/envelope";
import { acquirePublishingToken } from "../api/auth";
import { listPublishJobs, submitPublishJob } from "../api/client";
import { resolvePublishingLocales } from "../api/languages";
import type {
  CreatePublishJobRequest,
  PublishJob,
  PublishSiteMode,
  PublishingApiClientOptions,
} from "../api/types";
import {
  computeScopeHash,
  mintScopeToken,
  SCOPE_TOKEN_TTL_MS,
  verifyScopeToken,
} from "@/shared/publish-consent";
import {
  recordPublishAudit,
  type PublishAuditCaller,
  type PublishAuditScope,
} from "@/shared/publish-audit";
import {
  DEFAULT_WATCH_TIMEOUT_S,
  clampPollInterval,
  printJobSummary,
  throwOnTerminalFailure,
  watchPublishJob,
} from "../job-watcher";

export interface RunPublishAllOptions {
  config?: string;
  environmentName?: string;
  /** Literal language list. See `PublishLocaleOptions`. */
  languages?: string[];
  /** Resolve locales from the named site's language config via Sites
   *  API. NOTE: the publish itself is still whole-environment — the
   *  Publishing API has no site-scoping field for Tier 2 (verified
   *  2026-05-14 against the agents env). This flag scopes locales
   *  only. */
  languagesFromSite?: string;
  /** Resolve locales to every language registered in the tenant. */
  allTenantLanguages?: boolean;
  mode?: "Republish" | "Smart" | "Incremental";
  /** Required to actually call the API. */
  allowWrite?: boolean;
  whatIf?: boolean;
  confirmToken?: string;
  /** Operator must echo env name back interactively unless --yes is set
   *  alongside --confirm-token (CI path). */
  yes?: boolean;
  name?: string;
  source?: string;
  /** In non-interactive mode, after submitting, watch the job until it
   *  reaches a terminal state. Default `true` (CI safety: if the job
   *  fails, the command should exit non-zero so the pipeline notices).
   *  Pass `noWait: true` to opt out and get fire-and-forget submit. */
  noWait?: boolean;
  /** Poll interval in seconds when watching. Clamped to [2, 60]. */
  pollIntervalS?: number;
  /** Watch timeout in seconds. Default 1800 (30 min). Throws NETWORK
   *  if the job hasn't reached a terminal state by then. */
  timeoutS?: number;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

const toLogger = (options: RunPublishAllOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

/**
 * Find the most recent successfully-completed whole-environment publish
 * job for an env. Used in the dry-run pre-flight to surface the
 * "modified since" baseline for Smart mode.
 *
 * Filters server-side by `source=scai` + `system.status=Completed`,
 * then client-side by whole-env shape (`xmc.site` set, `xmc.items`
 * unset) and finally takes the freshest `finishTime`. Returns
 * `undefined` when no eligible job exists (first-ever publish to the
 * env), in which case the dry-run prints a gentle "no prior publish"
 * note instead of a misleading baseline.
 *
 * Failure during the lookup is non-fatal — the dry-run continues with
 * a "could not resolve" note, since this is advisory information.
 */
const findLastWholeEnvPublish = async (
  client: PublishingApiClientOptions
): Promise<PublishJob | undefined> => {
  const completed = await listPublishJobs(client, {
    statuses: ["Completed"],
    source: ["scai"],
    pageSize: 50,
  });
  // The API normalizes our `xmc: { site: { mode } }` request body into
  // a flattened `xmc: { type: "Site", mode, locales }` discriminator on
  // the response side. Match on either shape to handle both submitted-
  // by-scai jobs (nested) and re-read jobs (flat); the discriminator
  // that holds across both is `type === "Site"` OR the nested `site`
  // object.
  const wholeEnv = completed.filter((j) => {
    const xmc = j.raw.options?.xmc as
      | { site?: unknown; type?: string; items?: unknown }
      | undefined;
    if (!xmc) return false;
    if (xmc.items) return false;
    return Boolean(xmc.site) || xmc.type === "Site";
  });
  if (wholeEnv.length === 0) {
    return undefined;
  }
  return wholeEnv.reduce((latest, candidate) => {
    const latestT = latest.completedAt ?? latest.raw.system?.finishTime ?? "";
    const candT = candidate.completedAt ?? candidate.raw.system?.finishTime ?? "";
    return candT > latestT ? candidate : latest;
  });
};

const formatItemsSent = (job: PublishJob): string | undefined => {
  const stats = (job.raw.statistics ?? {}) as Record<string, unknown>;
  const itemsSent =
    typeof stats.itemsSent === "number"
      ? stats.itemsSent
      : typeof stats.processedCount === "number"
        ? stats.processedCount
        : undefined;
  return itemsSent !== undefined ? String(itemsSent) : undefined;
};

/**
 * Best-effort pre-flight info for the human dry-run: (1) surface the most
 * recent whole-env publish as a "modified since" baseline for Smart mode;
 * (2) warn when another whole-env publish is already queued or running,
 * since the API serializes these (verified 2026-05-14 — second submission
 * waited ~80s behind the first). Both checks share one token acquisition;
 * failure is non-fatal (advisory information only).
 */
const printPublishAllPreflight = async (
  logger: Logger,
  envName: string,
  environment: ReturnType<typeof resolveEnvironment>["environment"],
  timeoutMs: number | undefined
): Promise<void> => {
  try {
    const accessToken = await acquirePublishingToken({ envName, environment });
    const client = { accessToken, timeoutMs };
    const lastPublish = await findLastWholeEnvPublish(client);
    if (lastPublish) {
      const itemsSent = formatItemsSent(lastPublish);
      const ts = lastPublish.completedAt ?? lastPublish.raw.system?.finishTime ?? "(time unknown)";
      logger.info(`Last publish:  ${ts} (${lastPublish.id})`, "gray");
      if (itemsSent !== undefined) {
        logger.info(
          `               sent ${itemsSent} item(s) — Smart mode will re-emit items modified since`,
          "gray"
        );
      }
    } else {
      logger.info(`Last publish:  (no prior whole-env publish recorded for this env)`, "gray");
    }
    const inflight = await listPublishJobs(client, { statuses: ["Queued", "Running"] });
    const inflightWholeEnv = inflight.find((j) => {
      const xmc = j.raw.options?.xmc as
        | { site?: unknown; type?: string; items?: unknown }
        | undefined;
      if (!xmc || xmc.items) return false;
      return Boolean(xmc.site) || xmc.type === "Site";
    });
    if (inflightWholeEnv) {
      logger.warn(
        `⚠️  Another whole-env publish is already ${inflightWholeEnv.state} (${inflightWholeEnv.id}). The API serializes these; your job will queue behind it.`,
        "yellow"
      );
    }
  } catch {
    // Couldn't acquire token or list jobs — skip the pre-flight
    // info. Dry-run is still useful without it.
  }
};

interface PublishAllContext {
  envName: string;
  environment: ReturnType<typeof resolveEnvironment>["environment"];
  timeoutMs: number | undefined;
  mode: PublishSiteMode;
  target: string;
  languages: string[];
  scope: PublishAuditScope;
}

/** Dry-run path — JSON envelope (agents) or human pre-flight + scope token. */
const runPublishAllDryRun = async (logger: Logger, ctx: PublishAllContext): Promise<void> => {
  const { envName, environment, timeoutMs, mode, target, languages, scope } = ctx;
  // JSON-mode contract: skip the human-readable pre-flight (token
  // acquisition, last-publish lookup, in-flight job warning) — it
  // writes to stdout via the logger and the pre-flight is best-effort
  // anyway. Agents that need this metadata can call
  // `publish status`/`publish history` separately. The envelope
  // carries the mint scope + token.
  if (logger.isJson()) {
    const token = mintScopeToken(scope);
    const envelope = buildScaiEnvelope({
      command: "publish.all",
      environment: envName,
      data: {
        scope,
        mode,
        languages,
        scopeToken: token,
        scopeTokenTtlSeconds: SCOPE_TOKEN_TTL_MS / 1000,
      },
      extra: { whatIf: true },
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  logger.warn(
    `⚠️  publish all is a whole-environment republish to ${target}. This will republish EVERY item across every site in env '${envName}'.`,
    "yellow"
  );
  logger.info(`Environment:   ${envName}`, "cyan");
  if (environment.tenantId) {
    logger.info(`Tenant:        ${environment.tenantId}`, "gray");
  }
  logger.info(`Mode:          ${mode}`, "gray");
  logger.info(
    `Languages:     ${languages.length > 0 ? languages.join(", ") : "(default)"}`,
    "gray"
  );

  await printPublishAllPreflight(logger, envName, environment, timeoutMs);

  const token = mintScopeToken(scope);
  logger.info("", "gray");
  logger.info(`Scope token (TTL ${SCOPE_TOKEN_TTL_MS / 1000}s):`, "gray");
  process.stdout.write(`${token}\n`);
  logger.info("", "gray");
  logger.info(`To execute: rerun with --allow-write --confirm-token ${token}.`, "gray");
  logger.info(`You will also be prompted to type the env name '${envName}' verbatim.`, "yellow");
};

/**
 * Real-call gates: verify the confirm-token AND the env-name echo. Tier 2
 * always requires --confirm-token (no --yes fallback regardless of prod
 * flag: typing "all" instead of "item" is itself a failure mode this gate
 * catches). Throws on any gate failure.
 */
const enforcePublishAllConsent = async (
  options: RunPublishAllOptions,
  scope: PublishAuditScope,
  envName: string
): Promise<void> => {
  if (!options.confirmToken) {
    throw createScaiError(
      `publish all always requires --confirm-token, even on non-production envs.`,
      "INPUT_INVALID",
      {
        hint: "Run the same command without --allow-write to get a scope token, then pass --confirm-token <token>.",
      }
    );
  }
  const verification = verifyScopeToken(options.confirmToken, scope);
  if (!verification.ok) {
    throw createScaiError(`Scope token rejected (${verification.reason}).`, "INPUT_INVALID", {
      hint: "Re-run the dry-run to mint a fresh token.",
    });
  }

  // Env-name typed confirmation. CI can bypass via --yes (still
  // requires --confirm-token; the env-name echo is the additional
  // operator-attention check).
  if (!options.yes) {
    if (options.nonInteractive) {
      throw createScaiError(
        "publish all (whole-environment) in non-interactive mode requires --yes alongside --confirm-token.",
        "INPUT_INVALID"
      );
    }
    const typed = await promptText(
      `Type the env name '${envName}' to confirm a whole-environment republish:`
    );
    if (typed !== envName) {
      throw createScaiError(
        `Confirmation mismatch: typed '${typed}', expected '${envName}'. Aborting.`,
        "INPUT_INVALID"
      );
    }
  }
};

/** Post-submit reporting: watch in CI (non-interactive) or print tracking hint. */
const reportPublishAllJob = async (
  logger: Logger,
  client: PublishingApiClientOptions,
  job: Awaited<ReturnType<typeof submitPublishJob>>,
  options: RunPublishAllOptions,
  envName: string
): Promise<void> => {
  if (!logger.isJson()) {
    logger.info(`Submitted publish-all job ${job.id} (${job.state}).`, "green");
  }

  // In non-interactive mode, watch the job by default so CI surfaces
  // failures. The bare `--no-wait` flag opts out for the rare fire-
  // and-forget case. Interactive operators get the original behavior
  // (submit + tracking hint) so they can detach and check later.
  if (options.nonInteractive && !options.noWait) {
    if (!logger.isJson()) {
      logger.info(
        `Watching until terminal (--no-wait to skip). Re-check manually: scai content publish status ${job.id} -n ${envName}`,
        "gray"
      );
    }
    const terminal = await watchPublishJob(
      logger,
      client,
      job.id,
      clampPollInterval(options.pollIntervalS),
      options.timeoutS ?? DEFAULT_WATCH_TIMEOUT_S
    );
    if (logger.isJson()) {
      const envelope = buildScaiEnvelope({
        command: "publish.all",
        environment: envName,
        data: { terminal: true, ...terminal },
        extra: { summary: `Publish-all job ${job.id} reached a terminal state.` },
      });
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    } else {
      printJobSummary(logger, terminal);
    }
    throwOnTerminalFailure(terminal);
    return;
  }

  if (logger.isJson()) {
    const envelope = buildScaiEnvelope({
      command: "publish.all",
      environment: envName,
      data: job,
      extra: { summary: `Submitted publish-all job ${job.id} (${job.state}).` },
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }
  logger.info(`Track with: scai content publish status ${job.id} -n ${envName}`, "gray");
};

export const runPublishAll = async (options: RunPublishAllOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const mode: PublishSiteMode = options.mode ?? "Republish";
  const target = "Edge";
  const languages = await resolvePublishingLocales(logger, environment, options);

  const scope: PublishAuditScope = {
    envName,
    resolvedTenantId: environment.tenantId,
    target,
    kind: "full",
    languages,
  };
  const scopeHash = computeScopeHash(scope);

  const whatIf = options.allowWrite ? Boolean(options.whatIf) : true;

  if (whatIf) {
    await runPublishAllDryRun(logger, {
      envName,
      environment,
      timeoutMs,
      mode,
      target,
      languages,
      scope,
    });
    return;
  }

  await enforcePublishAllConsent(options, scope, envName);

  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  const request: CreatePublishJobRequest = {
    name: options.name ?? `scai content publish all (${envName})`,
    source: options.source ?? "scai",
    options: {
      xmc: {
        locales: languages.length > 0 ? languages : undefined,
        site: { mode },
      },
    },
  };

  try {
    const job = await submitPublishJob(client, request);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish all",
      caller,
      scope,
      risk: "high",
      scopeHash,
      scopeToken: options.confirmToken,
      jobId: job.id,
      outcome: "ok",
    });
    await reportPublishAllJob(logger, client, job, options, envName);
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish all",
      caller,
      scope,
      risk: "high",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};

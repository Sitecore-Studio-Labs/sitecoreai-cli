import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { promptText } from "@/shared/prompt";
import { acquirePublishingToken } from "../sitecore-api/auth";
import { submitPublishJob } from "../sitecore-api/client";
import type {
  CreatePublishJobRequest,
  PublishSiteMode,
  PublishingApiClientOptions,
} from "../sitecore-api/types";
import { computeScopeHash, mintScopeToken, SCOPE_TOKEN_TTL_MS, verifyScopeToken } from "../consent";
import { recordPublishAudit, type PublishAuditCaller, type PublishAuditScope } from "../audit";

export interface RunPublishAllOptions {
  config?: string;
  environmentName?: string;
  languages?: string[];
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

export const runPublishAll = async (options: RunPublishAllOptions): Promise<void> => {
  const logger = toLogger(options);
  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const languages = options.languages ?? [];
  const mode: PublishSiteMode = options.mode ?? "Republish";
  const target = "Edge";

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
    logger.warn(
      `⚠️  publish all is a whole-tenant republish to ${target}. This will republish EVERY item in env '${envName}'.`,
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
    const token = mintScopeToken(scope);
    logger.info("", "gray");
    logger.info(`Scope token (TTL ${SCOPE_TOKEN_TTL_MS / 1000}s):`, "gray");
    process.stdout.write(`${token}\n`);
    logger.info("", "gray");
    logger.info(`To execute: rerun with --allow-write --confirm-token ${token}.`, "gray");
    logger.info(`You will also be prompted to type the env name '${envName}' verbatim.`, "yellow");
    return;
  }

  // Real call — Tier 2 always requires --confirm-token AND an env-name
  // echo. No --yes fallback, regardless of whether the env is flagged
  // production: typing "all" instead of "item" is itself a failure
  // mode this gate catches.
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
        "publish all in non-interactive mode requires --yes alongside --confirm-token.",
        "INPUT_INVALID"
      );
    }
    const typed = await promptText(
      `Type the env name '${envName}' to confirm a whole-tenant republish:`
    );
    if (typed !== envName) {
      throw createScaiError(
        `Confirmation mismatch: typed '${typed}', expected '${envName}'. Aborting.`,
        "INPUT_INVALID"
      );
    }
  }

  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  const request: CreatePublishJobRequest = {
    name: options.name ?? `scai publish all (${envName})`,
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
    if (logger.isJson()) {
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish-all job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai publish status ${job.id} -n ${envName}`, "gray");
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

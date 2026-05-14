import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { promptConfirm } from "@/shared/prompt";
import { acquirePublishingToken } from "../sitecore-api/auth";
import { submitPublishJob } from "../sitecore-api/client";
import type {
  CreatePublishJobRequest,
  PublishItemsMode,
  PublishingApiClientOptions,
} from "../sitecore-api/types";
import { isProductionTier } from "../env-tier";
import { computeScopeHash, mintScopeToken, SCOPE_TOKEN_TTL_MS, verifyScopeToken } from "../consent";
import { recordPublishAudit, type PublishAuditCaller, type PublishAuditScope } from "../audit";

export interface RunPublishItemOptions {
  config?: string;
  environmentName?: string;
  /** Item IDs (GUIDs) to publish. At least one required. The API
   *  accepts an array; scai bundles all IDs into a single publishing
   *  job (one POST /jobs, one job id, one audit entry). For
   *  large batches consider tenant rate limits — the API documents
   *  no hard cap but treats each item as a unit of work. */
  itemIds?: string[];
  /** ItemModel.type — defaults to "item". The Publishing API accepts
   *  a free-form string here; if your tenant uses a different value
   *  (e.g. "Item" or "ContentItem"), pass it explicitly. */
  itemType?: string;
  /** Languages (e.g. en-US). Mapped to xmc.locales. */
  languages?: string[];
  /** Map to xmc.items.publishChildren — matches dotnet --subitems. */
  includeSubitems?: boolean;
  /** Map to xmc.items.publishRelatedItems — matches dotnet --related. */
  includeRelated?: boolean;
  /** Publish mode. Per the Publishing API spec, items-level publish
   *  supports only `Smart` (default) and `Republish` — Incremental
   *  is whole-site only and lives on `publish all`. */
  mode?: PublishItemsMode;
  /** Dry-run; default true. Real publish requires --allow-write. */
  whatIf?: boolean;
  /** Required to actually call the API. */
  allowWrite?: boolean;
  /** Scope token issued by a previous dry-run; required on prod tier. */
  confirmToken?: string;
  /** Skip the interactive prompt on non-prod envs. */
  yes?: boolean;
  /** Override the job name in the API request. */
  name?: string;
  /** Override the source field in the API request. */
  source?: string;
  /** Output / verbosity. */
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  /** Non-interactive (e.g. CI) — refuse the [y/N] fallback path. */
  nonInteractive?: boolean;
}

const toLogger = (options: RunPublishItemOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const printScope = (logger: Logger, scope: PublishAuditScope): void => {
  logger.info(`Environment:   ${scope.envName}`, "cyan");
  if (scope.resolvedTenantId) {
    logger.info(`Tenant:        ${scope.resolvedTenantId}`, "gray");
  }
  logger.info(`Target:        ${scope.target}`, "gray");
  logger.info(`Kind:          ${scope.kind}`, "gray");
  if (scope.itemIds && scope.itemIds.length > 0) {
    logger.info(`Item IDs:      ${scope.itemIds.join(", ")}`, "gray");
  }
  if (scope.path) {
    logger.info(`Path:          ${scope.path}`, "gray");
  }
  logger.info(`Languages:     ${scope.languages?.join(", ") ?? "(default)"}`, "gray");
  logger.info(`Include subs:  ${Boolean(scope.includeSubitems)}`, "gray");
  logger.info(`Include rel.:  ${Boolean(scope.includeRelated)}`, "gray");
};

export const runPublishItem = async (options: RunPublishItemOptions): Promise<void> => {
  const logger = toLogger(options);

  const itemIds = options.itemIds ?? [];
  if (itemIds.length === 0) {
    throw createScaiError("Publish requires at least one --items <guid>.", "INPUT_INVALID", {
      hint: "Pass --items <guid> (repeatable) or --items <guid1,guid2,...> to publish a batch in one job. Path-based publishing is on the roadmap once we wire path→id resolution.",
    });
  }

  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const itemType = options.itemType ?? "item";
  const languages = options.languages ?? [];
  const target = "Edge";
  const mode: PublishItemsMode = options.mode ?? "Smart";

  const scope: PublishAuditScope = {
    envName,
    resolvedTenantId: environment.tenantId,
    target,
    kind: "item",
    itemIds,
    languages,
    includeSubitems: options.includeSubitems,
    includeRelated: options.includeRelated,
  };
  const scopeHash = computeScopeHash(scope);

  // Default whatIf=true. Operator must pass --allow-write to actually
  // call the API. Same pattern as scai cleanup versions prune.
  const whatIf = options.allowWrite ? Boolean(options.whatIf) : true;

  const productionTier = isProductionTier(environment);

  if (whatIf) {
    // Dry-run path — print the scope, mint a scope token, exit.
    logger.info(`What-if: would publish ${itemIds.length} item(s) to ${target}.`, "yellow");
    printScope(logger, scope);
    const token = mintScopeToken(scope);
    logger.info("", "gray");
    if (productionTier) {
      logger.info(
        `Production-tier env. Real call requires --allow-write AND --confirm-token.`,
        "yellow"
      );
    }
    logger.info(`Scope token (TTL ${SCOPE_TOKEN_TTL_MS / 1000}s):`, "gray");
    process.stdout.write(`${token}\n`);
    logger.info("", "gray");
    logger.info(
      `To execute: rerun with --allow-write${productionTier ? ` --confirm-token ${token}` : ""}`,
      "gray"
    );
    return;
  }

  // Real call from here on. Layer the safety checks.
  if (productionTier) {
    if (!options.confirmToken) {
      throw createScaiError(
        `Production-tier env '${envName}' requires --confirm-token.`,
        "INPUT_INVALID",
        {
          hint: "Run the same command without --allow-write to get a scope token, then pass it back as --confirm-token <token>.",
        }
      );
    }
    const verification = verifyScopeToken(options.confirmToken, scope);
    if (!verification.ok) {
      throw createScaiError(`Scope token rejected (${verification.reason}).`, "INPUT_INVALID", {
        hint: `Re-run the dry-run to mint a fresh token; the scope or env may have changed since the token was issued.`,
      });
    }
  } else if (!options.yes) {
    if (options.nonInteractive) {
      throw createScaiError(
        "Non-interactive mode requires --yes (or --confirm-token on prod envs).",
        "INPUT_INVALID"
      );
    }
    logger.info(
      `About to publish ${itemIds.length} item(s) to ${target} in env '${envName}'.`,
      "yellow"
    );
    printScope(logger, scope);
    const ok = await promptConfirm("Proceed with publish?", false);
    if (!ok) {
      logger.info("Aborted.", "yellow");
      return;
    }
  }

  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  const defaultName =
    itemIds.length === 1
      ? `scai publish item ${itemIds[0]} (${envName})`
      : `scai publish ${itemIds.length} items (${envName})`;
  const request: CreatePublishJobRequest = {
    name: options.name ?? defaultName,
    source: options.source ?? "scai",
    options: {
      // One ItemModel per requested id. `locale` left undefined so the
      // top-level `xmc.locales` controls the language set for the whole
      // batch; callers needing per-item locale targeting can use the
      // lower-level `submitPublishJob` API directly.
      items: itemIds.map((id) => ({ id, type: itemType })),
      xmc: {
        locales: languages.length > 0 ? languages : undefined,
        items: {
          mode,
          publishChildren: options.includeSubitems,
          publishRelatedItems: options.includeRelated,
        },
      },
    },
  };

  try {
    const job = await submitPublishJob(client, request);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish item",
      caller,
      scope,
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      jobId: job.id,
      outcome: "ok",
    });
    if (logger.isJson()) {
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai publish status ${job.id} -n ${envName}`, "gray");
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish item",
      caller,
      scope,
      risk: "normal",
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

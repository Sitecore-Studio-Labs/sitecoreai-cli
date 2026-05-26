import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import { promptConfirm } from "@/shared/prompt";
import { buildScaiEnvelope } from "@/shared/envelope";
import { acquirePublishingToken } from "../api/auth";
import { submitPublishJob } from "../api/client";
import { resolveItemPathsToIds } from "../api/path-resolver";
import { resolvePublishingLocales } from "../api/languages";
import { resolveSiteRoot } from "../api/sites";
import type {
  CreatePublishJobRequest,
  PublishItemsMode,
  PublishingApiClientOptions,
} from "../api/types";
import { isProductionTier } from "@/shared/env-tier";
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

export interface RunPublishItemOptions {
  config?: string;
  environmentName?: string;
  /** Item IDs (GUIDs) to publish. At least one of `itemIds` or
   *  `paths` is required. The API accepts an array; scai bundles all
   *  IDs into a single publishing job (one POST /jobs, one job id,
   *  one audit entry). For large batches consider tenant rate limits
   *  — the API documents no hard cap but treats each item as a unit
   *  of work. */
  itemIds?: string[];
  /** Content-tree paths (e.g. `/sitecore/content/Home`). Resolved to
   *  item IDs via Authoring GraphQL before submission. Merged into
   *  the same job as `itemIds`; paths that don't resolve fail the
   *  whole call before any API write. */
  paths?: string[];
  /** Site name. Resolves to the site's content-tree root item via
   *  Sites + Authoring GraphQL, and adds that item to the publish
   *  target list. Composable with `itemIds` and `paths` (target list
   *  is the union). Combine with `--include-subitems` to publish the
   *  whole site subtree; omit to publish just the root item. */
  site?: string;
  /** ItemModel.type — defaults to "item". The Publishing API accepts
   *  a free-form string here; if your tenant uses a different value
   *  (e.g. "Item" or "ContentItem"), pass it explicitly. */
  itemType?: string;
  /** Literal language list (e.g. `["en-US", "fr-CA"]`). Mapped to
   *  `xmc.locales`. Mutually exclusive with `languagesFromSite` and
   *  `allTenantLanguages` — set exactly one of the three. When none
   *  is set, scai auto-resolves the tenant-wide language inventory
   *  and logs it; the Publishing API has no implicit default. */
  languages?: string[];
  /** Resolve the language list from the named site's configuration via
   *  the Sites API. Explicit — the verb logs the resolved set before
   *  submitting. */
  languagesFromSite?: string;
  /** Resolve the language list to every language registered in the
   *  tenant (via the Sites API `listLanguages` endpoint). */
  allTenantLanguages?: boolean;
  /** Map to xmc.items.publishChildren — matches dotnet --subitems. */
  includeSubitems?: boolean;
  /** Map to xmc.items.publishRelatedItems — matches dotnet --related. */
  includeRelated?: boolean;
  /** Publish mode. Per the Publishing API spec, items-level publish
   *  supports only `Smart` (default) and `Republish` — Incremental
   *  is whole-environment only and lives on `publish all`. */
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

  const directItemIds = options.itemIds ?? [];
  const paths = options.paths ?? [];
  if (directItemIds.length === 0 && paths.length === 0 && !options.site) {
    throw createScaiError(
      "Publish requires at least one --items <guid>, --paths <path>, or --site <name>.",
      "INPUT_INVALID",
      {
        hint: "Pass --items <guid> (repeatable), --paths <path> (repeatable), and/or --site <name>. --site resolves the site's content-tree root via Sites API; add --include-subitems for the whole site.",
      }
    );
  }

  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const itemType = options.itemType ?? "item";
  const target = "Edge";
  const mode: PublishItemsMode = options.mode ?? "Smart";
  const languages = await resolvePublishingLocales(logger, environment, options);

  // Resolve paths → IDs up front so the dry-run scope (and the scope
  // hash) reflects the actual items the API will see. Resolution
  // errors fail the whole call before any publish-API write.
  let resolvedFromPaths: Array<{ path: string; itemId: string }> = [];
  if (paths.length > 0) {
    logger.info(`Resolving ${paths.length} path(s) via Authoring GraphQL...`, "gray");
    const result = await resolveItemPathsToIds(environment, paths);
    resolvedFromPaths = result.resolved;
    for (const r of resolvedFromPaths) {
      logger.info(`  ${r.path} → ${r.itemId}`, "gray");
    }
  }

  // Site root resolution. Two round trips per call (discoverSites +
  // resolveItemPathsToIds). Added to the target list; --include-subitems
  // controls whether descendants come along.
  let resolvedSite: { siteName: string; path: string; itemId: string } | undefined;
  if (options.site) {
    logger.info(`Resolving site '${options.site}' root via Sites + Authoring GraphQL...`, "gray");
    resolvedSite = await resolveSiteRoot(environment, options.site);
    logger.info(`  → ${resolvedSite.path} (${resolvedSite.itemId})`, "gray");
    if (!options.includeSubitems) {
      logger.info(
        `Publishing only the site root item. Pass --include-subitems for the whole site.`,
        "gray"
      );
    }
  }

  const itemIds = [
    ...directItemIds,
    ...resolvedFromPaths.map((r) => r.itemId),
    ...(resolvedSite ? [resolvedSite.itemId] : []),
  ];

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
  // call the API. Same pattern as scai hygiene cleanup versions prune.
  const whatIf = options.allowWrite ? Boolean(options.whatIf) : true;

  const productionTier = isProductionTier(environment);

  if (whatIf) {
    // Dry-run path — print the scope, mint a scope token, exit.
    const token = mintScopeToken(scope);
    if (logger.isJson()) {
      // JSON-mode contract: emit the canonical envelope ONLY. The raw
      // token lives in `data.scopeToken`; agents reuse it via
      // `--confirm-token`. No bare stdout writes here — they'd corrupt
      // any downstream JSON parser.
      const envelope = buildScaiEnvelope({
        command: "publish.item",
        environment: envName,
        data: {
          scope,
          scopeToken: token,
          scopeTokenTtlSeconds: SCOPE_TOKEN_TTL_MS / 1000,
          productionTier,
        },
        extra: { whatIf: true },
      });
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }
    logger.info(`What-if: would publish ${itemIds.length} item(s) to ${target}.`, "yellow");
    printScope(logger, scope);
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
      ? `scai content publish item ${itemIds[0]} (${envName})`
      : `scai content publish ${itemIds.length} items (${envName})`;
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
      const envelope = buildScaiEnvelope({
        command: "publish.item",
        environment: envName,
        data: job,
        extra: { summary: `Submitted publish job ${job.id} (${job.state}).` },
      });
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai content publish status ${job.id} -n ${envName}`, "gray");
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

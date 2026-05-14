/**
 * `scai publish unpublish` — composite verb.
 *
 * The SAI Publishing API has no per-version unpublish operation. The
 * Sitecore-canonical mechanism is to change the item's publish-state
 * fields via the Authoring API (so the next publish doesn't pick them
 * up — or, for already-published items, the next publish removes them
 * from Edge) and then submit a regular publish job.
 *
 * Three strategies:
 *
 *   - `never-publish` (default, reversible) — sets `__Never publish: true`
 *     on the latest version per requested language. Reverse by writing
 *     `__Never publish: false` (e.g. `scai content version
 *     set-never-publish --value false`) and republishing.
 *   - `expire-now` (reversible)             — sets `__Valid to: <now>`
 *     on each targeted version. Reverse by writing `__Valid to` to a
 *     future date.
 *   - `delete` (destructive, NOT reversible from scai's side) — not yet
 *     implemented; surfaces a clear error message.
 *
 * Safety model reuses the four PR 2b primitives: dry-run default,
 * scope-token verification on production-tier envs, `--allow-write`
 * to graduate from dry-run, audit log every mutation with before/after
 * captures so an operator can reverse a mistaken toggle by reading the
 * log.
 */

import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { promptConfirm, promptText } from "@/shared/prompt";
import { createHygieneApiClient } from "@/hygiene/api/client";
import {
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_TO,
  findField,
  formatBoolean,
  readVersionFields,
  writeVersionFields,
} from "@/content/sitecore-api/version-fields";
import { acquirePublishingToken } from "../sitecore-api/auth";
import { submitPublishJob } from "../sitecore-api/client";
import { resolveItemPathsToIds } from "../sitecore-api/path-resolver";
import { resolvePublishingLocales } from "../sitecore-api/languages";
import { resolveSiteRoot } from "../sitecore-api/sites";
import type { CreatePublishJobRequest, PublishingApiClientOptions } from "../sitecore-api/types";
import { isProductionTier } from "../env-tier";
import { computeScopeHash, mintScopeToken, SCOPE_TOKEN_TTL_MS, verifyScopeToken } from "../consent";
import {
  recordPublishAudit,
  type PublishAuditCaller,
  type PublishAuditFieldChange,
  type PublishAuditScope,
  type UnpublishStrategy,
} from "../audit";

export interface RunPublishUnpublishOptions {
  config?: string;
  environmentName?: string;
  itemIds?: string[];
  paths?: string[];
  /** Site name. Resolves to the site's content-tree root via Sites
   *  API + Authoring GraphQL. Combine with `--include-subitems` to
   *  unpublish the whole site. */
  site?: string;
  /** Literal language list. See `PublishLocaleOptions`. */
  languages?: string[];
  /** Resolve languages from the named site via Sites API. */
  languagesFromSite?: string;
  /** Resolve languages from the tenant-wide registered set. */
  allTenantLanguages?: boolean;
  includeSubitems?: boolean;
  includeRelated?: boolean;
  /** Defaults to `"never-publish"`. */
  strategy?: UnpublishStrategy;
  /**
   * For `--strategy delete` on production-tier envs: the operator
   *  must echo the item path back literally before scai will call
   *  `deleteItem`. The CLI prompts interactively when unset; CI must
   *  supply this matching the resolved item path. (Mirrors `publish
   *  all`'s typed env-name gate, scaled per-item.)
   */
  confirmItemPath?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  confirmToken?: string;
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

const toLogger = (options: RunPublishUnpublishOptions): Logger =>
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
  logger.info(`Strategy:      ${scope.strategy ?? "(unset)"}`, "gray");
  if (scope.itemIds && scope.itemIds.length > 0) {
    logger.info(`Item IDs:      ${scope.itemIds.join(", ")}`, "gray");
  }
  logger.info(
    `Languages:     ${
      scope.languages && scope.languages.length > 0 ? scope.languages.join(", ") : "(default)"
    }`,
    "gray"
  );
  logger.info(`Include subs:  ${Boolean(scope.includeSubitems)}`, "gray");
  logger.info(`Include rel.:  ${Boolean(scope.includeRelated)}`, "gray");
};

/**
 * Apply the strategy to a single `(itemId, language)` pair. Returns
 * the audit-log entries that should be recorded for the field write.
 * Throws if a precondition fails (e.g. version missing for the
 * language) — caller catches and records an error audit entry.
 */
const applyStrategy = async (
  environment: Parameters<typeof readVersionFields>[0],
  itemId: string,
  language: string,
  strategy: UnpublishStrategy,
  whatIf: boolean
): Promise<PublishAuditFieldChange[]> => {
  const snapshot = await readVersionFields(environment, { itemId, language });

  if (strategy === "never-publish") {
    const before = findField(snapshot, FIELD_NEVER_PUBLISH);
    const after = formatBoolean(true);
    if (!whatIf) {
      await writeVersionFields(environment, {
        itemId: snapshot.itemId,
        language: snapshot.language,
        version: snapshot.version,
        fields: [{ name: FIELD_NEVER_PUBLISH, value: after }],
      });
    }
    return [{ name: FIELD_NEVER_PUBLISH, before, after }];
  }

  if (strategy === "expire-now") {
    const before = findField(snapshot, FIELD_VALID_TO);
    // Sitecore expects ISO 8601 in `__Valid to`; reuse JS toISOString
    // and trim the trailing milliseconds so the wire shape matches
    // what the Sitecore Authoring UI writes.
    const after = new Date().toISOString();
    if (!whatIf) {
      await writeVersionFields(environment, {
        itemId: snapshot.itemId,
        language: snapshot.language,
        version: snapshot.version,
        fields: [{ name: FIELD_VALID_TO, value: after }],
      });
    }
    return [{ name: FIELD_VALID_TO, before, after }];
  }

  // Note: `delete` is not handled here — it's item-scoped (not
  // version-scoped) and runs through `runDeleteUnpublish` below.

  throw createScaiError(
    `Unpublish strategy '${strategy as string}' is not implemented yet.`,
    "INPUT_INVALID",
    {
      hint: "Use --strategy never-publish (default), --strategy expire-now, or --strategy delete.",
    }
  );
};

/**
 * Read the resolved Sitecore path for an itemId via Authoring GraphQL.
 * Used by the `delete` strategy to surface the path the operator must
 * echo back at the typed-path confirmation gate. The path is also the
 * value scai writes to the audit log so a "deleted X" entry is
 * grep-able by path, not just GUID.
 */
const lookupItemPath = async (
  environment: Parameters<typeof readVersionFields>[0],
  itemId: string
): Promise<string | null> => {
  // readVersionFields throws if the item has no version in the requested
  // language — that's a problem for delete (we want to delete regardless
  // of language). Use a minimal GraphQL probe instead.
  const { runAuthoringGraphQL } = await import("@/recipe/api/graphql");
  type Resp = { item: { itemId: string; path: string } | null };
  const data = await runAuthoringGraphQL<Resp>(
    environment,
    `query($id: String!) { item(where: { itemId: $id }) { itemId path } }`,
    { id: itemId }
  );
  return data.item?.path ?? null;
};

interface DeleteContext {
  envName: string;
  environment: Parameters<typeof readVersionFields>[0];
  timeoutMs: number | undefined;
  logger: Logger;
  itemIds: string[];
  resolvedPaths: Map<string, string>;
  scope: PublishAuditScope;
  scopeHash: string;
  productionTier: boolean;
  confirmToken?: string;
  confirmItemPath?: string;
  yes: boolean;
  nonInteractive: boolean;
  includeSubitems?: boolean;
  includeRelated?: boolean;
  languages: string[];
  name?: string;
  source?: string;
}

/**
 * Execute `--strategy delete` end-to-end. Item-scoped (not
 * version-scoped) — Sitecore's `deleteItem` removes the item across
 * every version and language at once. Distinct flow from the
 * reversible strategies because:
 *
 *   - typed-item-path confirmation gates each delete on production-tier
 *     envs (mirrors `publish all`'s typed env-name confirmation, scaled
 *     per-item)
 *   - audit entries carry `risk: "high"` (delete is NOT reversible)
 *   - the publish job follows the deletes so Edge sees the removals
 *
 * @internal
 */
const runDeleteUnpublish = async (ctx: DeleteContext): Promise<void> => {
  const { logger, envName, environment, timeoutMs, itemIds } = ctx;
  const caller: PublishAuditCaller = { type: "human", via: "cli" };
  const hygieneClient = createHygieneApiClient({ environment });

  // Typed-item-path confirmation gate: one prompt per item. Operator
  // sees the resolved path and types it back literally. `--yes`
  // (alongside `--confirm-item-path`) skips the prompt for CI, but
  // the supplied path MUST equal the resolved path — otherwise we
  // refuse so accidental paste of the wrong path can't slip through.
  const pathByItem = new Map<string, string>();
  for (const id of itemIds) {
    const cached = ctx.resolvedPaths.get(id);
    const resolved = cached ?? (await lookupItemPath(environment, id));
    if (!resolved) {
      throw createScaiError(
        `Item ${id} not found in env '${envName}'; refusing to delete.`,
        "INPUT_INVALID"
      );
    }
    pathByItem.set(id, resolved);
  }

  for (const id of itemIds) {
    const resolvedPath = pathByItem.get(id)!;
    if (ctx.yes && ctx.confirmItemPath) {
      if (ctx.confirmItemPath !== resolvedPath) {
        throw createScaiError(
          `--confirm-item-path mismatch for ${id}: provided '${ctx.confirmItemPath}', resolved '${resolvedPath}'.`,
          "INPUT_INVALID",
          {
            hint: "Provide the exact resolved path, or omit --confirm-item-path and use the interactive prompt.",
          }
        );
      }
      logger.info(
        `  ${id} (${resolvedPath}): typed-path confirmation passed (--yes mode).`,
        "gray"
      );
    } else {
      if (ctx.nonInteractive) {
        throw createScaiError(
          "Delete in non-interactive mode requires --yes AND --confirm-item-path.",
          "INPUT_INVALID"
        );
      }
      const typed = await promptText(
        `Type the path '${resolvedPath}' to confirm permanent deletion of ${id}:`
      );
      if (typed !== resolvedPath) {
        throw createScaiError(
          `Confirmation mismatch for ${id}: typed '${typed}', expected '${resolvedPath}'. Aborting; nothing deleted.`,
          "INPUT_INVALID"
        );
      }
    }
  }

  // All confirmations passed. Issue the deletes; audit each one
  // BEFORE moving to the next, so an interrupted run still has an
  // accurate trail.
  for (const id of itemIds) {
    const resolvedPath = pathByItem.get(id)!;
    try {
      await hygieneClient.deleteItem({ itemId: id, permanently: true });
      recordPublishAudit({
        ts: new Date().toISOString(),
        command: "publish unpublish",
        caller,
        scope: { ...ctx.scope, itemIds: [id], path: resolvedPath },
        risk: "high",
        scopeHash: ctx.scopeHash,
        scopeToken: ctx.confirmToken,
        outcome: "ok",
        fieldChanges: [{ name: "__DELETED__", before: resolvedPath, after: null }],
      });
      logger.info(`  ${id} (${resolvedPath}): deleted permanently.`, "yellow");
    } catch (err) {
      recordPublishAudit({
        ts: new Date().toISOString(),
        command: "publish unpublish",
        caller,
        scope: { ...ctx.scope, itemIds: [id], path: resolvedPath },
        risk: "high",
        scopeHash: ctx.scopeHash,
        scopeToken: ctx.confirmToken,
        outcome: "error",
        errorCode:
          err instanceof Error && "code" in err
            ? String((err as { code: unknown }).code)
            : "UNKNOWN",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  // Submit a publish job so Edge sees the deletions. Smart mode picks
  // up the missing items and removes them from Edge.
  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };
  const defaultName = `scai publish unpublish [delete] ${itemIds.length} item(s) (${envName})`;
  const request: CreatePublishJobRequest = {
    name: ctx.name ?? defaultName,
    source: ctx.source ?? "scai",
    options: {
      items: itemIds.map((id) => ({ id, type: "item" })),
      xmc: {
        locales: ctx.languages.length > 0 ? ctx.languages : undefined,
        items: {
          mode: "Smart",
          publishChildren: ctx.includeSubitems,
          publishRelatedItems: ctx.includeRelated,
        },
      },
    },
  };
  try {
    const job = await submitPublishJob(client, request);
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish unpublish",
      caller,
      scope: ctx.scope,
      risk: "high",
      scopeHash: ctx.scopeHash,
      scopeToken: ctx.confirmToken,
      jobId: job.id,
      outcome: "ok",
    });
    if (logger.isJson()) {
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai publish status ${job.id} -n ${envName}`, "gray");
    logger.warn(
      `Delete is NOT reversible from scai. Restoring requires Sitecore archive recovery or re-creation from serialization.`,
      "yellow"
    );
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish unpublish",
      caller,
      scope: ctx.scope,
      risk: "high",
      scopeHash: ctx.scopeHash,
      scopeToken: ctx.confirmToken,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};

export const runPublishUnpublish = async (options: RunPublishUnpublishOptions): Promise<void> => {
  const logger = toLogger(options);

  const directItemIds = options.itemIds ?? [];
  const paths = options.paths ?? [];
  if (directItemIds.length === 0 && paths.length === 0 && !options.site) {
    throw createScaiError(
      "Unpublish requires at least one --items <guid>, --paths <path>, or --site <name>.",
      "INPUT_INVALID",
      {
        hint: "Pass --items <guid>, --paths <path>, and/or --site <name>. --site resolves the site's content-tree root; add --include-subitems to unpublish the whole site.",
      }
    );
  }

  const strategy: UnpublishStrategy = options.strategy ?? "never-publish";

  const { envName, environment, timeoutMs } = resolveEnvironment(options);
  const target = "Edge";
  const languages = await resolvePublishingLocales(logger, environment, options);

  // Resolve paths → IDs up-front so the dry-run scope reflects the
  // actual items the field-write + publish-job will see.
  let resolvedFromPaths: Array<{ path: string; itemId: string }> = [];
  if (paths.length > 0) {
    logger.info(`Resolving ${paths.length} path(s) via Authoring GraphQL...`, "gray");
    const result = await resolveItemPathsToIds(environment, paths);
    resolvedFromPaths = result.resolved;
    for (const r of resolvedFromPaths) {
      logger.info(`  ${r.path} → ${r.itemId}`, "gray");
    }
  }

  // Site root resolution. Composable with --items / --paths.
  let resolvedSite: { siteName: string; path: string; itemId: string } | undefined;
  if (options.site) {
    logger.info(`Resolving site '${options.site}' root via Sites + Authoring GraphQL...`, "gray");
    resolvedSite = await resolveSiteRoot(environment, options.site);
    logger.info(`  → ${resolvedSite.path} (${resolvedSite.itemId})`, "gray");
    if (!options.includeSubitems) {
      logger.info(
        `Targeting only the site root. Pass --include-subitems for the whole site.`,
        "gray"
      );
    }
  }

  const itemIds = [
    ...directItemIds,
    ...resolvedFromPaths.map((r) => r.itemId),
    ...(resolvedSite ? [resolvedSite.itemId] : []),
  ];

  // Default to the env's configured publish languages if the operator
  // didn't pass any. We don't know those at this layer — leave the
  // array empty in the scope (audit shows "(default)") and walk the
  // env's authoring API which will infer. For the field-write loop
  // we need a concrete list; if empty, fall back to ["en"] (the
  // tenant default for most XM Cloud installs).
  const writeLanguages = languages.length > 0 ? languages : ["en"];

  const scope: PublishAuditScope = {
    envName,
    resolvedTenantId: environment.tenantId,
    target,
    kind: "unpublish",
    itemIds,
    languages,
    includeSubitems: options.includeSubitems,
    includeRelated: options.includeRelated,
    strategy,
  };
  const scopeHash = computeScopeHash(scope);

  const whatIf = options.allowWrite ? Boolean(options.whatIf) : true;
  const productionTier = isProductionTier(environment);

  if (whatIf) {
    logger.warn(
      `What-if: would unpublish ${itemIds.length} item(s) via strategy '${strategy}'.`,
      "yellow"
    );
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
          hint: "Run the same command without --allow-write to mint a scope token, then pass it back as --confirm-token <token>.",
        }
      );
    }
    const verification = verifyScopeToken(options.confirmToken, scope);
    if (!verification.ok) {
      throw createScaiError(`Scope token rejected (${verification.reason}).`, "INPUT_INVALID", {
        hint: "Re-run the dry-run to mint a fresh token; the scope or env may have changed since the token was issued.",
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
      `About to unpublish ${itemIds.length} item(s) via strategy '${strategy}' in env '${envName}'.`,
      "yellow"
    );
    printScope(logger, scope);
    const ok = await promptConfirm("Proceed with unpublish?", false);
    if (!ok) {
      logger.info("Aborted.", "yellow");
      return;
    }
  }

  // Delete strategy branches into its own flow — it's item-scoped
  // (not version-scoped), requires typed-item-path confirmation, and
  // emits high-risk audit entries.
  if (strategy === "delete") {
    // Build path-by-item map from the path resolution we already did
    // when --paths was used; we'll re-resolve missing ones inside.
    const resolvedPaths = new Map<string, string>();
    for (const r of resolvedFromPaths) {
      resolvedPaths.set(r.itemId, r.path);
    }
    await runDeleteUnpublish({
      envName,
      environment,
      timeoutMs,
      logger,
      itemIds,
      resolvedPaths,
      scope,
      scopeHash,
      productionTier,
      confirmToken: options.confirmToken,
      confirmItemPath: options.confirmItemPath,
      yes: Boolean(options.yes),
      nonInteractive: Boolean(options.nonInteractive),
      includeSubitems: options.includeSubitems,
      includeRelated: options.includeRelated,
      languages,
      name: options.name,
      source: options.source,
    });
    return;
  }

  const caller: PublishAuditCaller = { type: "human", via: "cli" };

  // Step 1: per-(item, language) field writes. Audit every mutation
  // BEFORE issuing the publish job so the trail is durable even if
  // the publish job submission fails afterward.
  const allFieldChanges: PublishAuditFieldChange[] = [];
  for (const itemId of itemIds) {
    for (const language of writeLanguages) {
      try {
        const changes = await applyStrategy(environment, itemId, language, strategy, false);
        allFieldChanges.push(...changes);
        recordPublishAudit({
          ts: new Date().toISOString(),
          command: "publish unpublish",
          caller,
          scope: { ...scope, itemIds: [itemId], languages: [language] },
          // strategy narrowed to "never-publish" | "expire-now" (delete
          // was thrown earlier); both are reversible, so "normal" risk.
          risk: "normal",
          scopeHash,
          scopeToken: options.confirmToken,
          outcome: "ok",
          fieldChanges: changes,
        });
        logger.info(`  ${itemId} (${language}): ${strategy} applied.`, "gray");
      } catch (err) {
        recordPublishAudit({
          ts: new Date().toISOString(),
          command: "publish unpublish",
          caller,
          scope: { ...scope, itemIds: [itemId], languages: [language] },
          // strategy narrowed to "never-publish" | "expire-now" (delete
          // was thrown earlier); both are reversible, so "normal" risk.
          risk: "normal",
          scopeHash,
          scopeToken: options.confirmToken,
          outcome: "error",
          errorCode:
            err instanceof Error && "code" in err
              ? String((err as { code: unknown }).code)
              : "UNKNOWN",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  }

  // Step 2: submit a publish job so Edge sees the state change. The
  // Publishing API is the same one `scai publish item` uses; we
  // bundle every targeted itemId into a single job with the
  // operator-supplied subitems/related flags.
  const accessToken = await acquirePublishingToken({ envName, environment });
  const client: PublishingApiClientOptions = { accessToken, timeoutMs };

  const defaultName = `scai publish unpublish ${itemIds.length} item(s) (${envName})`;
  const request: CreatePublishJobRequest = {
    name: options.name ?? defaultName,
    source: options.source ?? "scai",
    options: {
      items: itemIds.map((id) => ({ id, type: "item" })),
      xmc: {
        locales: languages.length > 0 ? languages : undefined,
        items: {
          // Smart mode — the Publishing API picks up the
          // __Never publish / __Valid to mutation as a state change
          // and removes the item from Edge on its next pass. Republish
          // would be wrong: it forces re-emit, which contradicts the
          // intent here.
          mode: "Smart",
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
      command: "publish unpublish",
      caller,
      scope,
      // Strategy narrowed to "never-publish" | "expire-now" earlier;
      // both reversible, so "normal" risk.
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      jobId: job.id,
      outcome: "ok",
      fieldChanges: allFieldChanges,
    });
    if (logger.isJson()) {
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai publish status ${job.id} -n ${envName}`, "gray");
    logger.info(
      `Reverse with: scai content version set-${
        strategy === "never-publish" ? "never-publish --value false" : "validity --clear-valid-to"
      } --item-id <id> -n ${envName}`,
      "gray"
    );
  } catch (err) {
    recordPublishAudit({
      ts: new Date().toISOString(),
      command: "publish unpublish",
      caller,
      scope,
      // Strategy narrowed to "never-publish" | "expire-now" earlier;
      // both reversible, so "normal" risk.
      risk: "normal",
      scopeHash,
      scopeToken: options.confirmToken,
      outcome: "error",
      errorCode:
        err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "UNKNOWN",
      errorMessage: err instanceof Error ? err.message : String(err),
      fieldChanges: allFieldChanges,
    });
    throw err;
  }
};

/**
 * Item-scoped `--strategy delete` flow for `scai content publish unpublish`.
 *
 * Split out of `unpublish.ts` because the delete path is shaped
 * differently from the reversible field-state strategies:
 *
 *   - item-scoped (not version-scoped): Sitecore's `deleteItem` removes
 *     the item across every version and language at once
 *   - typed-item-path confirmation gates each delete on production-tier
 *     envs (mirrors `publish all`'s typed env-name confirmation, scaled
 *     per-item)
 *   - audit entries carry `risk: "high"` (delete is NOT reversible)
 *   - the publish job follows the deletes so Edge sees the removals
 */

import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { promptText } from "@/shared/prompt";
import { buildScaiEnvelope } from "@/shared/envelope";
import { createHygieneApiClient } from "@/hygiene/api/client";
import type { readVersionFields } from "@/content/api/version-fields";
import { acquirePublishingToken } from "../api/auth";
import { submitPublishJob } from "../api/client";
import type { CreatePublishJobRequest, PublishingApiClientOptions } from "../api/types";
import {
  recordPublishAudit,
  type PublishAuditCaller,
  type PublishAuditScope,
} from "@/shared/publish-audit";

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

export interface DeleteContext {
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
export const runDeleteUnpublish = async (ctx: DeleteContext): Promise<void> => {
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
  const defaultName = `scai content publish unpublish [delete] ${itemIds.length} item(s) (${envName})`;
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
      const envelope = buildScaiEnvelope({
        command: "publish.unpublish",
        environment: envName,
        data: job,
        extra: {
          summary: `Submitted publish job ${job.id} (${job.state}).`,
          strategy: "delete",
          reversible: false,
        },
      });
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }
    logger.info(`Submitted publish job ${job.id} (${job.state}).`, "green");
    logger.info(`Track with: scai content publish status ${job.id} -n ${envName}`, "gray");
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

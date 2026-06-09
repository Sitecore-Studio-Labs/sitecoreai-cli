import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { resolveBriefClient } from "../client";
import {
  createBrief,
  deleteBrief,
  getBrief,
  listBriefs,
  updateBrief,
  type CreateBriefInput,
} from "../api/briefs";
import {
  createBriefType,
  deleteBriefType,
  getBriefType,
  listBriefTypes,
  updateBriefType,
  type CreateBriefTypeInput,
} from "../api/brief-types";
import { listBriefTasks, type BriefTaskMetadata } from "../api/tasks";
import { listBriefComments, createBriefComment } from "../api/comments";
import type {
  Brief,
  BriefComment,
  BriefStatus,
  BriefTask,
  BriefType,
  PagedResult,
} from "../api/schema";
import type { BriefApiClientOptions } from "../api/types";

/**
 * CLI runners for the `scai ops brief …` command family.
 *
 * Each runner resolves the env, acquires a brief-scoped token, calls
 * the library helper, then prints either human or JSON output via
 * `Logger`. The env+token+client orchestration lives in the exported
 * `resolveBriefClient()` (see `../client.ts`) — the SDK seam these
 * runners and the MCP tools share; `prepareBriefClient()` only pairs it
 * with a CLI `Logger`.
 *
 * Read verbs:
 *   - `runBriefList`     — list briefs
 *   - `runBriefGet`     — read one brief by id
 *   - `runBriefTypes`    — list brief types
 *   - `runBriefTypeGet`  — read one brief type by id
 *   - `runBriefTodosList`— list to-dos (optionally filtered to a brief)
 *   - `runBriefCommentsList` — list comments (optionally filtered)
 *
 * BriefType write verbs (verified 2026-05-15):
 *   - `runBriefTypeCreate` / `runBriefTypeUpdate` / `runBriefTypeDelete`
 *
 * Brief instance write verbs:
 *   - `runBriefUpdate`     — partial PUT of a brief; pass `patch.status` to move workflow
 *   - `runBriefDelete`     — delete a brief (SDK `deleteBrief` verified)
 *   - `runBriefCommentAdd` — post a comment to a brief (UNVERIFIED body)
 *
 * Each write runner honours an `options.whatIf` flag — when set, it
 * skips the API call and emits a plan-only summary. The CLI layer wires
 * this via `withApplyGate` so destructive verbs dry-run by default.
 */

export interface RunBriefBaseOptions {
  config?: string;
  /** Explicit organization id (`--org-id`). The Brief API is org-scoped. */
  orgId?: string;
  /** Env profile name — used only to derive its `organizationId`. */
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunBriefBaseOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const prepareBriefClient = async (
  options: RunBriefBaseOptions
): Promise<{ logger: Logger; client: BriefApiClientOptions; orgId: string }> => {
  const logger = toLogger(options);
  const { client, orgId } = await resolveBriefClient(options);
  return { logger, orgId, client };
};

/**
 * Emit a canonical `ScaiEnvelope` under `--json`. The brief tasks are
 * org-scoped, not env-scoped on the wire; we still pass the resolved
 * env name through `environment` so consumers can tell what config
 * profile produced the output.
 *
 * `compact` switches off pretty-printing — used by the `--lean` list
 * path, where the consumer is automation (not a human reading the
 * terminal) and the doubled byte cost of two-space indentation matters
 * for large pages.
 */
const writeBriefEnvelope = (
  command: string,
  options: RunBriefBaseOptions,
  data: unknown,
  extra?: Record<string, unknown>,
  compact = false
): void => {
  const envelope = buildScaiEnvelope({
    command: `brief.${command}`,
    environment: options.environmentName ?? null,
    data,
    extra,
  });
  const json = compact ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2);
  process.stdout.write(`${json}\n`);
};

/**
 * Identity + linkage fields of a brief — everything a tenant scan or
 * delete cascade needs to match and act on a brief, without the heavy
 * `fields` (RichText ProseMirror docs), `tasks`, and `comments` bodies
 * that dominate a full `Brief`. Emitted by `runBriefList({ lean })`.
 */
export type LeanBrief = Pick<Brief, "id" | "name" | "status" | "locale" | "references">;

const projectLeanBrief = (brief: Brief): LeanBrief => ({
  id: brief.id,
  name: brief.name,
  status: brief.status,
  locale: brief.locale,
  references: brief.references,
});

export const runBriefList = async (
  options: RunBriefBaseOptions & { limit?: number; locale?: string; lean?: boolean }
): Promise<PagedResult<Brief>> => {
  const { logger, client } = await prepareBriefClient(options);
  const result = await listBriefs(client, { limit: options.limit, locale: options.locale });
  if (logger.isJson()) {
    if (options.lean) {
      writeBriefEnvelope(
        "list",
        options,
        { ...result, data: result.data.map(projectLeanBrief) },
        { totalCount: result.totalCount },
        true
      );
      return result;
    }
    writeBriefEnvelope("list", options, result, {
      totalCount: result.totalCount,
    });
    return result;
  }
  if (result.data.length === 0) {
    logger.info("No briefs found.", "yellow");
    return result;
  }
  logger.info(`${result.totalCount} brief(s):`, "cyan");
  for (const brief of result.data) {
    logger.info(`  ${brief.id}  ${brief.status.padEnd(10)} ${brief.locale}  ${brief.name}`);
  }
  return result;
};

export const runBriefGet = async (
  options: RunBriefBaseOptions & { briefId: string }
): Promise<Brief> => {
  const { logger, client } = await prepareBriefClient(options);
  const brief = await getBrief(client, options.briefId);
  if (logger.isJson()) {
    writeBriefEnvelope("get", options, brief);
    return brief;
  }
  logger.info(`Brief ${brief.id}`, "cyan");
  logger.info(`  Name:        ${brief.name}`);
  logger.info(`  Status:      ${brief.status}`);
  logger.info(`  Locale:      ${brief.locale}`);
  logger.info(`  Brief type:  ${brief.briefType.id}`);
  logger.info(`  Is template: ${brief.isTemplate}`);
  logger.info(`  Todos:       ${brief.tasks.length}`);
  logger.info(`  Comments:    ${brief.comments.length}`);
  logger.info(`  References:  ${brief.references.length}`);
  logger.info(`  Created:     ${brief.createdOn}`);
  logger.info(`  Updated:     ${brief.updatedOn}`);
  return brief;
};

export const runBriefTypes = async (
  options: RunBriefBaseOptions
): Promise<PagedResult<BriefType>> => {
  const { logger, client } = await prepareBriefClient(options);
  const result = await listBriefTypes(client);
  if (logger.isJson()) {
    writeBriefEnvelope("types", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info("No brief types found.", "yellow");
    return result;
  }
  logger.info(`${result.totalCount} brief type(s):`, "cyan");
  for (const type of result.data) {
    logger.info(`  ${type.id}  ${type.name.padEnd(20)} ${type.fields.length} field(s)`);
  }
  return result;
};

export const runBriefTypeGet = async (
  options: RunBriefBaseOptions & { briefTypeId: string }
): Promise<BriefType> => {
  const { logger, client } = await prepareBriefClient(options);
  const type = await getBriefType(client, options.briefTypeId);
  if (logger.isJson()) {
    writeBriefEnvelope("type.get", options, type);
    return type;
  }
  logger.info(`Brief type ${type.id}`, "cyan");
  logger.info(`  Name:        ${type.name}`);
  logger.info(`  Label:       ${JSON.stringify(type.label)}`);
  logger.info(`  Icon:        ${type.icon} (${type.iconColor})`);
  logger.info(`  Description: ${type.description}`);
  logger.info(`  Fields:      ${type.fields.length}`);
  for (const field of type.fields) {
    logger.info(
      `    - ${field.name.padEnd(20)} ${field.type.padEnd(10)} required=${field.required} aiEditable=${field.aiEditable}`
    );
  }
  logger.info(`  Created:     ${type.createdOn}`);
  logger.info(`  Updated:     ${type.updatedOn}`);
  return type;
};

export const runBriefTypeCreate = async (
  options: RunBriefBaseOptions & { input: CreateBriefTypeInput; whatIf?: boolean }
): Promise<BriefType | { plan: CreateBriefTypeInput }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { plan: options.input };
    if (logger.isJson()) {
      writeBriefEnvelope("type.create", options, plan, { whatIf: true });
    } else {
      logger.info(`Would create brief type '${options.input.name}'.`, "yellow");
      logger.info(`  Label:       ${JSON.stringify(options.input.label)}`);
      logger.info(`  Description: ${options.input.description}`);
      logger.info(`  Fields:      ${options.input.fields.length}`);
    }
    return plan;
  }
  const created = await createBriefType(client, options.input);
  if (logger.isJson()) {
    writeBriefEnvelope("type.create", options, created);
    return created;
  }
  logger.info(`Created brief type ${created.id} (${created.name}).`, "green");
  return created;
};

export const runBriefTypeUpdate = async (
  options: RunBriefBaseOptions & {
    briefTypeId: string;
    input: CreateBriefTypeInput;
    whatIf?: boolean;
  }
): Promise<{ id: string } | { plan: { id: string; input: CreateBriefTypeInput } }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { plan: { id: options.briefTypeId, input: options.input } };
    if (logger.isJson()) {
      writeBriefEnvelope("type.update", options, plan, { whatIf: true });
    } else {
      logger.info(`Would PUT-replace brief type ${options.briefTypeId}.`, "yellow");
      logger.info(`  Name:        ${options.input.name}`);
      logger.info(`  Fields:      ${options.input.fields.length}`);
    }
    return plan;
  }
  await updateBriefType(client, options.briefTypeId, options.input);
  if (logger.isJson()) {
    writeBriefEnvelope("type.update", options, { id: options.briefTypeId });
    return { id: options.briefTypeId };
  }
  logger.info(`Updated brief type ${options.briefTypeId}.`, "green");
  return { id: options.briefTypeId };
};

export const runBriefTypeDelete = async (
  options: RunBriefBaseOptions & { briefTypeId: string; whatIf?: boolean }
): Promise<{ id: string; deleted: boolean }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { id: options.briefTypeId, deleted: false as const };
    if (logger.isJson()) {
      writeBriefEnvelope("type.delete", options, plan, { whatIf: true });
    } else {
      logger.info(`Would delete brief type ${options.briefTypeId}.`, "yellow");
    }
    return plan;
  }
  await deleteBriefType(client, options.briefTypeId);
  const result = { id: options.briefTypeId, deleted: true };
  if (logger.isJson()) {
    writeBriefEnvelope("type.delete", options, result);
    return result;
  }
  logger.info(`Deleted brief type ${options.briefTypeId}.`, "green");
  return result;
};

export const runBriefTodosList = async (
  options: RunBriefBaseOptions & { briefId?: string; assignees?: boolean; limit?: number }
): Promise<PagedResult<BriefTask>> => {
  const { logger, client } = await prepareBriefClient(options);
  const metadataToLoad: BriefTaskMetadata[] = options.assignees ? ["assignees"] : [];
  const result = await listBriefTasks(client, {
    briefId: options.briefId,
    metadataToLoad,
    limit: options.limit,
  });
  if (logger.isJson()) {
    writeBriefEnvelope("todos", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info(
      options.briefId ? `No to-dos on brief ${options.briefId}.` : "No to-dos found.",
      "yellow"
    );
    return result;
  }
  logger.info(`${result.totalCount} to-do(s):`, "cyan");
  for (const todo of result.data) {
    logger.info(`  ${todo.id}  ${JSON.stringify(todo).slice(0, 120)}`);
  }
  return result;
};

export const runBriefCommentsList = async (
  options: RunBriefBaseOptions & { briefId?: string; limit?: number }
): Promise<PagedResult<BriefComment>> => {
  const { logger, client } = await prepareBriefClient(options);
  const result = await listBriefComments(client, {
    briefId: options.briefId,
    limit: options.limit,
  });
  if (logger.isJson()) {
    writeBriefEnvelope("comments", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info(
      options.briefId ? `No comments on brief ${options.briefId}.` : "No comments found.",
      "yellow"
    );
    return result;
  }
  logger.info(`${result.totalCount} comment(s):`, "cyan");
  for (const comment of result.data) {
    logger.info(`  ${comment.id}  ${JSON.stringify(comment).slice(0, 120)}`);
  }
  return result;
};

/**
 * Create a brief instance from a `CreateBriefInput`. Mirrors
 * `runBriefTypeCreate` — honours `whatIf` for a plan-only dry run. The
 * SDK `createBrief` is verified against the Agents tenant.
 */
export const runBriefCreate = async (
  options: RunBriefBaseOptions & { input: CreateBriefInput; whatIf?: boolean }
): Promise<Brief | { plan: CreateBriefInput }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { plan: options.input };
    if (logger.isJson()) {
      writeBriefEnvelope("create", options, plan, { whatIf: true });
    } else {
      logger.info(`Would create brief '${options.input.name}'.`, "yellow");
      logger.info(`  Brief type:  ${options.input.briefTypeId}`);
      if (options.input.locale) logger.info(`  Locale:      ${options.input.locale}`);
      const fieldCount = Object.keys(options.input.fields ?? {}).length;
      logger.info(`  Fields:      ${fieldCount}`);
    }
    return plan;
  }
  const created = await createBrief(client, options.input);
  if (logger.isJson()) {
    writeBriefEnvelope("create", options, created);
    return created;
  }
  logger.info(`Created brief ${created.id} (${created.name}).`, "green");
  return created;
};

/**
 * Update a brief instance by id with a partial patch (`PUT`). Accepts
 * any subset of `CreateBriefInput` plus an optional `status`. Mirrors
 * `runBriefTypeUpdate` — honours `whatIf` for a plan-only dry run. The
 * status-only PUT path is verified (2026-05-15); other partial fields
 * are wired the same way but not smoke-tested.
 */
export const runBriefUpdate = async (
  options: RunBriefBaseOptions & {
    briefId: string;
    patch: Partial<CreateBriefInput> & { status?: BriefStatus };
    whatIf?: boolean;
  }
): Promise<
  | { id: string }
  | { plan: { id: string; patch: Partial<CreateBriefInput> & { status?: BriefStatus } } }
> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { plan: { id: options.briefId, patch: options.patch } };
    if (logger.isJson()) {
      writeBriefEnvelope("update", options, plan, { whatIf: true });
    } else {
      logger.info(`Would PUT-update brief ${options.briefId}.`, "yellow");
      const keys = Object.keys(options.patch);
      logger.info(`  Patch keys:  ${keys.length === 0 ? "(none)" : keys.join(", ")}`);
    }
    return plan;
  }
  await updateBrief(client, options.briefId, options.patch);
  if (logger.isJson()) {
    writeBriefEnvelope("update", options, { id: options.briefId });
    return { id: options.briefId };
  }
  logger.info(`Updated brief ${options.briefId}.`, "green");
  return { id: options.briefId };
};

/**
 * Delete a brief instance. Mirrors `runBriefTypeDelete` — honours
 * `whatIf` for a plan-only dry run. SDK `deleteBrief` is verified
 * against the Agents tenant.
 *
 * Pre-delete unlink: before issuing the DELETE we PUT
 * `{references: []}` to clear the brief's external references. The
 * dangling-reference bug on Orchestrate's `deleteProject` (which
 * tries to detach `project.briefs[]` entries before completing, and
 * 403s when those briefs are already gone) is downstream of briefs
 * that get deleted without clearing their references first. Doing
 * the unlink at the source — the brief side — gives Orchestrate's
 * reverse-view machinery a chance to clean up the project's
 * `briefs[]` while the brief is still alive. Best-effort: a failure
 * on the unlink step is logged but doesn't block the delete (the
 * brief still ends up gone, which is the user's goal; only the
 * downstream project might carry a dangling ref).
 *
 * Probed 2026-06-04: clearing references via updateBrief is a clean
 * no-op on briefs that have none; safe to apply unconditionally.
 */
export const runBriefDelete = async (
  options: RunBriefBaseOptions & { briefId: string; whatIf?: boolean }
): Promise<{ id: string; deleted: boolean }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { id: options.briefId, deleted: false as const };
    if (logger.isJson()) {
      writeBriefEnvelope("delete", options, { plan }, { whatIf: true });
    } else {
      logger.info(`Would delete brief ${options.briefId}.`, "yellow");
    }
    return plan;
  }
  try {
    await updateBrief(client, options.briefId, { references: [] });
  } catch (error) {
    logger.verbose(
      `Pre-delete unlink failed for brief ${options.briefId} (continuing with delete): ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await deleteBrief(client, options.briefId);
  const result = { id: options.briefId, deleted: true };
  if (logger.isJson()) {
    writeBriefEnvelope("delete", options, result);
    return result;
  }
  logger.info(`Deleted brief ${options.briefId}.`, "green");
  return result;
};

/**
 * Post a comment to a brief. Verified against TestDemo 2026-06-03 —
 * `authorId` is required; the server records `author` as the
 * impersonated user while `createdBy` captures the actual caller.
 * Honours `whatIf`.
 */
export const runBriefCommentAdd = async (
  options: RunBriefBaseOptions & {
    briefId: string;
    text: string;
    authorId: string;
    whatIf?: boolean;
  }
): Promise<BriefComment | { plan: { briefId: string; text: string; authorId: string } }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = {
      plan: {
        briefId: options.briefId,
        text: options.text,
        authorId: options.authorId,
      },
    };
    if (logger.isJson()) {
      writeBriefEnvelope("comment.add", options, plan, { whatIf: true });
    } else {
      logger.info(`Would post a comment to brief ${options.briefId}.`, "yellow");
    }
    return plan;
  }
  const created = await createBriefComment(client, {
    briefId: options.briefId,
    text: options.text,
    authorId: options.authorId,
  });
  if (logger.isJson()) {
    writeBriefEnvelope("comment.add", options, created);
    return created;
  }
  logger.info(`Posted comment ${created.id} to brief ${options.briefId}.`, "green");
  return created;
};

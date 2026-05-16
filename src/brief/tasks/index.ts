import { Logger } from "@/shared/logger";
import { resolveEnvironment } from "@/shared/env";
import { resolveRegionalBaseUrl } from "@/shared/region";
import { requestClientCredentialsToken } from "@/serialization/api/auth";
import { acquireBriefToken } from "../auth";
import { BRIEF_API_HOST_TEMPLATE } from "../api/types";
import { listBriefs, getBrief, setBriefStatus } from "../api/briefs";
import {
  createBriefType,
  deleteBriefType,
  getBriefType,
  listBriefTypes,
  updateBriefType,
  type CreateBriefTypeInput,
} from "../api/brief-types";
import { listBriefTasks, type BriefTaskMetadata } from "../api/tasks";
import { listBriefComments } from "../api/comments";
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
 * `Logger`. Shared scaffolding (env+token+client) lives in
 * `prepareBriefClient()` to avoid 5x copy-paste.
 *
 * Read verbs:
 *   - `runBriefList`     — list briefs
 *   - `runBriefShow`     — read one brief by id
 *   - `runBriefTypes`    — list brief types
 *   - `runBriefTypeGet`  — read one brief type by id
 *   - `runBriefTasksList`— list tasks (optionally filtered to a brief)
 *   - `runBriefCommentsList` — list comments (optionally filtered)
 *
 * BriefType write verbs (verified 2026-05-15):
 *   - `runBriefTypeCreate` / `runBriefTypeUpdate` / `runBriefTypeDelete`
 *
 * Each write runner honours an `options.whatIf` flag — when set, it
 * skips the API call and emits a plan-only summary. The CLI layer wires
 * this via `withApplyGate` so destructive verbs dry-run by default.
 *
 * Brief instance writes (`createBrief` etc.) live in the SDK but aren't
 * yet exposed at the CLI — they're wired but not smoke-tested end-to-end.
 */

export interface RunBriefBaseOptions {
  config?: string;
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
): Promise<{ logger: Logger; client: BriefApiClientOptions; envName: string }> => {
  const logger = toLogger(options);
  const { envName, environment } = resolveEnvironment(options);
  const accessToken = await acquireBriefToken({ envName, environment });
  // Host is region-resolved from the org id (shared resolver); an env
  // profile may pin `briefBaseUrl` to override it. The brief token is
  // scoped to `co.briefs:*`, so the region lookup mints a separate
  // no-scope M2M token that carries `platform.tenants:listall`.
  const baseUrl = await resolveRegionalBaseUrl({
    hostTemplate: BRIEF_API_HOST_TEMPLATE,
    organizationId: environment.organizationId,
    override: (environment as unknown as { briefBaseUrl?: string }).briefBaseUrl,
    acquireToken: async () => (await requestClientCredentialsToken(environment)).accessToken,
  });
  return { logger, envName, client: { accessToken, baseUrl } };
};

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const runBriefList = async (
  options: RunBriefBaseOptions & { limit?: number; locale?: string }
): Promise<PagedResult<Brief>> => {
  const { logger, client } = await prepareBriefClient(options);
  const result = await listBriefs(client, { limit: options.limit, locale: options.locale });
  if (logger.isJson()) {
    writeJson(result);
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

export const runBriefShow = async (
  options: RunBriefBaseOptions & { briefId: string }
): Promise<Brief> => {
  const { logger, client } = await prepareBriefClient(options);
  const brief = await getBrief(client, options.briefId);
  if (logger.isJson()) {
    writeJson(brief);
    return brief;
  }
  logger.info(`Brief ${brief.id}`, "cyan");
  logger.info(`  Name:        ${brief.name}`);
  logger.info(`  Status:      ${brief.status}`);
  logger.info(`  Locale:      ${brief.locale}`);
  logger.info(`  Brief type:  ${brief.briefType.id}`);
  logger.info(`  Is template: ${brief.isTemplate}`);
  logger.info(`  Tasks:       ${brief.tasks.length}`);
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
    writeJson(result);
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

export const runBriefSetStatus = async (
  options: RunBriefBaseOptions & {
    briefId: string;
    status: BriefStatus;
    whatIf?: boolean;
  }
): Promise<{ id: string; status: BriefStatus } | { plan: { id: string; status: BriefStatus } }> => {
  const { logger, client } = await prepareBriefClient(options);
  if (options.whatIf) {
    const plan = { plan: { id: options.briefId, status: options.status } };
    if (logger.isJson()) {
      writeJson(plan);
    } else {
      logger.info(`Would set brief ${options.briefId} status to '${options.status}'.`, "yellow");
    }
    return plan;
  }
  await setBriefStatus(client, options.briefId, options.status);
  const result = { id: options.briefId, status: options.status };
  if (logger.isJson()) {
    writeJson(result);
    return result;
  }
  logger.info(`Brief ${options.briefId} status set to '${options.status}'.`, "green");
  return result;
};

export const runBriefTypeGet = async (
  options: RunBriefBaseOptions & { briefTypeId: string }
): Promise<BriefType> => {
  const { logger, client } = await prepareBriefClient(options);
  const type = await getBriefType(client, options.briefTypeId);
  if (logger.isJson()) {
    writeJson(type);
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
      writeJson(plan);
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
    writeJson(created);
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
      writeJson(plan);
    } else {
      logger.info(`Would PUT-replace brief type ${options.briefTypeId}.`, "yellow");
      logger.info(`  Name:        ${options.input.name}`);
      logger.info(`  Fields:      ${options.input.fields.length}`);
    }
    return plan;
  }
  await updateBriefType(client, options.briefTypeId, options.input);
  if (logger.isJson()) {
    writeJson({ id: options.briefTypeId });
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
      writeJson({ plan });
    } else {
      logger.info(`Would delete brief type ${options.briefTypeId}.`, "yellow");
    }
    return plan;
  }
  await deleteBriefType(client, options.briefTypeId);
  const result = { id: options.briefTypeId, deleted: true };
  if (logger.isJson()) {
    writeJson(result);
    return result;
  }
  logger.info(`Deleted brief type ${options.briefTypeId}.`, "green");
  return result;
};

export const runBriefTasksList = async (
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
    writeJson(result);
    return result;
  }
  if (result.data.length === 0) {
    logger.info(
      options.briefId ? `No tasks on brief ${options.briefId}.` : "No tasks found.",
      "yellow"
    );
    return result;
  }
  logger.info(`${result.totalCount} task(s):`, "cyan");
  for (const task of result.data) {
    logger.info(`  ${task.id}  ${JSON.stringify(task).slice(0, 120)}`);
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
    writeJson(result);
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

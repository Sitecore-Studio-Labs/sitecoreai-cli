import { Logger } from "@/shared/logger";
import { buildScaiEnvelope } from "@/shared/envelope";
import { resolveCampaignClient } from "../client";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  unlinkBriefFromProject,
  type CreateProjectInput,
} from "../api/projects";
import {
  createDeliverable,
  deleteDeliverable,
  type CreateDeliverableInput,
} from "../api/deliverables";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "../api/tasks";
import { listUsers } from "../api/users";
import type { CampaignUser, Deliverable, PagedResult, Project, Task } from "../api/schema";
import type { CampaignApiClientOptions } from "../api/types";

/**
 * CLI runners for the `scai ops campaign …` command family.
 *
 * Each runner resolves the env, acquires an Orchestrate-scoped token,
 * calls the library helper, then prints human or JSON output. The
 * env+token+client orchestration lives in the exported
 * `resolveCampaignClient()` (see `../client.ts`); `prepareCampaignClient()`
 * only pairs it with a CLI `Logger`.
 *
 * Write runners (`create`, `update`, `delete`) honour an `options.whatIf`
 * flag — when set they skip the API call and emit a plan-only summary.
 * The CLI layer wires this via `withApplyGate`.
 *
 * The `delete` runners call SDK helpers whose DELETE endpoints are
 * UNVERIFIED (never captured during reverse-engineering) — see the SDK
 * doc comments and `scripts/_smoke-campaign-delete.ts`.
 */

export interface RunCampaignBaseOptions {
  config?: string;
  /** Explicit organization id (`--org-id`). The Orchestrate API is org-scoped. */
  orgId?: string;
  /** Env profile name — used only to derive its `organizationId`. */
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
}

const toLogger = (options: RunCampaignBaseOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

const prepareCampaignClient = async (
  options: RunCampaignBaseOptions
): Promise<{ logger: Logger; client: CampaignApiClientOptions; orgId: string }> => {
  const logger = toLogger(options);
  const { client, orgId } = await resolveCampaignClient(options);
  return { logger, orgId, client };
};

/**
 * Emit a canonical `ScaiEnvelope` under `--json`. Each call site
 * passes the command suffix (`list`, `get`, `task.create`, …) — the
 * helper prefixes it with `campaign.` and threads through the env
 * name from the options bag.
 */
const writeCampaignEnvelope = (
  command: string,
  options: RunCampaignBaseOptions,
  data: unknown,
  extra?: Record<string, unknown>,
  compact = false
): void => {
  const envelope = buildScaiEnvelope({
    command: `campaign.${command}`,
    environment: options.environmentName ?? null,
    data,
    extra,
  });
  const json = compact ? JSON.stringify(envelope) : JSON.stringify(envelope, null, 2);
  process.stdout.write(`${json}\n`);
};

/**
 * Identity + linkage fields of a project ("campaign") — everything a
 * tenant scan needs to match and route a project, without the heavy
 * `deliverables`, `members`, `attachments`, and `context` arrays that
 * dominate a full `Project`. Emitted by `runCampaignList({ lean })`.
 */
export type LeanProject = Pick<Project, "id" | "name" | "labels" | "brandkit_id" | "status">;

const projectLeanCampaign = (p: Project): LeanProject => ({
  id: p.id,
  name: p.name,
  labels: p.labels,
  brandkit_id: p.brandkit_id,
  status: p.status,
});

export const runCampaignList = async (
  options: RunCampaignBaseOptions & { limit?: number; lean?: boolean }
): Promise<PagedResult<Project>> => {
  const { logger, client } = await prepareCampaignClient(options);
  const result = await listProjects(client, { limit: options.limit });
  if (logger.isJson()) {
    if (options.lean) {
      writeCampaignEnvelope(
        "list",
        options,
        { ...result, data: result.data.map(projectLeanCampaign) },
        { totalCount: result.totalCount },
        true
      );
      return result;
    }
    writeCampaignEnvelope("list", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info("No campaigns found.", "yellow");
    return result;
  }
  logger.info(`${result.totalCount} campaign(s):`, "cyan");
  for (const p of result.data) {
    logger.info(`  ${p.id}  ${p.status.padEnd(12)} ${p.name}`);
  }
  return result;
};

export const runCampaignGet = async (
  options: RunCampaignBaseOptions & { campaignId: string }
): Promise<Project> => {
  const { logger, client } = await prepareCampaignClient(options);
  const project = await getProject(client, options.campaignId);
  if (logger.isJson()) {
    writeCampaignEnvelope("get", options, project);
    return project;
  }
  logger.info(`Campaign ${project.id}`, "cyan");
  logger.info(`  Name:         ${project.name}`);
  logger.info(`  Status:       ${project.status}`);
  logger.info(`  Description:  ${project.description}`);
  logger.info(`  Start:        ${project.start_date ?? "—"}`);
  logger.info(`  Due:          ${project.due_date ?? "—"}`);
  logger.info(`  Brand kit:    ${project.brandkit_id ?? "—"}`);
  logger.info(`  Progress:     ${Math.round(project.project_progress * 100)}%`);
  logger.info(`  Members:      ${project.members.length}`);
  logger.info(`  Deliverables: ${project.deliverables.length}`);
  for (const d of project.deliverables) {
    logger.info(`    - ${d.id}  ${d.name} (${d.funnel_stage}, ${d.tasks.length} task(s))`);
  }
  return project;
};

export const runCampaignUsers = async (
  options: RunCampaignBaseOptions
): Promise<PagedResult<CampaignUser>> => {
  const { logger, client } = await prepareCampaignClient(options);
  const result = await listUsers(client);
  if (logger.isJson()) {
    writeCampaignEnvelope("users", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info("No users found.", "yellow");
    return result;
  }
  logger.info(`${result.totalCount} user(s):`, "cyan");
  for (const u of result.data) {
    logger.info(`  ${u.id}  ${`${u.given_name} ${u.family_name}`.padEnd(24)} ${u.email}`);
  }
  return result;
};

export const runCampaignCreate = async (
  options: RunCampaignBaseOptions & { input: CreateProjectInput; whatIf?: boolean }
): Promise<Project | { plan: CreateProjectInput }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { plan: options.input };
    if (logger.isJson()) writeCampaignEnvelope("create", options, plan, { whatIf: true });
    else logger.info(`Would create campaign '${options.input.name}'.`, "yellow");
    return plan;
  }
  const created = await createProject(client, options.input);
  if (logger.isJson()) {
    writeCampaignEnvelope("create", options, created);
    return created;
  }
  logger.info(`Created campaign ${created.id} (${created.name}).`, "green");
  return created;
};

export const runDeliverableCreate = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    input: CreateDeliverableInput;
    whatIf?: boolean;
  }
): Promise<Deliverable | { plan: CreateDeliverableInput }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { plan: options.input };
    if (logger.isJson())
      writeCampaignEnvelope("deliverable.create", options, plan, { whatIf: true });
    else
      logger.info(
        `Would create deliverable '${options.input.name}' on campaign ${options.campaignId}.`,
        "yellow"
      );
    return plan;
  }
  const created = await createDeliverable(client, options.campaignId, options.input);
  if (logger.isJson()) {
    writeCampaignEnvelope("deliverable.create", options, created);
    return created;
  }
  logger.info(`Created deliverable ${created.id} (${created.name}).`, "green");
  return created;
};

export const runTaskList = async (
  options: RunCampaignBaseOptions & { campaignId: string; deliverableId: string }
): Promise<PagedResult<Task>> => {
  const { logger, client } = await prepareCampaignClient(options);
  const result = await listTasks(client, options.campaignId, options.deliverableId);
  if (logger.isJson()) {
    writeCampaignEnvelope("task.list", options, result, { totalCount: result.totalCount });
    return result;
  }
  if (result.data.length === 0) {
    logger.info("No tasks found.", "yellow");
    return result;
  }
  logger.info(`${result.totalCount} task(s):`, "cyan");
  for (const t of result.data) {
    logger.info(`  ${t.id}  ${t.status.padEnd(12)} ${t.name}`);
  }
  return result;
};

export const runTaskGet = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    taskId: string;
  }
): Promise<Task> => {
  const { logger, client } = await prepareCampaignClient(options);
  const task = await getTask(client, options.campaignId, options.deliverableId, options.taskId);
  if (logger.isJson()) {
    writeCampaignEnvelope("task.get", options, task);
    return task;
  }
  logger.info(`Task ${task.id}`, "cyan");
  logger.info(`  Name:     ${task.name}`);
  logger.info(`  Status:   ${task.status}`);
  logger.info(`  Priority: ${task.priority ?? "—"}`);
  logger.info(`  Due:      ${task.due_date ?? "—"}`);
  logger.info(`  Assignee: ${task.assignee ?? "—"}`);
  return task;
};

export const runTaskCreate = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    input: CreateTaskInput;
    whatIf?: boolean;
  }
): Promise<Task | { plan: CreateTaskInput }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { plan: options.input };
    if (logger.isJson()) writeCampaignEnvelope("task.create", options, plan, { whatIf: true });
    else logger.info(`Would create task '${options.input.name}'.`, "yellow");
    return plan;
  }
  const created = await createTask(
    client,
    options.campaignId,
    options.deliverableId,
    options.input
  );
  if (logger.isJson()) {
    writeCampaignEnvelope("task.create", options, created);
    return created;
  }
  logger.info(`Created task ${created.id} (${created.name}).`, "green");
  return created;
};

export const runTaskUpdate = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    taskId: string;
    input: UpdateTaskInput;
    whatIf?: boolean;
  }
): Promise<Task | { plan: { id: string; input: UpdateTaskInput } }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { plan: { id: options.taskId, input: options.input } };
    if (logger.isJson()) writeCampaignEnvelope("task.update", options, plan, { whatIf: true });
    else logger.info(`Would PUT-replace task ${options.taskId}.`, "yellow");
    return plan;
  }
  const updated = await updateTask(
    client,
    options.campaignId,
    options.deliverableId,
    options.taskId,
    options.input
  );
  if (logger.isJson()) {
    writeCampaignEnvelope("task.update", options, updated);
    return updated;
  }
  logger.info(`Updated task ${updated.id}.`, "green");
  return updated;
};

/**
 * Detach every brief still linked to the project BEFORE deleting it.
 *
 * The brief↔campaign relationship is a CAMPAIGN-side sub-resource:
 * `DELETE /api/orchestrate/v1/projects/{campaignId}/briefs/{briefId}` clears
 * it, using the same campaign credential the delete already holds (see
 * {@link unlinkBriefFromProject}). `deleteProject` walks the project's
 * `briefs[]` reverse view and 403s ("Failed to detach link from brief") if any
 * brief is still attached, so we drop each one here first.
 *
 * Order matters at the caller: this only works while the linked briefs are
 * still alive, so any cascade must delete the campaign BEFORE its briefs.
 * A brief that's already been deleted (404) leaves a dangling reverse-view
 * entry we cannot clear — the pre-existing un-recoverable orphan case.
 *
 * Best-effort + idempotent per brief: a failed unlink logs and continues so
 * the delete still runs (and surfaces the 403 if the link truly remains).
 */
const detachLinkedBriefs = async (
  campaignClient: CampaignApiClientOptions,
  campaignId: string,
  logger: Logger
): Promise<void> => {
  const fmt = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  let project: Project;
  try {
    project = await getProject(campaignClient, campaignId);
  } catch (err) {
    logger.verbose(
      `Pre-delete detach: could not read project ${campaignId} (continuing with delete): ${fmt(err)}`
    );
    return;
  }
  const linkedBriefIds = (project.briefs ?? [])
    .map((b) => (b && typeof b === "object" ? (b as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (linkedBriefIds.length === 0) return;

  logger.verbose(
    `Pre-delete detach: unlinking ${linkedBriefIds.length} brief(s) from campaign ${campaignId}.`
  );
  for (const briefId of linkedBriefIds) {
    try {
      await unlinkBriefFromProject(campaignClient, campaignId, briefId);
    } catch (err) {
      logger.verbose(`Pre-delete detach: brief ${briefId} unlink failed (continuing): ${fmt(err)}`);
    }
  }
};

/**
 * Delete a campaign (Orchestrate project). Detaches any still-linked
 * briefs first (see {@link detachLinkedBriefs}) so the reverse-view
 * 403 doesn't block the delete.
 *
 * UNVERIFIED — the underlying `deleteProject` DELETE endpoint was never
 * captured; it is wired optimistically per REST conventions.
 */
export const runCampaignDelete = async (
  options: RunCampaignBaseOptions & { campaignId: string; whatIf?: boolean }
): Promise<{ id: string; deleted: boolean }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { id: options.campaignId, deleted: false as const };
    if (logger.isJson()) {
      writeCampaignEnvelope("delete", options, { plan }, { whatIf: true });
    } else {
      logger.info(`Would delete campaign ${options.campaignId}.`, "yellow");
    }
    return plan;
  }
  // Best-effort: detach failures must not block the campaign delete. The
  // per-brief loop already swallows its own errors; this guards the residual
  // throw paths (e.g. the project read) so the delete still runs.
  try {
    await detachLinkedBriefs(client, options.campaignId, logger);
  } catch (err) {
    logger.warn(
      `Pre-delete detach failed for campaign ${options.campaignId} (continuing with delete): ${
        err instanceof Error ? err.message : String(err)
      }`,
      "yellow"
    );
  }
  await deleteProject(client, options.campaignId);
  const result = { id: options.campaignId, deleted: true };
  if (logger.isJson()) {
    writeCampaignEnvelope("delete", options, result);
    return result;
  }
  logger.info(`Deleted campaign ${options.campaignId}.`, "green");
  return result;
};

/**
 * Delete a deliverable under a campaign.
 *
 * UNVERIFIED — the underlying `deleteDeliverable` DELETE endpoint was
 * never captured; it is wired optimistically per REST conventions.
 */
export const runDeliverableDelete = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    whatIf?: boolean;
  }
): Promise<{ id: string; deleted: boolean }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { id: options.deliverableId, deleted: false as const };
    if (logger.isJson()) {
      writeCampaignEnvelope("deliverable.delete", options, { plan }, { whatIf: true });
    } else {
      logger.info(
        `Would delete deliverable ${options.deliverableId} on campaign ${options.campaignId}.`,
        "yellow"
      );
    }
    return plan;
  }
  await deleteDeliverable(client, options.campaignId, options.deliverableId);
  const result = { id: options.deliverableId, deleted: true };
  if (logger.isJson()) {
    writeCampaignEnvelope("deliverable.delete", options, result);
    return result;
  }
  logger.info(`Deleted deliverable ${options.deliverableId}.`, "green");
  return result;
};

/**
 * Delete a task under a deliverable.
 *
 * UNVERIFIED — the underlying `deleteTask` DELETE endpoint was never
 * captured; it is wired optimistically per REST conventions.
 */
export const runTaskDelete = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    taskId: string;
    whatIf?: boolean;
  }
): Promise<{ id: string; deleted: boolean }> => {
  const { logger, client } = await prepareCampaignClient(options);
  if (options.whatIf) {
    const plan = { id: options.taskId, deleted: false as const };
    if (logger.isJson()) {
      writeCampaignEnvelope("task.delete", options, { plan }, { whatIf: true });
    } else {
      logger.info(`Would delete task ${options.taskId}.`, "yellow");
    }
    return plan;
  }
  await deleteTask(client, options.campaignId, options.deliverableId, options.taskId);
  const result = { id: options.taskId, deleted: true };
  if (logger.isJson()) {
    writeCampaignEnvelope("task.delete", options, result);
    return result;
  }
  logger.info(`Deleted task ${options.taskId}.`, "green");
  return result;
};

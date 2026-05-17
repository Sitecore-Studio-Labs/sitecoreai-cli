import { Logger } from "@/shared/logger";
import { resolveCampaignClient } from "../client";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
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
): Promise<{ logger: Logger; client: CampaignApiClientOptions; envName: string }> => {
  const logger = toLogger(options);
  const { client, envName } = await resolveCampaignClient(options);
  return { logger, envName, client };
};

const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

export const runCampaignList = async (
  options: RunCampaignBaseOptions & { limit?: number }
): Promise<PagedResult<Project>> => {
  const { logger, client } = await prepareCampaignClient(options);
  const result = await listProjects(client, { limit: options.limit });
  if (logger.isJson()) {
    writeJson(result);
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

export const runCampaignShow = async (
  options: RunCampaignBaseOptions & { campaignId: string }
): Promise<Project> => {
  const { logger, client } = await prepareCampaignClient(options);
  const project = await getProject(client, options.campaignId);
  if (logger.isJson()) {
    writeJson(project);
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
    writeJson(result);
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
    if (logger.isJson()) writeJson(plan);
    else logger.info(`Would create campaign '${options.input.name}'.`, "yellow");
    return plan;
  }
  const created = await createProject(client, options.input);
  if (logger.isJson()) {
    writeJson(created);
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
    if (logger.isJson()) writeJson(plan);
    else
      logger.info(
        `Would create deliverable '${options.input.name}' on campaign ${options.campaignId}.`,
        "yellow"
      );
    return plan;
  }
  const created = await createDeliverable(client, options.campaignId, options.input);
  if (logger.isJson()) {
    writeJson(created);
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
    writeJson(result);
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

export const runTaskShow = async (
  options: RunCampaignBaseOptions & {
    campaignId: string;
    deliverableId: string;
    taskId: string;
  }
): Promise<Task> => {
  const { logger, client } = await prepareCampaignClient(options);
  const task = await getTask(client, options.campaignId, options.deliverableId, options.taskId);
  if (logger.isJson()) {
    writeJson(task);
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
    if (logger.isJson()) writeJson(plan);
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
    writeJson(created);
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
    if (logger.isJson()) writeJson(plan);
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
    writeJson(updated);
    return updated;
  }
  logger.info(`Updated task ${updated.id}.`, "green");
  return updated;
};

/**
 * Delete a campaign (Orchestrate project).
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
      writeJson({ plan });
    } else {
      logger.info(`Would delete campaign ${options.campaignId}.`, "yellow");
    }
    return plan;
  }
  await deleteProject(client, options.campaignId);
  const result = { id: options.campaignId, deleted: true };
  if (logger.isJson()) {
    writeJson(result);
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
      writeJson({ plan });
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
    writeJson(result);
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
      writeJson({ plan });
    } else {
      logger.info(`Would delete task ${options.taskId}.`, "yellow");
    }
    return plan;
  }
  await deleteTask(client, options.campaignId, options.deliverableId, options.taskId);
  const result = { id: options.taskId, deleted: true };
  if (logger.isJson()) {
    writeJson(result);
    return result;
  }
  logger.info(`Deleted task ${options.taskId}.`, "green");
  return result;
};

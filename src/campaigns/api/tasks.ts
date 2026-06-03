import { campaignRequest } from "./request";
import type { PagedResult, Task } from "./schema";
import type { CampaignApiClientOptions } from "./types";

/**
 * Tasks resource — the leaf work items under a deliverable.
 *
 * Endpoint surface (HAR-derived 2026-05-15):
 *   GET    …/projects/{p}/deliverables/{d}/tasks       — list (paged)
 *   GET    …/projects/{p}/deliverables/{d}/tasks/{t}   — read one
 *   POST   …/projects/{p}/deliverables/{d}/tasks       — create (201)
 *   PUT    …/projects/{p}/deliverables/{d}/tasks/{t}   — full-replacement update
 *   DELETE …/projects/{p}/deliverables/{d}/tasks/{t}   — delete (UNVERIFIED)
 *
 * `description` is HTML; `assignee` is an Auth0 subject. `deleteTask` is
 * wired optimistically per REST conventions; see its doc comment.
 */

const tasksPath = (projectId: string, deliverableId: string): string =>
  `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}` +
  `/deliverables/${encodeURIComponent(deliverableId)}/tasks`;

/** List tasks under a deliverable (paged). */
export const listTasks = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string
): Promise<PagedResult<Task>> =>
  campaignRequest<PagedResult<Task>>(options, tasksPath(projectId, deliverableId));

/** Read a single task by id. */
export const getTask = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string,
  taskId: string
): Promise<Task> =>
  campaignRequest<Task>(
    options,
    `${tasksPath(projectId, deliverableId)}/${encodeURIComponent(taskId)}`
  );

/** Input for `createTask`. Field set observed on the wire. */
export type CreateTaskInput = {
  name: string;
  due_date?: string;
  status?: string;
  dependencies?: unknown[];
};

/**
 * The Orchestrate API rejects `POST .../tasks` with HTTP 422
 * `{detail: [{loc:["body","due_date"], msg:"Field required"}]}` when
 * `due_date` is absent (verified 2026-06-03). Default to ~30 days out
 * when the input omits one so an operator-added task without a
 * date still lands on first push.
 */
const DEFAULT_TASK_DUE_DATE_DAYS_OUT = 30;
const defaultTaskDueDate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_TASK_DUE_DATE_DAYS_OUT);
  return d.toISOString().slice(0, 10);
};

/** Create a task under a deliverable. Returns the persisted record (201). */
export const createTask = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string,
  input: CreateTaskInput
): Promise<Task> =>
  campaignRequest<Task>(options, tasksPath(projectId, deliverableId), {
    method: "POST",
    body: {
      project_id: projectId,
      project_deliverable_id: deliverableId,
      name: input.name,
      due_date: input.due_date ?? defaultTaskDueDate(),
      status: input.status ?? "NOT_STARTED",
      archived: false,
      dependencies: input.dependencies ?? [],
    },
  });

/**
 * Input for `updateTask`. PUT is full-replacement — fetch the task
 * first and merge if you only mean to change one field.
 */
export type UpdateTaskInput = {
  name: string;
  due_date?: string;
  status?: string;
  priority?: string | null;
  description?: string | null;
  assignee?: string | null;
  labels?: string[];
  dependencies?: unknown[];
  archived?: boolean;
};

/** Full-replacement update of a task (PUT). Returns the persisted record. */
export const updateTask = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string,
  taskId: string,
  input: UpdateTaskInput
): Promise<Task> =>
  campaignRequest<Task>(
    options,
    `${tasksPath(projectId, deliverableId)}/${encodeURIComponent(taskId)}`,
    {
      method: "PUT",
      body: {
        project_id: projectId,
        project_deliverable_id: deliverableId,
        name: input.name,
        due_date: input.due_date,
        status: input.status ?? "NOT_STARTED",
        priority: input.priority ?? null,
        description: input.description ?? null,
        assignee: input.assignee ?? null,
        labels: input.labels ?? [],
        dependencies: input.dependencies ?? [],
        archived: input.archived ?? false,
      },
    }
  );

/**
 * Delete a task
 * (`DELETE …/projects/{p}/deliverables/{d}/tasks/{t}`). Returns void —
 * a 204 is expected on success.
 *
 * UNVERIFIED — DELETE was never captured; inferred from REST conventions
 * (the same single-task path `getTask`/`updateTask` use). Smoke-test
 * before relying on it.
 */
export const deleteTask = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string,
  taskId: string
): Promise<void> =>
  campaignRequest<void>(
    options,
    `${tasksPath(projectId, deliverableId)}/${encodeURIComponent(taskId)}`,
    { method: "DELETE" }
  );

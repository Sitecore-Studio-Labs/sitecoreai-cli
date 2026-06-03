import { briefRequest } from "./request";
import type { BriefTask, PagedResult } from "./schema";
import type { BriefApiClientOptions, BriefQueryRecord } from "./types";

/**
 * Tasks resource on the Brief API.
 *
 * Naming note: the Content Operations UI — and scai's CLI/MCP surface —
 * label these "to-dos". The wire resource is `tasks`; the SDK names below
 * mirror the wire for fidelity. The user-facing surface is `todos`
 * (`scai ops brief todos`, `runBriefTodosList`, MCP verb 'todos').
 *
 * Endpoint surface (reverse-engineered):
 *   GET /api/brief/v1/tasks?BriefId=<uuid>&MetadataToLoad=assignees
 *
 * Known query parameters:
 *  - `BriefId` (uuid) — filters tasks to a single brief. Optional —
 *    the bare endpoint returns the tenant-wide task list.
 *  - `MetadataToLoad` (csv) — expand directives. Confirmed: `assignees`.
 *    Other valid values TBD.
 *  - `Limit` (int) — page size.
 *  - `Next` (string) — pagination cursor from the previous response.
 *
 * The task object shape is provisional — the probe tenant had zero
 * tasks at discovery time. Tighten `BriefTask` in `./schema.ts` once
 * a payload is captured.
 */

/** Metadata expansion options for task list responses. */
export type BriefTaskMetadata = "assignees";

export type ListBriefTasksQuery = {
  /** Filter to one brief. Omit for tenant-wide list. */
  briefId?: string;
  /** Expand directives — e.g. `["assignees"]`. */
  metadataToLoad?: BriefTaskMetadata[];
  /** Page size. */
  limit?: number;
  /** Cursor from previous response. */
  next?: string;
};

/** List tasks (optionally filtered by brief). */
export const listBriefTasks = (
  options: BriefApiClientOptions,
  query?: ListBriefTasksQuery
): Promise<PagedResult<BriefTask>> => {
  const params: BriefQueryRecord = {};
  if (query?.briefId) params.BriefId = query.briefId;
  if (query?.metadataToLoad && query.metadataToLoad.length > 0) {
    params.MetadataToLoad = query.metadataToLoad.join(",");
  }
  if (query?.limit !== undefined) params.Limit = query.limit;
  if (query?.next) params.Next = query.next;
  return briefRequest<PagedResult<BriefTask>>(options, "/api/brief/v1/tasks", {
    query: params,
  });
};

/** Read a single task by id. **Untested** — inferred from REST conventions. */
export const getBriefTask = (options: BriefApiClientOptions, taskId: string): Promise<BriefTask> =>
  briefRequest<BriefTask>(options, `/api/brief/v1/tasks/${encodeURIComponent(taskId)}`);

/**
 * Input for `createBriefTask` — the verb behind "post a to-do".
 *
 * Verified against TestDemo 2026-06-03. The persisted task carries
 * `{id, title, status, assignees, brief, createdOn, createdBy,
 * updatedOn, updatedBy}` — nothing else. Probed fields that are
 * silently dropped: `description`, `body`, `dueDate`, `DueOn`. The
 * `status` field is locked to `"Pending"` on create regardless of
 * what's posted (server overrides). To set status, fall back to the
 * (unverified) PATCH endpoint after create.
 */
export type CreateBriefTaskInput = {
  /** Brief the to-do attaches to. */
  briefId: string;
  /** Short verb phrase shown in the brief's to-do list. Required. */
  title: string;
  /**
   * Auth0 subjects of the users the to-do is assigned to. Optional.
   * Note the wire name is `assigneeIds` on create; the read response
   * projects them as a `assignees: Reference[]` array.
   */
  assigneeIds?: string[];
};

/**
 * Post a to-do to a brief (`POST /api/brief/v1/tasks`). Returns the
 * persisted task on success. The Brief API's task shape is minimal —
 * no description, no due date — so the title carries the full
 * intent. See `CreateBriefTaskInput` for the verified field set.
 */
export const createBriefTask = (
  options: BriefApiClientOptions,
  input: CreateBriefTaskInput
): Promise<BriefTask> =>
  briefRequest<BriefTask>(options, "/api/brief/v1/tasks", {
    method: "POST",
    body: {
      briefId: input.briefId,
      title: input.title,
      ...(input.assigneeIds && input.assigneeIds.length > 0
        ? { assigneeIds: input.assigneeIds }
        : {}),
    },
  });

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

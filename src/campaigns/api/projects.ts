import { campaignRequest } from "./request";
import type { PagedResult, Project, ProjectMember } from "./schema";
import type { CampaignApiClientOptions, CampaignQueryRecord } from "./types";

/**
 * Projects resource — CRUD on campaigns.
 *
 * Endpoint surface (HAR-derived 2026-05-15):
 *   GET  /api/orchestrate/v1/projects        — list (paged)
 *   GET  /api/orchestrate/v1/projects/{id}   — read one (deliverables + tasks inline)
 *   POST /api/orchestrate/v1/projects        — create (201)
 *
 * Update/delete were not exercised in the capture — `PUT`/`DELETE` on
 * `/projects/{id}` are likely (the task resource has both) but unverified.
 */

export type ListProjectsQuery = {
  /** Page size. */
  limit?: number;
  /** Cursor from the previous response's `next`. */
  next?: string;
};

/** List campaigns in the tenant (paged). */
export const listProjects = (
  options: CampaignApiClientOptions,
  query?: ListProjectsQuery
): Promise<PagedResult<Project>> => {
  const params: CampaignQueryRecord = {};
  if (query?.limit !== undefined) params.pageSize = query.limit;
  if (query?.next) params.next = query.next;
  return campaignRequest<PagedResult<Project>>(options, "/api/orchestrate/v1/projects", {
    query: params,
  });
};

/** Read a single campaign by id — deliverables and tasks are inlined. */
export const getProject = (
  options: CampaignApiClientOptions,
  projectId: string
): Promise<Project> =>
  campaignRequest<Project>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}`
  );

/**
 * Input for `createProject`. Field set observed on the wire — the API
 * may accept more. `members` carries Auth0 subjects.
 */
export type CreateProjectInput = {
  name: string;
  description?: string;
  start_date?: string;
  due_date?: string;
  status?: string;
  brandkit_id?: string;
  labels?: string[];
  members?: ProjectMember[];
};

/** Create a campaign. Returns the persisted record (201). */
export const createProject = (
  options: CampaignApiClientOptions,
  input: CreateProjectInput
): Promise<Project> =>
  campaignRequest<Project>(options, "/api/orchestrate/v1/projects", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description ?? "",
      start_date: input.start_date,
      due_date: input.due_date,
      status: input.status ?? "NOT_STARTED",
      brandkit_id: input.brandkit_id,
      labels: input.labels ?? [],
      members: input.members ?? [],
    },
  });

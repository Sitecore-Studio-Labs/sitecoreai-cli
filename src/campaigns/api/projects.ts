import { campaignRequest } from "./request";
import type { PagedResult, Project, ProjectMember } from "./schema";
import type { CampaignApiClientOptions, CampaignQueryRecord } from "./types";

/**
 * Projects resource — CRUD on campaigns.
 *
 * Endpoint surface (HAR-derived 2026-05-15):
 *   GET    /api/orchestrate/v1/projects        — list (paged)
 *   GET    /api/orchestrate/v1/projects/{id}   — read one (deliverables + tasks inline)
 *   POST   /api/orchestrate/v1/projects        — create (201)
 *   DELETE /api/orchestrate/v1/projects/{id}   — delete (UNVERIFIED)
 *
 * Update was not exercised in the capture — `PUT` on `/projects/{id}` is
 * likely (the task resource has it) but unverified. `deleteProject` is
 * wired optimistically per REST conventions; see its doc comment.
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

/**
 * Delete a campaign (`DELETE /api/orchestrate/v1/projects/{id}`).
 * Returns void — a 204 is expected on success.
 *
 * UNVERIFIED — DELETE was never captured; inferred from REST conventions.
 * Smoke-test before relying on it.
 */
export const deleteProject = (
  options: CampaignApiClientOptions,
  projectId: string
): Promise<void> =>
  campaignRequest<void>(options, `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });

/**
 * Input for `addProjectMember`. Verified against TestDemo 2026-06-03:
 * the POST body takes `{id, role?}` where `id` is the Auth0 subject
 * and `role` is one of `ADMIN`, `EDITOR`, `VIEWER`, `MEMBER` (omittable).
 */
export type AddProjectMemberInput = {
  /** Auth0 subject (e.g. `auth0|<sub>`). */
  id: string;
  /** Project role. Omittable; server applies its default. */
  role?: "ADMIN" | "EDITOR" | "VIEWER" | "MEMBER";
};

/**
 * Attach a tenant user to the project as a member with the given role.
 * Idempotent server-side — re-POSTing with the same `id` updates the
 * role instead of creating a duplicate row. Returns the updated
 * project envelope.
 */
export const addProjectMember = (
  options: CampaignApiClientOptions,
  projectId: string,
  input: AddProjectMemberInput
): Promise<Project> =>
  campaignRequest<Project>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: "POST",
      body: {
        id: input.id,
        ...(input.role ? { role: input.role } : {}),
      },
    }
  );

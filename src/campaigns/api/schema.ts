/**
 * Campaign (Orchestrate) API response schema — hand-written from
 * observed payloads.
 *
 * Source: a HAR capture of the Sitecore Content Operations UI driving
 * the Orchestrate API, 2026-05-15. No published OpenAPI spec. The
 * Orchestrate API uses **snake_case** field names; these types reflect
 * the wire verbatim.
 *
 * Resource hierarchy: a campaign is a `Project`; a project owns
 * `Deliverable`s; a deliverable owns `Task`s.
 *
 * Conventions:
 *  - List endpoints return `{ data, next, totalCount }` — same paged
 *    envelope as the Brief API.
 *  - User references are Auth0 subjects (`auth0|...`).
 *  - Timestamps are ISO-8601.
 *  - `status` / `funnel_stage` are server enums; only a subset of
 *    values was observed, so they are typed as `string`.
 */

/** Paged list envelope returned by every Orchestrate list endpoint. */
export type PagedResult<T> = {
  data: T[];
  /** Cursor for the next page, or null at end of stream. */
  next: string | null;
  totalCount: number;
};

/** A project (campaign) member — references an Auth0 user subject. */
export type ProjectMember = {
  id: string;
};

/** File attached to a project. */
export type ProjectAttachment = {
  id: string;
  file_id: string;
  metadata: {
    mimeType?: string;
    fileName?: string;
    contentLength?: string;
    [key: string]: unknown;
  };
  created_by: string;
};

/**
 * Task — the leaf work item, owned by a deliverable.
 *
 * `description` is HTML. `assignee` is an Auth0 subject or null.
 */
export type Task = {
  legacy_id: string | null;
  id: string;
  project_id: string;
  project_deliverable_id: string;
  org_id: string;
  tenant_id: string;
  name: string;
  start_date: string | null;
  due_date: string | null;
  status: string;
  priority: string | null;
  description: string | null;
  assignee: string | null;
  dependencies: unknown[];
  attachments: unknown[];
  action_link: string | null;
  action_name: string | null;
  labels: string[];
  deleted: boolean;
  archived: boolean;
  created_by: string;
  created_at: string;
  modified_by: string;
  modified_at: string;
};

/** Deliverable — a funnel-stage grouping of tasks under a project. */
export type Deliverable = {
  legacy_id: string | null;
  id: string;
  project_id: string;
  org_id: string;
  tenant_id: string;
  name: string;
  due_date: string | null;
  /** Funnel stage enum — observed: `TOP`. Full set TBD. */
  funnel_stage: string;
  funnel_tactics: string[];
  labels: string[];
  tasks: Task[];
  context: unknown[];
  status?: string;
  deleted: boolean;
  archived: boolean;
  created_by: string;
  created_at: string;
  modified_by: string;
  modified_at: string;
};

/**
 * Project — the unit the UI calls a "campaign".
 *
 * `status` is a server enum (observed: `NOT_STARTED`). `brandkit_id`
 * cross-references a brand kit; `briefs` cross-references the Brief
 * API — both are links, not embedded objects.
 */
export type Project = {
  legacy_id: string | null;
  id: string;
  /** Echoes `id`. */
  project_id: string;
  org_id: string;
  tenant_id: string;
  name: string;
  description: string;
  start_date: string | null;
  due_date: string | null;
  status: string;
  brandkit_id: string | null;
  thumbnail_url: string | null;
  labels: string[];
  members: ProjectMember[];
  member_requests: unknown[];
  attachments: ProjectAttachment[];
  deliverables: Deliverable[];
  context: unknown[];
  briefs: unknown[];
  project_progress: number;
  custom_fields: unknown | null;
  deleted: boolean;
  archived: boolean;
  created_by: string;
  created_at: string;
  modified_by: string;
  modified_at: string;
};

/** A user in the Orchestrate member directory. */
export type CampaignUser = {
  id: string;
  given_name: string;
  family_name: string;
  picture: string | null;
  email: string;
  /** Observed: `ADMIN`. Full set TBD. */
  user_type?: string;
};

/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/campaigns`.
 *
 * Sitecore **Orchestrate API** client. A "campaign" in the product UI
 * is an Orchestrate `project`; a project owns deliverables, a
 * deliverable owns tasks. Hosts are regional —
 * `ai-workflows-<region>.sitecorecloud.io` — so callers normally pass
 * `baseUrl` from per-env config.
 *
 * **Status**: built from a HAR capture of the Content Operations UI on
 * 2026-05-15. Request/response shapes are observed-accurate. Two items
 * are unverified and tracked in `docs/campaigns-followups.md`:
 *   - the OAuth scope (the HAR stripped Authorization headers)
 *   - project update/delete (only GET/POST were exercised; tasks have PUT)
 */

export type {
  CampaignApiClientOptions,
  CampaignRequestInit,
  CampaignQueryValue,
  CampaignQueryRecord,
} from "./api/types";
export { CAMPAIGN_API_HOST_TEMPLATE, DEFAULT_CAMPAIGN_API_BASE } from "./api/types";
export { campaignRequest } from "./api/request";

export type {
  PagedResult,
  Project,
  ProjectMember,
  ProjectAttachment,
  Deliverable,
  Task,
  CampaignUser,
} from "./api/schema";

export {
  listProjects,
  getProject,
  createProject,
  type ListProjectsQuery,
  type CreateProjectInput,
} from "./api/projects";

export { createDeliverable, type CreateDeliverableInput } from "./api/deliverables";

export {
  listTasks,
  getTask,
  createTask,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./api/tasks";

export { listUsers } from "./api/users";

export { acquireCampaignToken, type AcquireCampaignTokenOptions } from "./auth";

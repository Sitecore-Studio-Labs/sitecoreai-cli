/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/unstable/campaigns`.
 *
 * Sitecore **Orchestrate API** client. A "campaign" in the product UI
 * is an Orchestrate `project`; a project owns deliverables, a
 * deliverable owns tasks. Hosts are regional —
 * `ai-workflows-<region>.sitecorecloud.io` — so callers normally pass
 * `baseUrl` from per-env config.
 *
 * **Status**: built from a HAR capture of the Content Operations UI on
 * 2026-05-15. Request/response shapes are observed-accurate. Unverified
 * items, tracked in `docs/campaigns-followups.md`:
 *   - the OAuth scope (the HAR stripped Authorization headers)
 *   - project/deliverable/task update (only GET/POST were exercised; tasks have PUT)
 *   - `deleteProject` / `deleteDeliverable` / `deleteTask` — DELETE was
 *     never captured; wired optimistically per REST conventions.
 *     Smoke-test with `scripts/_smoke-campaign-delete.ts` before relying
 *     on them.
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
  deleteProject,
  type ListProjectsQuery,
  type CreateProjectInput,
} from "./api/projects";

export {
  createDeliverable,
  deleteDeliverable,
  type CreateDeliverableInput,
} from "./api/deliverables";

export {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./api/tasks";

export { listUsers } from "./api/users";

export { acquireCampaignToken, type AcquireCampaignTokenOptions } from "./auth";

export {
  resolveCampaignClient,
  type ResolveCampaignClientOptions,
  type ResolvedCampaignClient,
} from "./client";

// Recipe kind — wired into scai's `sync` engine for declarative
// campaign sync. Three-way merge supported via `ctx.baselineStorage`.
export { campaignKind } from "./recipe";
export type { CampaignRecipe } from "./recipe";

/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/unstable/brief`.
 *
 * Sitecore Content Operations Brief API client. Hosts follow
 * `co-brief-api-<region>.sitecorecloud.io`; the default is EU-West but
 * callers normally pass `baseUrl` from per-env config.
 *
 * **Status**: UNSTABLE — ships under `./unstable/brief` and carries no
 * SemVer stability promise; schemas and behavior may change in any
 * release. Reverse-engineered against the Agents env. Read helpers
 * (`listBriefs`, `getBrief`, `listBriefTypes`, `getBriefType`,
 * `listBriefTasks`, `listBriefComments`) verified 2026-05-14. BriefType
 * writes (`createBriefType`, `updateBriefType`, `deleteBriefType`) verified
 * end-to-end 2026-05-15 by `scripts/_smoke-brief-types-write.ts`. Brief
 * writes (`createBrief`, `updateBrief`, `deleteBrief`) are wired but
 * not yet smoke-tested. `createBriefComment` is wired UNVERIFIED — the
 * comment write body shape is a best guess (see `./api/comments.ts`).
 *
 * Required Auth0 scope: `co.briefs:r` (read) / `co.briefs:r co.briefs:w`
 * (read+write). The Agents env client carries both by default.
 */

export type {
  BriefApiClientOptions,
  BriefRequestInit,
  BriefQueryValue,
  BriefQueryRecord,
} from "./api/types";
export { BRIEF_API_HOST_TEMPLATE, DEFAULT_BRIEF_API_BASE } from "./api/types";
export { briefRequest } from "./api/request";

export type {
  PagedResult,
  LocalizedString,
  Link,
  ExternalLink,
  Reference,
  BriefField,
  BriefFieldBase,
  RichTextField,
  DateTimeField,
  TimelineField,
  BudgetField,
  BriefType,
  Brief,
  BriefStatus,
  BriefTask,
  BriefComment,
  ExternalMapping,
} from "./api/schema";

export {
  listBriefs,
  getBrief,
  createBrief,
  updateBrief,
  deleteBrief,
  assertCreateBriefInput,
  type BriefExternalReference,
  type CreateBriefInput,
  type ListBriefsQuery,
} from "./api/briefs";

export {
  listBriefTypes,
  getBriefType,
  createBriefType,
  updateBriefType,
  deleteBriefType,
  type CreateBriefTypeInput,
} from "./api/brief-types";

export {
  listBriefTasks,
  getBriefTask,
  createBriefTask,
  deleteBriefTask,
  type BriefTaskMetadata,
  type CreateBriefTaskInput,
  type ListBriefTasksQuery,
} from "./api/tasks";

export {
  listBriefComments,
  createBriefComment,
  type ListBriefCommentsQuery,
  type CreateBriefCommentInput,
} from "./api/comments";

export { acquireBriefToken, BRIEF_SCOPES_REQUESTED, type AcquireBriefTokenOptions } from "./auth";

export {
  resolveBriefClient,
  type ResolveBriefClientOptions,
  type ResolvedBriefClient,
} from "./client";

// Recipe kinds — wired into scai's `sync` engine for declarative
// brief-type + brief-instance sync. Three-way merge with baseline is
// supported through `ctx.baselineStorage` (see the `./sync` package
// surface). Re-exported here so orchestrator-side callers don't need
// the deeper `./recipe/instance-kind` path which package.json doesn't
// expose.
export { briefTypeKind, briefInstanceKind } from "./recipe";
export type { BriefTypeRecipe, BriefInstanceRecipe } from "./recipe";

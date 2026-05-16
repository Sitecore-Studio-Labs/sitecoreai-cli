/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/brief`.
 *
 * Sitecore Content Operations Brief API client. Hosts follow
 * `co-brief-api-<region>.sitecorecloud.io`; the default is EU-West but
 * callers normally pass `baseUrl` from per-env config.
 *
 * **Status**: reverse-engineered against the Agents env. Read helpers
 * (`listBriefs`, `getBrief`, `listBriefTypes`, `getBriefType`,
 * `listBriefTasks`, `listBriefComments`) verified 2026-05-14. BriefType
 * writes (`createBriefType`, `updateBriefType`, `deleteBriefType`) verified
 * end-to-end 2026-05-15 by `scripts/_smoke-brief-types-write.ts`. Brief
 * writes (`createBrief`, `updateBrief`, `deleteBrief`) are wired but
 * not yet smoke-tested.
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
  setBriefStatus,
  deleteBrief,
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
  type BriefTaskMetadata,
  type ListBriefTasksQuery,
} from "./api/tasks";

export { listBriefComments, type ListBriefCommentsQuery } from "./api/comments";

export { acquireBriefToken, BRIEF_SCOPES_REQUESTED, type AcquireBriefTokenOptions } from "./auth";

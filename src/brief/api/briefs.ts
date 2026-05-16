import { briefRequest } from "./request";
import type { Brief, BriefStatus, PagedResult } from "./schema";
import type { BriefApiClientOptions, BriefQueryRecord } from "./types";

/**
 * Brief resource — CRUD on brief instances.
 *
 * Endpoint surface (reverse-engineered):
 *   GET    /api/brief/v1/briefs            — list (paged)
 *   GET    /api/brief/v1/briefs/{id}       — read one
 *   POST   /api/brief/v1/briefs            — create  (verified 2026-05-15)
 *   PUT    /api/brief/v1/briefs/{id}       — update  (untested)
 *   DELETE /api/brief/v1/briefs/{id}       — delete  (verified 2026-05-15)
 *
 * `createBrief` + `deleteBrief` are verified against the Agents
 * tenant. `updateBrief` is wired the same way the Sites surface wires
 * its writes but has not been smoke-tested end-to-end.
 */

export type ListBriefsQuery = {
  /** Page size. */
  limit?: number;
  /** Cursor from the previous response's `next` field. */
  next?: string;
  /** Optional locale filter — e.g. `en-us`. */
  locale?: string;
};

/** List all briefs in the tenant (paged). */
export const listBriefs = (
  options: BriefApiClientOptions,
  query?: ListBriefsQuery
): Promise<PagedResult<Brief>> => {
  const params: BriefQueryRecord = {};
  if (query?.limit !== undefined) params.Limit = query.limit;
  if (query?.next) params.Next = query.next;
  if (query?.locale) params.Locale = query.locale;
  return briefRequest<PagedResult<Brief>>(options, "/api/brief/v1/briefs", {
    query: params,
  });
};

/** Read a single brief by id. 404 surfaces as `BRIEF_API_FAILED` with `"Brief not found"`. */
export const getBrief = (options: BriefApiClientOptions, briefId: string): Promise<Brief> =>
  briefRequest<Brief>(options, `/api/brief/v1/briefs/${encodeURIComponent(briefId)}`);

/**
 * Input for `createBrief`.
 *
 * Verified against the Agents tenant 2026-05-15: the POST body takes a
 * flat `briefTypeId` (NOT a nested `briefType: { id }` — that 400s with
 * `BriefTypeId: Brief type is required`). `name` + `briefTypeId` are
 * required; `locale`, `fields`, `isTemplate` are optional. `fields`
 * accepts the same per-field `{ type, value }` shape the read endpoint
 * returns, where RichText `value` is a ProseMirror doc node.
 */
export type CreateBriefInput = {
  name: string;
  briefTypeId: string;
  locale?: string;
  fields?: Record<string, unknown>;
  isTemplate?: boolean;
};

/** Create a brief. Returns the persisted record (201). */
export const createBrief = (
  options: BriefApiClientOptions,
  input: CreateBriefInput
): Promise<Brief> =>
  briefRequest<Brief>(options, "/api/brief/v1/briefs", {
    method: "POST",
    body: {
      name: input.name,
      briefTypeId: input.briefTypeId,
      locale: input.locale,
      fields: input.fields,
      isTemplate: input.isTemplate,
    },
  });

/**
 * Partial update of a brief (`PUT /api/brief/v1/briefs/{id}` — 204 No
 * Content). A status-only body is accepted; other partial fields are
 * wired but only the `status` path is verified (2026-05-15).
 */
export const updateBrief = (
  options: BriefApiClientOptions,
  briefId: string,
  patch: Partial<CreateBriefInput> & { status?: BriefStatus }
): Promise<void> =>
  briefRequest<void>(options, `/api/brief/v1/briefs/${encodeURIComponent(briefId)}`, {
    method: "PUT",
    body: patch,
  });

/**
 * Move a brief to a new workflow status.
 *
 * Verified 2026-05-15 against the Agents tenant: a plain `{ status }`
 * PUT transitions the brief directly (e.g. `Draft → Approved`), 204 on
 * success. Briefs must be out of `Draft` before they can be linked to
 * a campaign.
 */
export const setBriefStatus = (
  options: BriefApiClientOptions,
  briefId: string,
  status: BriefStatus
): Promise<void> => updateBrief(options, briefId, { status });

/** Delete a brief. Returns void (204). Verified against the Agents tenant 2026-05-15. */
export const deleteBrief = (options: BriefApiClientOptions, briefId: string): Promise<void> =>
  briefRequest<void>(options, `/api/brief/v1/briefs/${encodeURIComponent(briefId)}`, {
    method: "DELETE",
  });

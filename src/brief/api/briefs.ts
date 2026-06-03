import { createScaiError } from "@/shared/errors";
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

/** Required keys on a `CreateBriefInput` body. */
const BRIEF_REQUIRED_KEYS = ["name", "briefTypeId"] as const;

/**
 * Validate an unknown value as a `CreateBriefInput`. Throws a typed
 * `ScaiError` (`INPUT_INVALID`) on failure; returns the narrowed input
 * on success. `createBrief` calls this itself, so direct SDK consumers
 * are guarded without invoking it explicitly. Mirrors
 * `assertCreateBriefTypeInput` in `./brief-types.ts`.
 */
export const assertCreateBriefInput = (value: unknown): CreateBriefInput => {
  if (!value || typeof value !== "object") {
    throw createScaiError("Brief body must be a JSON object.", "INPUT_INVALID");
  }
  const obj = value as Record<string, unknown>;
  const missing = BRIEF_REQUIRED_KEYS.filter((key) => obj[key] === undefined);
  if (missing.length > 0) {
    throw createScaiError(
      `Brief body is missing required fields: ${missing.join(", ")}.`,
      "INPUT_INVALID",
      { hint: "Required: name (string), briefTypeId (UUID of the brief type)." }
    );
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw createScaiError(`Invalid 'name': ${JSON.stringify(obj.name)}.`, "INPUT_INVALID", {
      hint: "Brief name must be a non-empty string.",
    });
  }
  if (typeof obj.briefTypeId !== "string" || obj.briefTypeId.length === 0) {
    throw createScaiError(
      `Invalid 'briefTypeId': ${JSON.stringify(obj.briefTypeId)}.`,
      "INPUT_INVALID",
      {
        hint: "Pass the brief type's UUID. List types with `scai ops brief types list`.",
      }
    );
  }
  if (obj.fields !== undefined && (typeof obj.fields !== "object" || Array.isArray(obj.fields))) {
    throw createScaiError("'fields' must be an object keyed by field name.", "INPUT_INVALID");
  }
  return obj as unknown as CreateBriefInput;
};

/** Create a brief. Returns the persisted record (201). */
export const createBrief = (
  options: BriefApiClientOptions,
  input: CreateBriefInput
): Promise<Brief> => {
  assertCreateBriefInput(input);
  return briefRequest<Brief>(options, "/api/brief/v1/briefs", {
    method: "POST",
    body: {
      name: input.name,
      briefTypeId: input.briefTypeId,
      locale: input.locale,
      fields: input.fields,
      isTemplate: input.isTemplate,
    },
  });
};

/**
 * One external-link reference attached to a brief — most commonly a
 * link to its parent Orchestrate project (campaign). Verified
 * writable 2026-06-03 via PUT on the brief with `references: [...]`.
 */
export type BriefExternalReference = {
  type: "ExternalLink";
  relatedSystem: string;
  relatedType?: string | null;
  id: string;
};

/**
 * Partial update of a brief (`PUT /api/brief/v1/briefs/{id}` — 204 No
 * Content). A status-only body is accepted; the `status` path is
 * verified (2026-05-15); the `references` path is verified
 * (2026-06-03); other partial fields are wired but unverified.
 */
export const updateBrief = (
  options: BriefApiClientOptions,
  briefId: string,
  patch: Partial<CreateBriefInput> & {
    status?: BriefStatus;
    references?: BriefExternalReference[];
  }
): Promise<void> =>
  briefRequest<void>(options, `/api/brief/v1/briefs/${encodeURIComponent(briefId)}`, {
    method: "PUT",
    body: patch,
  });

/** Delete a brief. Returns void (204). Verified against the Agents tenant 2026-05-15. */
export const deleteBrief = (options: BriefApiClientOptions, briefId: string): Promise<void> =>
  briefRequest<void>(options, `/api/brief/v1/briefs/${encodeURIComponent(briefId)}`, {
    method: "DELETE",
  });

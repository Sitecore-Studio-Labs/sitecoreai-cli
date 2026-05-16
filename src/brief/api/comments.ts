import { briefRequest } from "./request";
import type { BriefComment, PagedResult } from "./schema";
import type { BriefApiClientOptions, BriefQueryRecord } from "./types";

/**
 * Comments resource on the Brief API.
 *
 * Endpoint surface (reverse-engineered):
 *   GET  /api/brief/v1/comments              — list (tenant-wide)
 *   GET  /api/brief/v1/comments?BriefId=...  — list (filtered to one brief)
 *   POST /api/brief/v1/comments              — create  (UNVERIFIED)
 *
 * The comment shape is provisional — the probe tenant had zero
 * comments. Tighten `BriefComment` in `./schema.ts` after capture.
 */

export type ListBriefCommentsQuery = {
  briefId?: string;
  limit?: number;
  next?: string;
};

/** List comments (optionally filtered by brief). */
export const listBriefComments = (
  options: BriefApiClientOptions,
  query?: ListBriefCommentsQuery
): Promise<PagedResult<BriefComment>> => {
  const params: BriefQueryRecord = {};
  if (query?.briefId) params.BriefId = query.briefId;
  if (query?.limit !== undefined) params.Limit = query.limit;
  if (query?.next) params.Next = query.next;
  return briefRequest<PagedResult<BriefComment>>(options, "/api/brief/v1/comments", {
    query: params,
  });
};

/**
 * Input for `createBriefComment`.
 *
 * **UNVERIFIED** — no comment write was captured during reverse-engineering.
 * The body below (`{ briefId, text }`) is a best guess. The Brief API's
 * write scope (`co.briefs:w`) is documented as covering "post comments",
 * so the endpoint exists — but the exact field names are unconfirmed.
 * Verify by running `scai ops brief comments add <id> --text "…" --apply`
 * against a tenant, then tighten this shape.
 */
export type CreateBriefCommentInput = {
  /** Brief the comment is attached to. */
  briefId: string;
  /** Comment text. */
  text: string;
};

/**
 * Post a comment to a brief (`POST /api/brief/v1/comments`).
 *
 * **UNVERIFIED** — see `CreateBriefCommentInput`. Returns the persisted
 * comment on success.
 */
export const createBriefComment = (
  options: BriefApiClientOptions,
  input: CreateBriefCommentInput
): Promise<BriefComment> =>
  briefRequest<BriefComment>(options, "/api/brief/v1/comments", {
    method: "POST",
    body: { briefId: input.briefId, text: input.text },
  });

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
 * Verified against TestDemo 2026-06-03: the POST body takes `briefId`,
 * `text`, and `authorId`. `authorId` is REQUIRED — a missing author
 * 400s with `AuthorId: Author is required`. `text` accepts a plain
 * string OR a ProseMirror doc node; the server stores either as a
 * RichText envelope (`{type: "RichText", value: …}`).
 *
 * Server records `author` as the impersonated user (whomever you pass
 * in `authorId`) while `createdBy` independently captures the actual
 * caller's Auth0 subject. This separation is intentional — callers
 * may post as a different visible author while the audit trail stays
 * honest about who wrote.
 */
export type CreateBriefCommentInput = {
  /** Brief the comment is attached to. */
  briefId: string;
  /**
   * Comment body. Plain strings persist as a RichText envelope
   * wrapping the string; ProseMirror doc nodes persist with all
   * marks (bold, italic, links, etc.) intact.
   */
  text: string | Record<string, unknown>;
  /**
   * Auth0 subject of the user the comment should appear authored by.
   * Use `scai ops campaign users list` to enumerate the tenant's
   * member directory and pick a valid sub (e.g. `auth0|<id>`).
   * Required — POSTing without it 400s.
   */
  authorId: string;
};

/**
 * Post a comment to a brief (`POST /api/brief/v1/comments`). Returns
 * the persisted comment on success. See `CreateBriefCommentInput`
 * for the body shape and author-impersonation semantics.
 */
export const createBriefComment = (
  options: BriefApiClientOptions,
  input: CreateBriefCommentInput
): Promise<BriefComment> =>
  briefRequest<BriefComment>(options, "/api/brief/v1/comments", {
    method: "POST",
    body: {
      briefId: input.briefId,
      text: input.text,
      authorId: input.authorId,
    },
  });

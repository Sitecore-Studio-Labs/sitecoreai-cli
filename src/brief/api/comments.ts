import { briefRequest } from "./request";
import type { BriefComment, PagedResult } from "./schema";
import type { BriefApiClientOptions, BriefQueryRecord } from "./types";

/**
 * Comments resource on the Brief API.
 *
 * Endpoint surface (reverse-engineered):
 *   GET /api/brief/v1/comments              — list (tenant-wide)
 *   GET /api/brief/v1/comments?BriefId=...  — list (filtered to one brief)
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

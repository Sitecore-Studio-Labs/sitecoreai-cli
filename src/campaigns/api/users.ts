import { campaignRequest } from "./request";
import type { CampaignUser, PagedResult } from "./schema";
import type { CampaignApiClientOptions } from "./types";

/**
 * Users resource — the Orchestrate member directory.
 *
 * Endpoint surface (HAR-derived 2026-05-15):
 *   GET /api/orchestrate/v1/users — list (paged)
 *
 * Use this to resolve the Auth0 subjects referenced by a project's
 * `members` and a task's `assignee` into display names + emails.
 */

/** List users available as campaign members / task assignees. */
export const listUsers = (
  options: CampaignApiClientOptions
): Promise<PagedResult<CampaignUser>> =>
  campaignRequest<PagedResult<CampaignUser>>(options, "/api/orchestrate/v1/users");

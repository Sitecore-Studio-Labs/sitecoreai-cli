import type { PublishJob, PublishJobState } from "./types";

/**
 * Translate the Authoring GraphQL `publishingStatus` / `publish`
 * response shapes into our `PublishJob` union. The GraphQL surface
 * returns `{ id, processedCount, stateCode, stateName }` per the
 * mutation/query in [src/serialization/sitecore-api/publish.ts]; we
 * normalize `stateName` (a freeform string) to the union so callers
 * never have to match against tenant-variant casing.
 */

const KNOWN: Record<string, PublishJobState> = {
  queued: "queued",
  pending: "queued",
  running: "running",
  inprogress: "running",
  in_progress: "running",
  completed: "completed",
  done: "completed",
  finished: "completed",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const normalizeState = (raw: unknown): PublishJobState => {
  const value = String(raw ?? "").toLowerCase().replace(/[\s-]+/g, "");
  return KNOWN[value] ?? "queued";
};

export interface GraphQLPublishStatus {
  id: string;
  processedCount?: number;
  stateCode?: number;
  stateName?: string;
}

export const normalizePublishJob = (raw: GraphQLPublishStatus): PublishJob => ({
  id: raw.id,
  state: normalizeState(raw.stateName),
  stateCode: typeof raw.stateCode === "number" ? raw.stateCode : undefined,
  processedCount: typeof raw.processedCount === "number" ? raw.processedCount : undefined,
});

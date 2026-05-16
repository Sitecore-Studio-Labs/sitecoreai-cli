/**
 * Ancillary read endpoints — run history and supporting data that aren't
 * a first-class authored resource of their own.
 *
 * Per-resource catalogs (tools, skills, schemas, widgets, custom-mcps)
 * live in their own modules; this file holds the cross-cutting reads.
 */
import { agentsRequest } from "./request";
import type { AgentsSession } from "../session/types";
import type { ScheduledRun } from "./schema";

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Scheduled runs. Accepts a bare array or a `{ schedules }` envelope. */
export const listScheduledRuns = async (session: AgentsSession): Promise<ScheduledRun[]> => {
  const data = await agentsRequest<unknown>(session, "/api/scheduled-runs");
  if (Array.isArray(data)) return data as ScheduledRun[];
  const envelope = data as { schedules?: unknown } | null;
  return asArray<ScheduledRun>(envelope?.schedules);
};

/** Jobs. Accepts a bare array or a `{ jobs }` envelope. Shape untyped. */
export const listJobs = async (session: AgentsSession): Promise<unknown[]> => {
  const data = await agentsRequest<unknown>(session, "/api/jobs");
  if (Array.isArray(data)) return data;
  const envelope = data as { jobs?: unknown } | null;
  return asArray<unknown>(envelope?.jobs);
};

/** Brand kits visible to the session. Shape unconfirmed — returned untyped. */
export const listBrandKits = async (session: AgentsSession): Promise<unknown[]> =>
  asArray<unknown>(await agentsRequest<unknown>(session, "/api/brand-kits"));

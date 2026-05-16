import { campaignRequest } from "./request";
import type { Deliverable } from "./schema";
import type { CampaignApiClientOptions } from "./types";

/**
 * Deliverables resource — funnel-stage groupings of tasks under a
 * campaign.
 *
 * Endpoint surface (HAR-derived 2026-05-15):
 *   POST   /api/orchestrate/v1/projects/{projectId}/deliverables      — create (201)
 *   DELETE /api/orchestrate/v1/projects/{projectId}/deliverables/{id} — delete (UNVERIFIED)
 *
 * Deliverables are also returned inline on `getProject`, so a
 * dedicated list endpoint was not needed in the capture. `deleteDeliverable`
 * is wired optimistically per REST conventions; see its doc comment.
 * Update is unverified.
 */

/** Input for `createDeliverable`. Field set observed on the wire. */
export type CreateDeliverableInput = {
  name: string;
  due_date?: string;
  status?: string;
  /** Funnel stage — observed: `TOP`. */
  funnel_stage?: string;
  funnel_tactics?: string[];
  labels?: string[];
};

/** Create a deliverable under a campaign. Returns the persisted record. */
export const createDeliverable = (
  options: CampaignApiClientOptions,
  projectId: string,
  input: CreateDeliverableInput
): Promise<Deliverable> =>
  campaignRequest<Deliverable>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}/deliverables`,
    {
      method: "POST",
      body: {
        name: input.name,
        project_id: projectId,
        due_date: input.due_date,
        status: input.status ?? "NOT_STARTED",
        funnel_stage: input.funnel_stage,
        funnel_tactics: input.funnel_tactics ?? [],
        labels: input.labels ?? [],
      },
    }
  );

/**
 * Delete a deliverable
 * (`DELETE /api/orchestrate/v1/projects/{projectId}/deliverables/{deliverableId}`).
 * Returns void — a 204 is expected on success.
 *
 * UNVERIFIED — DELETE was never captured; inferred from REST conventions
 * (the item path under the `createDeliverable` collection). Smoke-test
 * before relying on it.
 */
export const deleteDeliverable = (
  options: CampaignApiClientOptions,
  projectId: string,
  deliverableId: string
): Promise<void> =>
  campaignRequest<void>(
    options,
    `/api/orchestrate/v1/projects/${encodeURIComponent(projectId)}` +
      `/deliverables/${encodeURIComponent(deliverableId)}`,
    { method: "DELETE" }
  );

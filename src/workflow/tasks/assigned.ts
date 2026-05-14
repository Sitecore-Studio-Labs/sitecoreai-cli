import { createScaiError } from "@/shared/errors";
import type { AssignedItemSummary } from "../api";
import {
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowAssignedOptions extends WorkflowTaskOptions {
  /** Workflow state GUID — the item ID of the State item. Required. */
  state: string;
  /** Override the search index. Defaults to `sitecore_master_index`. */
  index?: string;
  /**
   * Override the search field. Defaults to `__workflow state`. Some
   * tenants index the field as `__workflow_state` instead — use this
   * to switch when the default returns no hits.
   */
  field?: string;
  /** Page size for the search backend. Defaults to 100. */
  pageSize?: number;
  /** Cap on items returned. Defaults to 500. */
  limit?: number;
}

export interface WorkflowAssignedResult {
  stateId: string;
  items: AssignedItemSummary[];
}

/**
 * Find items currently in the given workflow state — the CLI's "workbox"
 * equivalent. Backed by the Sitecore search index over the
 * `__workflow state` field.
 *
 * On tenants where the search field is indexed under a different name
 * (e.g. `__workflow_state`), supply `--field`. If results are still
 * empty, run with `--trace` and verify the field name against your
 * tenant's index schema.
 */
export const runWorkflowAssigned = async (
  options: WorkflowAssignedOptions
): Promise<WorkflowAssignedResult> => {
  const logger = toLogger(options);
  if (!options.state) {
    throw createScaiError("--state is required.", "INPUT_INVALID");
  }
  const { envName, client } = resolveWorkflowTenant(options);

  const items = await client.searchItemsByWorkflowState({
    stateId: options.state,
    ...(options.index !== undefined && { index: options.index }),
    ...(options.field !== undefined && { field: options.field }),
    ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
    ...(options.limit !== undefined && { maxItems: options.limit }),
  });

  const lines =
    items.length > 0
      ? items.map(
          (i) =>
            `${i.path} (${i.templateName ?? "?"})${i.updatedDate ? ` — updated ${i.updatedDate}` : ""}`
        )
      : [`No items found in state ${options.state}.`];

  printWorkflowResult({
    logger,
    command: "workflow.assigned",
    envName,
    result: { stateId: options.state, items },
    humanLines: lines,
  });

  return { stateId: options.state, items };
};

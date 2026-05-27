import { createScaiError } from "@/shared/errors";
import { getAccessToken } from "@/auth";
import { retrieveWorkflowStatistics, type WorkflowsStatistics } from "@/sites/api/sites";
import {
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowStatusOptions extends WorkflowTaskOptions {
  /** Site ID to fetch workflow rollup for. Required. */
  site: string;
  /**
   * Optional Content Services environment identifier (e.g. "main").
   * Defaults to the API's server-side default when unset.
   */
  contentEnvironmentId?: string;
}

export interface WorkflowStatusResult {
  siteId: string;
  statistics: WorkflowsStatistics;
}

/**
 * Fetch the per-site workflow rollup (workflows + states + page counts)
 * from the XM Apps REST API. Backed by
 * `/api/v1/sites/{siteId}/statistics/workflow`.
 */
export const runWorkflowStatus = async (
  options: WorkflowStatusOptions
): Promise<WorkflowStatusResult> => {
  const logger = toLogger(options);
  if (!options.site) {
    throw createScaiError("--site is required.", "INPUT_INVALID");
  }
  const { envName, environment } = resolveWorkflowTenant(options);
  const accessToken = await getAccessToken(environment);
  if (!accessToken) {
    throw createScaiError(
      `Failed to mint an XM Apps access token for environment '${envName}'. Run 'scai setup login' or set client credentials, then retry.`,
      "AUTH_REQUIRED"
    );
  }

  const statistics = await retrieveWorkflowStatistics(
    { accessToken },
    options.site,
    options.contentEnvironmentId ? { environmentId: options.contentEnvironmentId } : undefined
  );

  const lines: string[] = [];
  for (const w of statistics.workflows ?? []) {
    const states = (w.states ?? []).map((s) => `${s.name ?? "?"}: ${s.pageCount ?? 0}`).join(", ");
    lines.push(`${w.name ?? "?"} — ${states || "(no states)"}`);
  }
  if (lines.length === 0) {
    lines.push(`No workflow statistics for site ${options.site}.`);
  }

  printWorkflowResult({
    logger,
    command: "workflow.status",
    envName,
    result: { siteId: options.site, statistics },
    humanLines: lines,
  });

  return { siteId: options.site, statistics };
};

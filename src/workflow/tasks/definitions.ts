import type { WorkflowDefinitionSummary } from "../api/client";
import {
  printWorkflowResult,
  resolveWorkflowTenant,
  toLogger,
  type WorkflowTaskOptions,
} from "./shared";

export interface WorkflowDefinitionsOptions extends WorkflowTaskOptions {
  /**
   * Override the content-tree root. Defaults to
   * `/sitecore/system/Workflows`. Useful for tenants with workflows
   * outside the standard location.
   */
  root?: string;
}

export interface WorkflowDefinitionsResult {
  rootPath: string;
  workflows: WorkflowDefinitionSummary[];
}

/**
 * List workflow definitions on the tenant. Walks
 * `/sitecore/system/Workflows` (or a custom `--root`), follows
 * Workflow-Folder items one level deep, and returns every item whose
 * template is `Workflow`.
 */
export const runWorkflowDefinitions = async (
  options: WorkflowDefinitionsOptions
): Promise<WorkflowDefinitionsResult> => {
  const logger = toLogger(options);
  const { envName, client } = resolveWorkflowTenant(options);

  const rootPath = options.root ?? "/sitecore/system/Workflows";
  const workflows = await client.listWorkflowDefinitions({ rootPath });

  const lines =
    workflows.length > 0
      ? workflows.map((w) => `${w.displayName ?? w.name} (${w.itemId}) — ${w.path}`)
      : [`No workflow definitions under ${rootPath}.`];

  printWorkflowResult({
    logger,
    command: "workflow.definitions",
    envName,
    result: { rootPath, workflows },
    humanLines: lines,
  });

  return { rootPath, workflows };
};

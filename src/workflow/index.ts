/**
 * Public entry for `@sitecoreai-labs/sitecoreai-cli/workflow`.
 *
 * Sitecore item workflow surface — state inspection, command resolution,
 * advance/apply/reset lifecycle. Authoring GraphQL underneath.
 */

export {
  createWorkflowApiClient,
  type WorkflowApiClient,
  type WorkflowClientOptions,
  type ItemSelector,
  type ItemWorkflowState,
  type WorkflowCommandSummary,
  type WorkflowExecutionResult,
  type ExecuteWorkflowCommandInput,
  type WorkflowDefinitionSummary,
  type ListWorkflowDefinitionsOptions,
  type AssignedItemSummary,
  type SearchItemsByWorkflowStateOptions,
  type WorkflowDefinitionDetail,
  type WorkflowStateDetail,
  type WorkflowCommandDetail,
  type WorkflowChildSummary,
} from "./api/client";
export {
  resolveWorkflowCommandId,
  type ResolveWorkflowCommandOptions,
  type ResolveWorkflowCommandResult,
} from "./api/resolve-command";
export { runWorkflowAuthoringGraphQL, type WorkflowRequestOptions } from "./api/graphql";

export {
  runWorkflowInspect,
  type WorkflowInspectOptions,
  type WorkflowInspectResult,
} from "./tasks/inspect";
export {
  runWorkflowListCommands,
  type WorkflowListCommandsOptions,
  type WorkflowListCommandsResult,
} from "./tasks/list-commands";
export {
  runWorkflowListDefs,
  type WorkflowListDefsOptions,
  type WorkflowListDefsResult,
} from "./tasks/list-defs";
export {
  runWorkflowStatus,
  type WorkflowStatusOptions,
  type WorkflowStatusResult,
} from "./tasks/status";
export {
  runWorkflowAssigned,
  type WorkflowAssignedOptions,
  type WorkflowAssignedResult,
} from "./tasks/assigned";
export {
  runWorkflowAdvance,
  type WorkflowAdvanceOptions,
  type WorkflowAdvanceResult,
  type WorkflowAdvanceStatus,
} from "./tasks/advance";
export {
  runWorkflowReset,
  type WorkflowResetOptions,
  type WorkflowResetResult,
  type WorkflowResetStatus,
} from "./tasks/reset";
export {
  runWorkflowApply,
  type WorkflowApplyOptions,
  type WorkflowApplyResult,
  type WorkflowApplyStatus,
} from "./tasks/apply";
export {
  type WorkflowTaskOptions,
  type ResolvedWorkflowTenant,
  resolveWorkflowTenant,
  toLogger,
  parseItemReference,
  printWorkflowResult,
  dashifyItemId,
} from "./tasks/shared";

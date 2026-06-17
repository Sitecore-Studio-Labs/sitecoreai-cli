/**
 * Internal workflow module. The standalone `./workflow` published
 * subpath was removed in 0.4.2 to slim the SDK surface.
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
  runWorkflowGet,
  type WorkflowInspectOptions,
  type WorkflowInspectResult,
} from "./tasks/get";
export {
  runWorkflowCommands,
  type WorkflowCommandsOptions,
  type WorkflowCommandsResult,
} from "./tasks/commands";
export {
  runWorkflowDefinitions,
  type WorkflowDefinitionsOptions,
  type WorkflowDefinitionsResult,
} from "./tasks/definitions";
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
// `toLogger` and `printWorkflowResult` deliberately omitted — they're
// CLI presentation helpers. SDK consumers should bring their own
// presentation.
export {
  type WorkflowTaskOptions,
  type ResolvedWorkflowTenant,
  resolveWorkflowTenant,
  parseItemReference,
  dashifyItemId,
} from "./tasks/shared";

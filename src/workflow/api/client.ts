import type { EnvironmentConfiguration } from "@/config";
import { createScaiError } from "@/shared/errors";
import { READ_RETRYABLE_STATUSES } from "@/shared/graphql";
import { runWorkflowAuthoringGraphQL, type WorkflowRequestOptions } from "./graphql";

/**
 * Authoring GraphQL operations for Sitecore workflows.
 *
 * Schema verified against XM Cloud Authoring API by introspection
 * (2026-05-13). `ItemWorkflow`, `Workflow.commands(query: {item})`, and
 * `executeWorkflowCommand` are pinned here; if a tenant exposes a
 * divergent schema, the call surfaces as a `NETWORK` `ScaiError` with
 * the upstream message preserved.
 *
 * Note on `Workflow.commands`: the Authoring API requires a state-or-item
 * context (`WorkflowStateOrItemQueryInput`). The same workflow can expose
 * different commands depending on the item's current state, so per-item
 * resolution is required; caching across items is not valid.
 */

export interface ItemSelector {
  itemId?: string;
  path?: string;
}

export interface ItemWorkflowState {
  itemId: string;
  path: string | null;
  workflowId: string | null;
  workflowName: string | null;
  stateId: string | null;
  stateName: string | null;
  stateIsFinal: boolean;
}

export interface WorkflowCommandSummary {
  commandId: string;
  displayName: string;
}

export interface WorkflowExecutionResult {
  successful: boolean;
  nextStateId: string | null;
  message: string | null;
}

export interface ExecuteWorkflowCommandInput {
  commandId: string;
  itemId?: string;
  path?: string;
  comments?: string;
}

export interface WorkflowApiClient {
  /**
   * Fetch an item's current workflow + state. Accepts either an item
   * GUID (`{itemId}`) or a content-tree path (`{path}`). Returns null
   * when the item doesn't exist or is not under workflow.
   */
  getItemWorkflow(input: ItemSelector): Promise<ItemWorkflowState | null>;
  /**
   * Resolve the workflow commands available for a specific item.
   * Different items in the same workflow can expose different commands
   * depending on their current state.
   */
  getWorkflowCommandsForItem(input: {
    workflowId: string;
    itemId: string;
  }): Promise<WorkflowCommandSummary[]>;
  /** Execute a workflow command on an item, advancing its state. */
  executeWorkflowCommand(input: ExecuteWorkflowCommandInput): Promise<WorkflowExecutionResult>;
}

export interface WorkflowClientOptions {
  environment: EnvironmentConfiguration;
  request?: WorkflowRequestOptions;
}

const ITEM_WORKFLOW_FRAGMENT = `
  itemId
  path
  workflow {
    workflowState { stateId displayName final }
    workflow { workflowId displayName }
  }`;

const GET_ITEM_WORKFLOW_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {${ITEM_WORKFLOW_FRAGMENT}
  }
}`;

const GET_ITEM_WORKFLOW_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {${ITEM_WORKFLOW_FRAGMENT}
  }
}`;

const GET_WORKFLOW_COMMANDS_FOR_ITEM_QUERY = `
query($workflowId: String!, $itemId: ID!) {
  workflow(where: { workflowId: $workflowId }) {
    commands(query: { item: { itemId: $itemId } }) {
      nodes { commandId displayName }
    }
  }
}`;

const EXECUTE_WORKFLOW_COMMAND_MUTATION = `
mutation($input: ExecuteWorkflowCommandInput!) {
  executeWorkflowCommand(input: $input) {
    successful
    nextStateId
    message
    error
  }
}`;

type GraphQLWorkflowResponse = {
  item: {
    itemId: string;
    path: string;
    workflow: {
      workflowState: { stateId: string; displayName: string; final: boolean } | null;
      workflow: { workflowId: string; displayName: string } | null;
    } | null;
  } | null;
};

type GraphQLWorkflowCommandsResponse = {
  workflow: {
    commands: { nodes: Array<{ commandId: string; displayName: string }> } | null;
  } | null;
};

type GraphQLExecuteWorkflowCommandResponse = {
  executeWorkflowCommand: {
    successful: boolean;
    nextStateId: string | null;
    message: string | null;
    error: string | null;
  } | null;
};

export const createWorkflowApiClient = (options: WorkflowClientOptions): WorkflowApiClient => {
  const { environment, request } = options;

  const readRequest: WorkflowRequestOptions = {
    ...request,
    retry: { ...request?.retry, retryableStatuses: READ_RETRYABLE_STATUSES },
  };

  // No idempotency-key mechanism on the Authoring API; retrying a
  // workflow command that may have already applied risks moving the
  // item twice (e.g. through a two-command chain) or surfacing a
  // confusing "command not valid in current state" on the second
  // attempt. Match the policy hygiene uses for its writes.
  const writeRequest: WorkflowRequestOptions = {
    ...(request ?? {}),
    retry: { maxAttempts: 1 },
  };

  const getItemWorkflow = async (input: ItemSelector): Promise<ItemWorkflowState | null> => {
    if (!input.itemId && !input.path) {
      throw createScaiError("getItemWorkflow requires either itemId or path.", "INPUT_INVALID");
    }
    const data = input.itemId
      ? await runWorkflowAuthoringGraphQL<GraphQLWorkflowResponse>(
          environment,
          GET_ITEM_WORKFLOW_BY_ID,
          { itemId: input.itemId },
          readRequest
        )
      : await runWorkflowAuthoringGraphQL<GraphQLWorkflowResponse>(
          environment,
          GET_ITEM_WORKFLOW_BY_PATH,
          { path: input.path },
          readRequest
        );
    if (!data.item) return null;
    const wf = data.item.workflow;
    if (!wf || !wf.workflow) return null;
    return {
      itemId: data.item.itemId,
      path: data.item.path ?? null,
      workflowId: wf.workflow?.workflowId ?? null,
      workflowName: wf.workflow?.displayName ?? null,
      stateId: wf.workflowState?.stateId ?? null,
      stateName: wf.workflowState?.displayName ?? null,
      stateIsFinal: wf.workflowState?.final ?? false,
    };
  };

  const getWorkflowCommandsForItem = async (input: {
    workflowId: string;
    itemId: string;
  }): Promise<WorkflowCommandSummary[]> => {
    const data = await runWorkflowAuthoringGraphQL<GraphQLWorkflowCommandsResponse>(
      environment,
      GET_WORKFLOW_COMMANDS_FOR_ITEM_QUERY,
      { workflowId: input.workflowId, itemId: input.itemId },
      readRequest
    );
    return data.workflow?.commands?.nodes ?? [];
  };

  const executeWorkflowCommand = async (
    input: ExecuteWorkflowCommandInput
  ): Promise<WorkflowExecutionResult> => {
    if (!input.itemId && !input.path) {
      throw createScaiError(
        "executeWorkflowCommand requires either itemId or path.",
        "INPUT_INVALID"
      );
    }
    const itemInput: Record<string, unknown> = { database: "master" };
    if (input.itemId) itemInput.itemId = input.itemId;
    else if (input.path) itemInput.path = input.path;
    const payload: Record<string, unknown> = {
      commandId: input.commandId,
      item: itemInput,
    };
    if (input.comments !== undefined) payload.comments = input.comments;
    const data = await runWorkflowAuthoringGraphQL<GraphQLExecuteWorkflowCommandResponse>(
      environment,
      EXECUTE_WORKFLOW_COMMAND_MUTATION,
      { input: payload },
      writeRequest
    );
    const r = data.executeWorkflowCommand;
    return {
      successful: r?.successful ?? false,
      nextStateId: r?.nextStateId ?? null,
      message: r?.message ?? r?.error ?? null,
    };
  };

  return {
    getItemWorkflow,
    getWorkflowCommandsForItem,
    executeWorkflowCommand,
  };
};

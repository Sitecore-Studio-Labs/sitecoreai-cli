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

export interface WorkflowDefinitionSummary {
  /** Sitecore item ID — also the `workflowId` accepted by the API. */
  itemId: string;
  name: string;
  displayName: string | null;
  path: string;
}

export interface ListWorkflowDefinitionsOptions {
  /**
   * Content-tree root to scan. Defaults to `/sitecore/system/Workflows`.
   * Workflows nested under Workflow-Folder items are followed one level
   * deep; deeper nesting requires an explicit root override.
   */
  rootPath?: string;
}

export interface AssignedItemSummary {
  itemId: string;
  path: string;
  templateName: string | null;
  updatedDate: string | null;
}

export interface SearchItemsByWorkflowStateOptions {
  /** Sitecore state GUID — the item ID of the workflow State item. */
  stateId: string;
  /** Override the search index. Defaults to `sitecore_master_index`. */
  index?: string;
  /**
   * Override the search field. Defaults to `__workflow state` (the
   * standard system field name, lowercased and space-preserved). Some
   * tenants index the field as `__workflow_state` instead; supply
   * explicitly when the default returns no hits.
   */
  field?: string;
  /** Page size. Defaults to 100. */
  pageSize?: number;
  /** Cap on items returned. Defaults to 500. */
  maxItems?: number;
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
  /**
   * List Sitecore workflow definitions under `/sitecore/system/Workflows`
   * (override via `rootPath`). Walks direct children plus one level of
   * `Workflow Folder` items. Items whose template name is `"Workflow"`
   * are returned as definitions; folders are traversed, everything else
   * is skipped.
   */
  listWorkflowDefinitions(
    options?: ListWorkflowDefinitionsOptions
  ): Promise<WorkflowDefinitionSummary[]>;
  /**
   * Find items currently in the given workflow state. Backed by the
   * Sitecore search index — see `SearchItemsByWorkflowStateOptions` for
   * the field/index overrides if the default index naming doesn't match
   * the tenant.
   */
  searchItemsByWorkflowState(
    options: SearchItemsByWorkflowStateOptions
  ): Promise<AssignedItemSummary[]>;
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

const LIST_WORKFLOW_CHILDREN_QUERY = `
query($path: String!) {
  item(where: { path: $path }) {
    itemId
    children {
      nodes {
        itemId
        name
        displayName
        path
        template { templateId name }
      }
    }
  }
}`;

const WORKFLOW_TEMPLATE_NAME = "Workflow";
const WORKFLOW_FOLDER_TEMPLATE_NAME = "Workflow Folder";
const DEFAULT_WORKFLOWS_ROOT = "/sitecore/system/Workflows";
const DEFAULT_SEARCH_INDEX = "sitecore_master_index";
const DEFAULT_WORKFLOW_STATE_FIELD = "__workflow state";

/**
 * Build the workflow-state search query as an inlined GraphQL document.
 *
 * **Why inline rather than variable-bound.** The XM Cloud Authoring API
 * rejects `SearchCriteriaType` (and likely every search-enum type) when
 * passed via JSON variables — the server responds with
 * `EXEC_INVALID_TYPE: "The value of $query has a wrong structure."`
 * even for spec-conformant variable bindings. Inlining the enum as a
 * bare GraphQL token (`criteriaType: EXACT`) is the only shape the
 * resolver accepts. String values pass through `JSON.stringify`, which
 * is safe because GraphQL's string syntax is a strict subset of JSON's.
 */
const buildSearchByWorkflowStateDocument = (opts: {
  stateId: string;
  field: string;
  index: string;
  pageSize: number;
  pageIndex: number;
}): string => `query { search(query: {
  index: ${JSON.stringify(opts.index)}
  latestVersionOnly: true
  paging: { pageIndex: ${opts.pageIndex}, pageSize: ${opts.pageSize} }
  searchStatement: {
    criteria: {
      field: ${JSON.stringify(opts.field)}
      value: ${JSON.stringify(opts.stateId)}
      criteriaType: EXACT
    }
  }
}) {
  totalCount
  results { itemId path templateName updatedDate }
} }`;

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

type GraphQLChildrenResponse = {
  item: {
    itemId: string;
    children: {
      nodes: Array<{
        itemId: string;
        name: string;
        displayName: string | null;
        path: string;
        template: { templateId: string; name: string } | null;
      }>;
    };
  } | null;
};

type GraphQLWorkflowStateSearchResponse = {
  search: {
    totalCount: number;
    results: Array<{
      itemId: string;
      path: string;
      templateName: string | null;
      updatedDate: string | null;
    }>;
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

  const listChildren = async (path: string): Promise<GraphQLChildrenResponse["item"]> => {
    const data = await runWorkflowAuthoringGraphQL<GraphQLChildrenResponse>(
      environment,
      LIST_WORKFLOW_CHILDREN_QUERY,
      { path },
      readRequest
    );
    return data.item;
  };

  const listWorkflowDefinitions = async (
    options?: ListWorkflowDefinitionsOptions
  ): Promise<WorkflowDefinitionSummary[]> => {
    const rootPath = options?.rootPath ?? DEFAULT_WORKFLOWS_ROOT;
    const definitions: WorkflowDefinitionSummary[] = [];

    const visit = async (path: string, depth: number): Promise<void> => {
      const node = await listChildren(path);
      if (!node) return;
      for (const child of node.children.nodes) {
        const tname = child.template?.name;
        if (tname === WORKFLOW_TEMPLATE_NAME) {
          definitions.push({
            itemId: child.itemId,
            name: child.name,
            displayName: child.displayName,
            path: child.path,
          });
        } else if (tname === WORKFLOW_FOLDER_TEMPLATE_NAME && depth < 1) {
          // Recurse one level into folders. Deeper nesting would require
          // an explicit `rootPath` override — we bail to keep traversal
          // bounded on tenants with unusual structures.
          await visit(child.path, depth + 1);
        }
      }
    };

    await visit(rootPath, 0);
    return definitions;
  };

  const searchItemsByWorkflowState = async (
    opts: SearchItemsByWorkflowStateOptions
  ): Promise<AssignedItemSummary[]> => {
    const pageSize = opts.pageSize ?? 100;
    const maxItems = opts.maxItems ?? 500;
    const index = opts.index ?? DEFAULT_SEARCH_INDEX;
    const field = opts.field ?? DEFAULT_WORKFLOW_STATE_FIELD;
    const collected: AssignedItemSummary[] = [];

    for (let pageIndex = 0; collected.length < maxItems; pageIndex += 1) {
      const document = buildSearchByWorkflowStateDocument({
        stateId: opts.stateId,
        field,
        index,
        pageSize,
        pageIndex,
      });
      const data = await runWorkflowAuthoringGraphQL<GraphQLWorkflowStateSearchResponse>(
        environment,
        document,
        undefined,
        readRequest
      );
      const results = data.search?.results ?? [];
      if (results.length === 0) break;
      for (const r of results) {
        collected.push({
          itemId: r.itemId,
          path: r.path,
          templateName: r.templateName,
          updatedDate: r.updatedDate,
        });
        if (collected.length >= maxItems) break;
      }
      if (results.length < pageSize) break;
    }
    return collected;
  };

  return {
    getItemWorkflow,
    getWorkflowCommandsForItem,
    executeWorkflowCommand,
    listWorkflowDefinitions,
    searchItemsByWorkflowState,
  };
};

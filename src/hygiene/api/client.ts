import type { EnvironmentConfiguration } from "@/config";
import { createScaiError } from "@/shared/errors";
import { READ_RETRYABLE_STATUSES } from "@/shared/graphql";
import {
  createWorkflowApiClient,
  type ItemWorkflowState,
  type WorkflowApiClient,
} from "@/workflow/api";
import { runHygieneAuthoringGraphQL, type AuthoringRequestOptions } from "./graphql";

export type { ItemWorkflowState } from "@/workflow/api";

/**
 * Authoring GraphQL operations used by `scai audit` and `scai cleanup`.
 *
 * Schema verified against XM Cloud Authoring API by introspection
 * (2026-05-13). The shape of `SearchQueryInput`, `Item.versions`,
 * `ItemWorkflow`, `archivedItems`, and `deleteItemVersion` are pinned
 * here; if a tenant exposes a divergent schema, the call surfaces as
 * a `NETWORK` `ScaiError` with the upstream message preserved.
 *
 * Index name: `sitecore_master_index` is the conventional master-DB
 * index name on XM Cloud. Indexes are not user-renameable on XM Cloud,
 * but the search index is overridable per-call so callers can target
 * `sitecore_web_index` for published-state queries if needed.
 */

const DEFAULT_MASTER_INDEX = "sitecore_master_index";

const MEDIA_LIBRARY_ROOT = "/sitecore/media library";

export type SearchCriteriaType =
  | "EXACT"
  | "STARTSWITH"
  | "CONTAINS"
  | "ENDSWITH"
  | "WILDCARD"
  | "SEARCH"
  | "RANGE"
  | "FUZZY"
  | "PROXIMITY"
  | "REGEXP";

export type SearchOperator = "MUST" | "SHOULD" | "NOT";

export interface SearchCriterion {
  field: string;
  value: string;
  criteriaType?: SearchCriteriaType;
  operator?: SearchOperator;
}

export interface SearchStatement {
  operator?: SearchOperator;
  criteria?: SearchCriterion;
  subStatements?: SearchStatement[];
}

export interface SearchPaging {
  pageIndex?: number;
  pageSize?: number;
}

export interface SearchQuery {
  index?: string;
  language?: string;
  latestVersionOnly?: boolean;
  paging?: SearchPaging;
  searchStatement?: SearchStatement;
  filterStatement?: SearchStatement;
  sort?: { field: string; direction?: "ASCENDING" | "DESCENDING" };
}

export interface SearchResultItem {
  itemId: string;
  path: string;
  name: string;
  displayName?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  language?: { name: string } | null;
  version?: number | null;
  updatedDate?: string | null;
  createdDate?: string | null;
  database?: string | null;
  parentId?: string | null;
}

export interface SearchPage {
  totalCount: number;
  results: SearchResultItem[];
}

export interface ItemVersion {
  itemId: string;
  version: number;
  versionName: string | null;
  language: { name: string } | null;
}

export interface ItemField {
  fieldId: string;
  name: string;
  value: string;
}

export interface ArchivedItem {
  archivalId: string;
  itemId: string;
  name: string;
  originalLocation: string;
  archivedBy: string | null;
  archivedDate: string | null;
  parentId: string | null;
}

export interface DeleteItemVersionInput {
  itemId?: string;
  path?: string;
  language: string;
  version: number;
  database?: string;
}

export interface DeleteItemInput {
  itemId?: string;
  path?: string;
  database?: string;
  /** When false, item moves to archive instead of full delete. Default true. */
  permanently?: boolean;
}

export interface ArchiveVersionInput {
  itemId?: string;
  itemPath?: string;
  language: string;
  version: number;
  archiveName?: string;
}

export interface ItemTemplateSummary {
  templateId: string;
  name: string;
  fullName: string | null;
  /** itemId of the standard-values item, if one exists. Used to exclude
   *  the SV item from the "item-count" check for dead-template detection. */
  standardValuesItemId: string | null;
}

export interface ChildSummary {
  itemId: string;
  name: string;
  path: string;
  templateId: string | null;
  templateName: string | null;
}

export interface HygieneApiClient {
  search(query: SearchQuery): Promise<SearchPage>;
  /**
   * Paged iteration over a search query.
   *
   * `parallel` controls how many page-windows are fetched
   * concurrently after the first page reveals `totalCount`. Defaults
   * to 1 (serial, the original behavior). Set to 4+ for big tenants
   * where the search-crawl phase dominates wall-clock. Result order
   * is NOT stable across parallel runs — callers that need ordered
   * results should sort the final accumulated set.
   */
  searchAll(
    query: SearchQuery,
    perPage?: number,
    parallel?: number
  ): AsyncIterable<SearchResultItem>;
  getItemFields(selector: { itemId?: string; path?: string }): Promise<ItemField[] | null>;
  getItemFieldsBatch(itemIds: readonly string[]): Promise<Map<string, ItemField[] | null>>;
  itemExists(itemId: string): Promise<boolean>;
  itemsExistBatch(itemIds: readonly string[]): Promise<Map<string, boolean>>;
  getItemVersions(selector: {
    itemId?: string;
    path?: string;
    language?: string;
  }): Promise<ItemVersion[]>;
  getItemWorkflow(itemId: string, path: string): Promise<ItemWorkflowState | null>;
  listArchivedItems(options?: {
    archiveName?: string;
    pageIndex?: number;
    pageSize?: number;
  }): Promise<ArchivedItem[]>;
  deleteItemVersion(input: DeleteItemVersionInput): Promise<void>;
  /** Permanently delete an item (or move to archive when `permanently: false`). */
  deleteItem(input: DeleteItemInput): Promise<void>;
  /** Delete an item template (master DB). Throws if items still derive from it. */
  deleteItemTemplate(templateId: string, database?: string): Promise<void>;
  /** Purge a single record from the archive. */
  deleteArchivedItem(archivalId: string, archiveName?: string): Promise<void>;
  /** Archive a version (soft alternative to deleteItemVersion). */
  archiveVersion(input: ArchiveVersionInput): Promise<string | null>;
  /** List item templates under a content-tree root. */
  listItemTemplates(options?: {
    rootPath?: string;
    database?: string;
    pageSize?: number;
  }): Promise<ItemTemplateSummary[]>;
  /** Direct children of an item (one level), keyed for folder-empty checks. */
  getChildren(selector: { itemId?: string; path?: string }): Promise<ChildSummary[]>;
  /**
   * Apply field updates to a single item. Fields are passed by name +
   * new value. Used by `cleanup find-replace`. Authoring API resolves
   * field names against the item's template.
   */
  updateItemFields(input: {
    itemId: string;
    fields: Array<{ name: string; value: string }>;
  }): Promise<void>;
  /** Page through every user. */
  listUsers(options?: { pageSize?: number }): Promise<UserSummary[]>;
  /** Page through every role. Returns name + memberCount. */
  listRoles(options?: { pageSize?: number }): Promise<RoleSummary[]>;
  /**
   * Fetch a single user's roles + profile.lastActivity. Used by the
   * stale-user audit; one round trip per user, kept here so audits
   * can wrap with bounded concurrency.
   */
  getUserDetail(userName: string): Promise<UserDetail | null>;
  /** Delete a user account. */
  deleteUser(userName: string): Promise<void>;
  /** Delete a role. */
  deleteRole(roleName: string): Promise<void>;
  /**
   * Execute a workflow command on an item. Used by
   * `cleanup workflow advance` to push stale in-flight items
   * to their next state.
   */
  executeWorkflowCommand(input: {
    commandId: string;
    itemId?: string;
    path?: string;
    comments?: string;
  }): Promise<{
    successful: boolean;
    nextStateId: string | null;
    message: string | null;
  }>;
  /**
   * Resolve a workflow's available commands at a given state. Used by
   * the cleanup task to map a human-friendly command name (e.g.
   * "Submit") to its commandId for the current state.
   */
  /**
   * Resolve the workflow commands available for a specific item.
   * The Authoring API's `Workflow.commands` requires a
   * state-or-item context (`WorkflowStateOrItemQueryInput`) — same
   * workflow can expose different commands depending on the item's
   * current state.
   */
  getWorkflowCommandsForItem(input: {
    workflowId: string;
    itemId: string;
  }): Promise<Array<{ commandId: string; displayName: string }>>;
}

export interface UserSummary {
  name: string;
  isAdministrator: boolean;
  isAuthenticated: boolean;
  domain: string | null;
}

export interface RoleSummary {
  name: string;
  domain: string | null;
  memberCount: number;
}

export interface UserDetail {
  name: string;
  isAdministrator: boolean;
  roles: string[];
  /** From UserProfile.lastLoginDate. */
  lastLogin: string | null;
  /** From UserProfile.lastActivityDate (broader signal — any session activity). */
  lastActivity: string | null;
}

export interface HygieneClientOptions {
  environment: EnvironmentConfiguration;
  request?: AuthoringRequestOptions;
  /** Override the search index. Defaults to `sitecore_master_index`. */
  defaultIndex?: string;
}

const SEARCH_RESULT_FRAGMENT = `
totalCount
results {
  itemId
  path
  name
  displayName
  templateId
  templateName
  language { name }
  version
  updatedDate
  createdDate
  database
  parentId
}`;

/**
 * Build the `search` query as an inlined GraphQL document.
 *
 * **Why inline instead of variables.** The XM Cloud Authoring API
 * rejects `SearchCriteriaType` (and likely all enum types) when passed
 * via JSON variables — the server returns `EXEC_INVALID_TYPE: "The
 * value of $query has a wrong structure."` even for spec-conformant
 * variable bindings. Inlining the enum as a GraphQL literal token
 * (`criteriaType: CONTAINS`) is the only shape the resolver accepts.
 *
 * We escape strings via JSON.stringify, which is GraphQL-string-safe
 * because GraphQL string syntax is a strict subset of JSON string
 * syntax (both use `\"`, `\\`, `\n`, etc.). Numbers and booleans pass
 * through as their JS toString form. Enums are emitted as bare tokens
 * (no quotes), which is what makes this work.
 */
const ENUM_FIELDS = new Set(["criteriaType", "operator", "direction"]);

const serializeGraphQLValue = (value: unknown, key?: string): string => {
  if (value === null || value === undefined) return "null";
  if (key && ENUM_FIELDS.has(key) && typeof value === "string") {
    // Enum token — bare identifier, no quotes.
    return value;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => serializeGraphQLValue(v, key)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    return `{ ${entries.map(([k, v]) => `${k}: ${serializeGraphQLValue(v, k)}`).join(", ")} }`;
  }
  return String(value);
};

const buildSearchDocument = (queryInput: Record<string, unknown>): string => {
  const literal = serializeGraphQLValue(queryInput);
  return `query { search(query: ${literal}) { ${SEARCH_RESULT_FRAGMENT} } }`;
};

const GET_ITEM_FIELDS_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    itemId
    path
    fields(ownFields: false) {
      nodes {
        name
        value
        templateField { templateFieldId }
      }
    }
  }
}`;

const GET_ITEM_FIELDS_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    itemId
    path
    fields(ownFields: false) {
      nodes {
        name
        value
        templateField { templateFieldId }
      }
    }
  }
}`;

const GET_ITEM_VERSIONS_BY_PATH = `
query($path: String!, $language: String) {
  item(where: { path: $path, language: $language, existingVersionOnly: true }) {
    versions {
      itemId
      version
      versionName
      language { name }
    }
  }
}`;

const GET_ITEM_VERSIONS_BY_ID = `
query($itemId: ID!, $language: String) {
  item(where: { itemId: $itemId, language: $language, existingVersionOnly: true }) {
    versions {
      itemId
      version
      versionName
      language { name }
    }
  }
}`;

const LIST_ARCHIVED_ITEMS_DEFAULT = `
query($pageIndex: Int, $pageSize: Int) {
  archivedItems(pageIndex: $pageIndex, pageSize: $pageSize) {
    archivalId
    itemId
    name
    originalLocation
    archivedBy
    archivedDate
    parentId
  }
}`;

const LIST_ARCHIVED_ITEMS_NAMED = `
query($archiveName: String!, $pageIndex: Int, $pageSize: Int) {
  archivedItems(archiveName: $archiveName, pageIndex: $pageIndex, pageSize: $pageSize) {
    archivalId
    itemId
    name
    originalLocation
    archivedBy
    archivedDate
    parentId
  }
}`;

const DELETE_ITEM_VERSION_MUTATION = `
mutation($input: DeleteItemVersionInput!) {
  deleteItemVersion(input: $input) {
    successful
  }
}`;

const DELETE_ITEM_MUTATION = `
mutation($input: DeleteItemInput!) {
  deleteItem(input: $input) {
    successful
  }
}`;

const DELETE_ITEM_TEMPLATE_MUTATION = `
mutation($input: DeleteItemTemplateInput!) {
  deleteItemTemplate(input: $input) {
    successful
  }
}`;

const UPDATE_ITEM_MUTATION = `
mutation($input: UpdateItemInput!) {
  updateItem(input: $input) {
    item { itemId }
  }
}`;

const LIST_USERS_QUERY = `
query($first: PaginationAmount, $after: String) {
  users(first: $first, after: $after) {
    nodes { name isAdministrator isAuthenticated domain { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Per-role member sampling: `nodes` on `AccountConnection` doesn't
 * expose `totalCount`, so we page-1 the members and check `nodes`
 * length. >= 1 → has members; 0 → empty role. Quickest signal we can
 * get without an O(R*M) per-role member walk.
 */
const LIST_ROLES_QUERY = `
query($first: PaginationAmount, $after: String) {
  roles(first: $first, after: $after) {
    nodes {
      name
      domain { name }
      members(first: 1) { nodes { name } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const GET_USER_DETAIL_QUERY = `
query($userName: String!) {
  user(userName: $userName) {
    name
    isAdministrator
    roles { name }
    profile { lastLoginDate lastActivityDate }
  }
}`;

const DELETE_USER_MUTATION = `
mutation($input: DeleteUserInput!) {
  deleteUser(input: $input) { successful }
}`;

const DELETE_ROLE_MUTATION = `
mutation($input: DeleteRoleInput!) {
  deleteRole(input: $input) { successful }
}`;

const DELETE_ARCHIVED_ITEM_MUTATION = `
mutation($input: DeleteArchivedItemInput!) {
  deleteArchivedItem(input: $input) {
    successful
  }
}`;

const ARCHIVE_VERSION_MUTATION = `
mutation($input: ArchiveVersionInput!) {
  archiveVersion(input: $input) {
    archiveVersionId
  }
}`;

/**
 * Sitecore's well-known "Template" template id. Items based on this
 * template ARE themselves templates; using it as a `_template` filter
 * via search lets us enumerate templates under any content-tree subtree
 * (the Authoring API's `itemTemplates` connection doesn't accept a
 * subtree scope, only a single-template `path`).
 */
const TEMPLATE_TEMPLATE_ID = "ab86861a603046c5b394e8f99e8b87db";

const CHILD_FRAGMENT = `
itemId
name
path
template { templateId }`;

const GET_CHILDREN_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    children {
      nodes { ${CHILD_FRAGMENT} }
    }
  }
}`;

const GET_CHILDREN_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    children {
      nodes { ${CHILD_FRAGMENT} }
    }
  }
}`;

type GraphQLSearchResponse = { search: SearchPage };
type GraphQLFieldsResponse = {
  item: {
    itemId: string;
    path: string;
    fields: {
      nodes: Array<{
        name: string;
        value: string;
        templateField: { templateFieldId: string } | null;
      }>;
    };
  } | null;
};
type GraphQLVersionsResponse = {
  item: { versions: Array<ItemVersion> } | null;
};
type GraphQLArchivedResponse = { archivedItems: ArchivedItem[] | null };
type GraphQLDeleteVersionResponse = {
  deleteItemVersion: { successful: boolean } | null;
};
type GraphQLDeleteItemResponse = { deleteItem: { successful: boolean } | null };
type GraphQLDeleteTemplateResponse = {
  deleteItemTemplate: { successful: boolean } | null;
};
type GraphQLDeleteArchivedItemResponse = {
  deleteArchivedItem: { successful: boolean } | null;
};
type GraphQLUpdateItemResponse = {
  updateItem: { item: { itemId: string } | null } | null;
};
type GraphQLUsersResponse = {
  users: {
    nodes: Array<{
      name: string;
      isAdministrator: boolean;
      isAuthenticated: boolean;
      domain: { name: string } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } | null;
};
type GraphQLRolesResponse = {
  roles: {
    nodes: Array<{
      name: string;
      domain: { name: string } | null;
      members: { nodes: Array<{ name: string }> } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  } | null;
};
type GraphQLUserDetailResponse = {
  user: {
    name: string;
    isAdministrator: boolean;
    roles: Array<{ name: string }>;
    profile: {
      lastLoginDate: string | null;
      lastActivityDate: string | null;
    } | null;
  } | null;
};
type GraphQLDeleteUserResponse = { deleteUser: { successful: boolean } | null };
type GraphQLDeleteRoleResponse = { deleteRole: { successful: boolean } | null };
type GraphQLArchiveVersionResponse = {
  archiveVersion: { archiveVersionId: string | null } | null;
};
type GraphQLChildrenResponse = {
  item: {
    children: {
      nodes: Array<{
        itemId: string;
        name: string;
        path: string;
        template: { templateId: string } | null;
      }>;
    };
  } | null;
};
type GraphQLExistsResponse = { item: { itemId: string } | null };

export const createHygieneApiClient = (options: HygieneClientOptions): HygieneApiClient => {
  const { environment, request } = options;
  const defaultIndex = options.defaultIndex ?? DEFAULT_MASTER_INDEX;

  const readRequest: AuthoringRequestOptions = {
    ...request,
    retry: { ...request?.retry, retryableStatuses: READ_RETRYABLE_STATUSES },
  };

  /**
   * Hygiene mutations are limited to `deleteItemVersion`. Reused recipe-style
   * "no retry on writes" policy — the Authoring API has no idempotency-key
   * mechanism, so retrying a delete that may have already applied risks
   * surfacing a confusing "version not found" on the second attempt.
   */
  const writeRequest: AuthoringRequestOptions = {
    ...(request ?? {}),
    retry: { maxAttempts: 1 },
  };

  // Workflow primitives live in @/workflow/api; we delegate the
  // hygiene-facing methods so cleanup-workflow-advance and
  // audit-stale-workflow keep their existing HygieneApiClient surface.
  const workflowClient: WorkflowApiClient = createWorkflowApiClient({
    environment,
    request,
  });

  const buildSearchQuery = (query: SearchQuery): Record<string, unknown> => ({
    index: query.index ?? defaultIndex,
    ...(query.language !== undefined && { language: query.language }),
    ...(query.latestVersionOnly !== undefined && {
      latestVersionOnly: query.latestVersionOnly,
    }),
    ...(query.paging !== undefined && { paging: query.paging }),
    ...(query.searchStatement !== undefined && { searchStatement: query.searchStatement }),
    ...(query.filterStatement !== undefined && { filterStatement: query.filterStatement }),
    ...(query.sort !== undefined && { sort: query.sort }),
  });

  const search = async (query: SearchQuery): Promise<SearchPage> => {
    const document = buildSearchDocument(buildSearchQuery(query));
    const data = await runHygieneAuthoringGraphQL<GraphQLSearchResponse>(
      environment,
      document,
      undefined,
      readRequest
    );
    return {
      totalCount: data.search?.totalCount ?? 0,
      results: data.search?.results ?? [],
    };
  };

  async function* searchAll(
    query: SearchQuery,
    perPage = 100,
    parallel = 1
  ): AsyncIterable<SearchResultItem> {
    const startIndex = query.paging?.pageIndex ?? 0;
    const pageSize = query.paging?.pageSize ?? perPage;
    // Sanitise: parallel must be >= 1.
    const fanout = Math.max(1, Math.floor(parallel));

    // Always fetch the first page sequentially. We need its `totalCount`
    // to know how many pages to schedule in parallel mode; in serial
    // mode we use it both for results and for the termination test.
    const firstPage = await search({
      ...query,
      paging: { pageIndex: startIndex, pageSize },
    });
    for (const r of firstPage.results) yield r;
    if (firstPage.results.length < pageSize || firstPage.totalCount <= pageSize) {
      // No further pages needed.
      return;
    }

    const totalPages = Math.ceil(firstPage.totalCount / pageSize);
    // First page already consumed; remaining pages are [startIndex+1 ... totalPages-1+startIndex].
    const remainingStart = startIndex + 1;
    const remainingEnd = startIndex + totalPages - 1;

    if (fanout === 1) {
      // Serial path — preserves the original ordering guarantee that
      // existing callers may rely on (e.g. test fixtures).
      let seen = firstPage.results.length;
      for (let pageIndex = remainingStart; pageIndex <= remainingEnd; pageIndex += 1) {
        const page = await search({
          ...query,
          paging: { pageIndex, pageSize },
        });
        for (const r of page.results) yield r;
        seen += page.results.length;
        if (page.results.length < pageSize || seen >= firstPage.totalCount) break;
      }
      return;
    }

    // Parallel path — fetch pages in windows of size `fanout`. Within
    // a window, pages resolve concurrently; the window's results are
    // yielded in pageIndex order so per-window ordering is stable, but
    // cross-window order remains the page-index order.
    for (let windowStart = remainingStart; windowStart <= remainingEnd; windowStart += fanout) {
      const windowEnd = Math.min(windowStart + fanout - 1, remainingEnd);
      const indices: number[] = [];
      for (let i = windowStart; i <= windowEnd; i += 1) indices.push(i);
      const pages = await Promise.all(
        indices.map((pageIndex) =>
          search({
            ...query,
            paging: { pageIndex, pageSize },
          })
        )
      );
      for (const page of pages) {
        for (const r of page.results) yield r;
      }
      // Early stop: if the last page of this window returned a short
      // page, no further pages exist regardless of totalCount drift.
      if (pages[pages.length - 1].results.length < pageSize) return;
    }
  }

  const fieldsFromNode = (node: GraphQLFieldsResponse["item"]): ItemField[] => {
    if (!node) return [];
    return node.fields.nodes
      .filter((f) => f.templateField?.templateFieldId)
      .map((f) => ({
        fieldId: f.templateField!.templateFieldId,
        name: f.name,
        value: f.value,
      }));
  };

  const getItemFields = async (selector: {
    itemId?: string;
    path?: string;
  }): Promise<ItemField[] | null> => {
    if (selector.itemId) {
      const data = await runHygieneAuthoringGraphQL<GraphQLFieldsResponse>(
        environment,
        GET_ITEM_FIELDS_BY_ID,
        { itemId: selector.itemId },
        readRequest
      );
      return data.item ? fieldsFromNode(data.item) : null;
    }
    if (selector.path) {
      const data = await runHygieneAuthoringGraphQL<GraphQLFieldsResponse>(
        environment,
        GET_ITEM_FIELDS_BY_PATH,
        { path: selector.path },
        readRequest
      );
      return data.item ? fieldsFromNode(data.item) : null;
    }
    throw createScaiError("getItemFields requires path or itemId.", "INPUT_INVALID");
  };

  /**
   * Aliased batched read for field-lookup. One POST returns up to
   * `itemIds.length` items' fields. Keeps the request payload bounded
   * — caller should chunk to ~25 per batch like the recipe client does.
   */
  const getItemFieldsBatch = async (
    itemIds: readonly string[]
  ): Promise<Map<string, ItemField[] | null>> => {
    const result = new Map<string, ItemField[] | null>();
    if (itemIds.length === 0) return result;
    const varDecls = itemIds.map((_, i) => `$id${i}: ID!`).join(", ");
    const selections = itemIds
      .map(
        (_, i) => `
  i${i}: item(where: { itemId: $id${i} }) {
    itemId
    fields(ownFields: false) {
      nodes { name value templateField { templateFieldId } }
    }
  }`
      )
      .join("");
    const query = `query Batch(${varDecls}) {${selections}\n}`;
    const variables: Record<string, string> = {};
    itemIds.forEach((id, i) => {
      variables[`id${i}`] = id;
    });
    const data = await runHygieneAuthoringGraphQL<Record<string, GraphQLFieldsResponse["item"]>>(
      environment,
      query,
      variables,
      readRequest
    );
    itemIds.forEach((id, i) => {
      const node = data[`i${i}`];
      result.set(id, node ? fieldsFromNode(node) : null);
    });
    return result;
  };

  const itemExists = async (itemId: string): Promise<boolean> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLExistsResponse>(
      environment,
      `query($itemId: ID!) { item(where: { itemId: $itemId }) { itemId } }`,
      { itemId },
      readRequest
    );
    return data.item !== null;
  };

  const itemsExistBatch = async (itemIds: readonly string[]): Promise<Map<string, boolean>> => {
    const result = new Map<string, boolean>();
    if (itemIds.length === 0) return result;
    const varDecls = itemIds.map((_, i) => `$id${i}: ID!`).join(", ");
    const selections = itemIds
      .map(
        (_, i) => `
  i${i}: item(where: { itemId: $id${i} }) { itemId }`
      )
      .join("");
    const query = `query Batch(${varDecls}) {${selections}\n}`;
    const variables: Record<string, string> = {};
    itemIds.forEach((id, i) => {
      variables[`id${i}`] = id;
    });
    const data = await runHygieneAuthoringGraphQL<Record<string, { itemId: string } | null>>(
      environment,
      query,
      variables,
      readRequest
    );
    itemIds.forEach((id, i) => {
      result.set(id, data[`i${i}`] !== null);
    });
    return result;
  };

  const getItemVersions = async (selector: {
    itemId?: string;
    path?: string;
    language?: string;
  }): Promise<ItemVersion[]> => {
    const variables = { language: selector.language ?? null };
    if (selector.itemId) {
      const data = await runHygieneAuthoringGraphQL<GraphQLVersionsResponse>(
        environment,
        GET_ITEM_VERSIONS_BY_ID,
        { itemId: selector.itemId, ...variables },
        readRequest
      );
      return data.item?.versions ?? [];
    }
    if (selector.path) {
      const data = await runHygieneAuthoringGraphQL<GraphQLVersionsResponse>(
        environment,
        GET_ITEM_VERSIONS_BY_PATH,
        { path: selector.path, ...variables },
        readRequest
      );
      return data.item?.versions ?? [];
    }
    throw createScaiError("getItemVersions requires path or itemId.", "INPUT_INVALID");
  };

  const getItemWorkflow = async (
    itemId: string,
    path: string
  ): Promise<ItemWorkflowState | null> => {
    const result = await workflowClient.getItemWorkflow({ itemId });
    if (!result) return null;
    return { ...result, path: result.path ?? path };
  };

  const listArchivedItems = async (
    opts: { archiveName?: string; pageIndex?: number; pageSize?: number } = {}
  ): Promise<ArchivedItem[]> => {
    // The Authoring API resolver rejects a null `archiveName` even when
    // the GraphQL declaration types it as nullable. Use a query that
    // omits the variable entirely when the caller didn't ask for a
    // specific archive — that's the "all archives" path. When the caller
    // does provide a name, use the variant that declares it as required.
    const pageIndex = opts.pageIndex ?? 0;
    const pageSize = opts.pageSize ?? 100;
    if (opts.archiveName !== undefined) {
      const data = await runHygieneAuthoringGraphQL<GraphQLArchivedResponse>(
        environment,
        LIST_ARCHIVED_ITEMS_NAMED,
        { archiveName: opts.archiveName, pageIndex, pageSize },
        readRequest
      );
      return data.archivedItems ?? [];
    }
    const data = await runHygieneAuthoringGraphQL<GraphQLArchivedResponse>(
      environment,
      LIST_ARCHIVED_ITEMS_DEFAULT,
      { pageIndex, pageSize },
      readRequest
    );
    return data.archivedItems ?? [];
  };

  const deleteItemVersion = async (input: DeleteItemVersionInput): Promise<void> => {
    if (!input.itemId && !input.path) {
      throw createScaiError("deleteItemVersion requires either itemId or path.", "INPUT_INVALID");
    }
    const payload: Record<string, unknown> = {
      language: input.language,
      version: input.version,
      database: input.database ?? "master",
    };
    if (input.itemId) payload.itemId = input.itemId;
    else if (input.path) payload.path = input.path;
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteVersionResponse>(
      environment,
      DELETE_ITEM_VERSION_MUTATION,
      { input: payload },
      writeRequest
    );
    if (!data.deleteItemVersion?.successful) {
      throw createScaiError(
        `deleteItemVersion returned successful=${data.deleteItemVersion?.successful} for ${
          input.itemId ?? input.path
        } @${input.language} v${input.version}`,
        "UNKNOWN"
      );
    }
  };

  const deleteItem = async (input: DeleteItemInput): Promise<void> => {
    if (!input.itemId && !input.path) {
      throw createScaiError("deleteItem requires either itemId or path.", "INPUT_INVALID");
    }
    const payload: Record<string, unknown> = {
      database: input.database ?? "master",
      permanently: input.permanently ?? true,
    };
    if (input.itemId) payload.itemId = input.itemId;
    else if (input.path) payload.path = input.path;
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteItemResponse>(
      environment,
      DELETE_ITEM_MUTATION,
      { input: payload },
      writeRequest
    );
    if (!data.deleteItem?.successful) {
      throw createScaiError(
        `deleteItem returned successful=${data.deleteItem?.successful} for ${
          input.itemId ?? input.path
        }`,
        "UNKNOWN"
      );
    }
  };

  const deleteItemTemplate = async (templateId: string, database = "master"): Promise<void> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteTemplateResponse>(
      environment,
      DELETE_ITEM_TEMPLATE_MUTATION,
      { input: { templateId, database } },
      writeRequest
    );
    if (!data.deleteItemTemplate?.successful) {
      throw createScaiError(
        `deleteItemTemplate returned successful=${data.deleteItemTemplate?.successful} for template ${templateId}`,
        "UNKNOWN"
      );
    }
  };

  const deleteArchivedItem = async (archivalId: string, archiveName?: string): Promise<void> => {
    const input: Record<string, unknown> = { archivalId };
    if (archiveName !== undefined) input.archiveName = archiveName;
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteArchivedItemResponse>(
      environment,
      DELETE_ARCHIVED_ITEM_MUTATION,
      { input },
      writeRequest
    );
    if (!data.deleteArchivedItem?.successful) {
      throw createScaiError(
        `deleteArchivedItem returned successful=${data.deleteArchivedItem?.successful} for ${archivalId}`,
        "UNKNOWN"
      );
    }
  };

  const archiveVersion = async (input: ArchiveVersionInput): Promise<string | null> => {
    if (!input.itemId && !input.itemPath) {
      throw createScaiError("archiveVersion requires either itemId or itemPath.", "INPUT_INVALID");
    }
    const payload: Record<string, unknown> = {
      language: input.language,
      version: input.version,
    };
    if (input.itemId) payload.itemId = input.itemId;
    else if (input.itemPath) payload.itemPath = input.itemPath;
    if (input.archiveName !== undefined) payload.archiveName = input.archiveName;
    const data = await runHygieneAuthoringGraphQL<GraphQLArchiveVersionResponse>(
      environment,
      ARCHIVE_VERSION_MUTATION,
      { input: payload },
      writeRequest
    );
    return data.archiveVersion?.archiveVersionId ?? null;
  };

  /**
   * Enumerate item templates, optionally scoped to a content-tree subtree.
   *
   * Implementation note: the Authoring API's `itemTemplates(where: {path})`
   * matches one template by path (not a subtree), and `standardValuesItem`
   * requires a `language` argument that's awkward to thread through here.
   * Instead, we use the search index — items where `_template` is the
   * well-known "Template" template id ARE themselves templates. Adding a
   * `_path` filter scopes to a subtree. Name + path are pulled from the
   * search result; `fullName` is derived from the path by stripping the
   * `/sitecore/templates/` prefix.
   */
  const listItemTemplates = async (
    opts: { rootPath?: string; database?: string; pageSize?: number } = {}
  ): Promise<ItemTemplateSummary[]> => {
    const results: ItemTemplateSummary[] = [];
    let rootItemId: string | undefined;
    if (opts.rootPath) {
      const r = await search({
        paging: { pageSize: 1 },
        searchStatement: {
          criteria: {
            field: "_fullpath",
            value: opts.rootPath.toLowerCase(),
            criteriaType: "EXACT",
          },
        },
      });
      rootItemId = r.results[0]?.itemId;
      if (!rootItemId) {
        // Path doesn't resolve in the index — caller-error-shaped, but
        // not fatal here; we just return an empty list with no items.
        return [];
      }
    }
    const statement = rootItemId
      ? {
          operator: "MUST" as const,
          subStatements: [
            {
              criteria: {
                field: "_template",
                value: TEMPLATE_TEMPLATE_ID,
                criteriaType: "EXACT" as const,
              },
            },
            {
              criteria: {
                field: "_path",
                value: rootItemId.toLowerCase().replace(/[-{}]/g, ""),
                criteriaType: "CONTAINS" as const,
              },
            },
          ],
        }
      : {
          criteria: {
            field: "_template",
            value: TEMPLATE_TEMPLATE_ID,
            criteriaType: "EXACT" as const,
          },
        };
    for await (const r of searchAll(
      {
        latestVersionOnly: true,
        searchStatement: statement,
      },
      opts.pageSize ?? 100
    )) {
      const fullName = r.path ? r.path.replace(/^\/sitecore\/templates\//i, "") : null;
      results.push({
        templateId: r.itemId,
        name: r.name,
        fullName,
        standardValuesItemId: null,
      });
    }
    return results;
  };

  const getChildren = async (selector: {
    itemId?: string;
    path?: string;
  }): Promise<ChildSummary[]> => {
    const map = (
      nodes: Array<{
        itemId: string;
        name: string;
        path: string;
        template: { templateId: string } | null;
      }>
    ): ChildSummary[] =>
      nodes.map((n) => ({
        itemId: n.itemId,
        name: n.name,
        path: n.path,
        templateId: n.template?.templateId ?? null,
        templateName: null,
      }));
    if (selector.itemId) {
      const data = await runHygieneAuthoringGraphQL<GraphQLChildrenResponse>(
        environment,
        GET_CHILDREN_BY_ID,
        { itemId: selector.itemId },
        readRequest
      );
      return data.item ? map(data.item.children.nodes) : [];
    }
    if (selector.path) {
      const data = await runHygieneAuthoringGraphQL<GraphQLChildrenResponse>(
        environment,
        GET_CHILDREN_BY_PATH,
        { path: selector.path },
        readRequest
      );
      return data.item ? map(data.item.children.nodes) : [];
    }
    throw createScaiError("getChildren requires itemId or path.", "INPUT_INVALID");
  };

  const updateItemFields = async (input: {
    itemId: string;
    fields: Array<{ name: string; value: string }>;
  }): Promise<void> => {
    if (!input.itemId) {
      throw createScaiError("updateItemFields requires itemId.", "INPUT_INVALID");
    }
    if (!input.fields.length) {
      // No-op for empty field updates — saves a wire call.
      return;
    }
    const data = await runHygieneAuthoringGraphQL<GraphQLUpdateItemResponse>(
      environment,
      UPDATE_ITEM_MUTATION,
      {
        input: {
          itemId: input.itemId,
          fields: input.fields,
        },
      },
      writeRequest
    );
    if (!data.updateItem?.item?.itemId) {
      throw createScaiError(`updateItem returned no itemId for ${input.itemId}.`, "UNKNOWN");
    }
  };

  const listUsers = async (opts: { pageSize?: number } = {}): Promise<UserSummary[]> => {
    const pageSize = opts.pageSize ?? 100;
    const result: UserSummary[] = [];
    let after: string | null = null;
    while (true) {
      const variables: Record<string, unknown> = { first: pageSize };
      if (after) variables.after = after;
      const data = await runHygieneAuthoringGraphQL<GraphQLUsersResponse>(
        environment,
        LIST_USERS_QUERY,
        variables,
        readRequest
      );
      const conn = data.users;
      if (!conn) break;
      for (const u of conn.nodes) {
        result.push({
          name: u.name,
          isAdministrator: u.isAdministrator,
          isAuthenticated: u.isAuthenticated,
          domain: u.domain?.name ?? null,
        });
      }
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return result;
  };

  const listRoles = async (opts: { pageSize?: number } = {}): Promise<RoleSummary[]> => {
    const pageSize = opts.pageSize ?? 100;
    const result: RoleSummary[] = [];
    let after: string | null = null;
    while (true) {
      const variables: Record<string, unknown> = { first: pageSize };
      if (after) variables.after = after;
      const data = await runHygieneAuthoringGraphQL<GraphQLRolesResponse>(
        environment,
        LIST_ROLES_QUERY,
        variables,
        readRequest
      );
      const conn = data.roles;
      if (!conn) break;
      for (const r of conn.nodes) {
        // members(first:1) — count signal only. >= 1 → role has at
        // least one direct member. 0 → empty role.
        result.push({
          name: r.name,
          domain: r.domain?.name ?? null,
          memberCount: r.members?.nodes.length ?? 0,
        });
      }
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
    return result;
  };

  const getUserDetail = async (userName: string): Promise<UserDetail | null> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLUserDetailResponse>(
      environment,
      GET_USER_DETAIL_QUERY,
      { userName },
      readRequest
    );
    if (!data.user) return null;
    return {
      name: data.user.name,
      isAdministrator: data.user.isAdministrator,
      roles: data.user.roles.map((r) => r.name),
      lastLogin: data.user.profile?.lastLoginDate ?? null,
      lastActivity: data.user.profile?.lastActivityDate ?? null,
    };
  };

  const deleteUser = async (userName: string): Promise<void> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteUserResponse>(
      environment,
      DELETE_USER_MUTATION,
      { input: { userName } },
      writeRequest
    );
    if (!data.deleteUser?.successful) {
      throw createScaiError(
        `deleteUser returned successful=${data.deleteUser?.successful} for ${userName}`,
        "UNKNOWN"
      );
    }
  };

  const deleteRole = async (roleName: string): Promise<void> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLDeleteRoleResponse>(
      environment,
      DELETE_ROLE_MUTATION,
      { input: { roleName } },
      writeRequest
    );
    if (!data.deleteRole?.successful) {
      throw createScaiError(
        `deleteRole returned successful=${data.deleteRole?.successful} for ${roleName}`,
        "UNKNOWN"
      );
    }
  };

  const executeWorkflowCommand = workflowClient.executeWorkflowCommand;
  const getWorkflowCommandsForItem = workflowClient.getWorkflowCommandsForItem;

  return {
    search,
    searchAll,
    getItemFields,
    getItemFieldsBatch,
    itemExists,
    itemsExistBatch,
    getItemVersions,
    getItemWorkflow,
    listArchivedItems,
    deleteItemVersion,
    deleteItem,
    deleteItemTemplate,
    deleteArchivedItem,
    archiveVersion,
    listItemTemplates,
    getChildren,
    updateItemFields,
    listUsers,
    listRoles,
    getUserDetail,
    deleteUser,
    deleteRole,
    executeWorkflowCommand,
    getWorkflowCommandsForItem,
  };
};

export { MEDIA_LIBRARY_ROOT, DEFAULT_MASTER_INDEX };

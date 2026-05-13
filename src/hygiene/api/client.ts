import type { EnvironmentConfiguration } from "@/config";
import { createCliError } from "@/shared/errors";
import { READ_RETRYABLE_STATUSES } from "@/shared/graphql";
import { runHygieneAuthoringGraphQL, type AuthoringRequestOptions } from "./graphql";

/**
 * Authoring GraphQL operations used by `scai audit` and `scai cleanup`.
 *
 * Schema verified against XM Cloud Authoring API by introspection
 * (2026-05-13). The shape of `SearchQueryInput`, `Item.versions`,
 * `ItemWorkflow`, `archivedItems`, and `deleteItemVersion` are pinned
 * here; if a tenant exposes a divergent schema, the call surfaces as
 * a `NETWORK` `CliError` with the upstream message preserved.
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

export interface ItemWorkflowState {
  itemId: string;
  path: string;
  workflowName: string | null;
  workflowId: string | null;
  stateId: string | null;
  stateName: string | null;
  stateIsFinal: boolean;
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

export interface HygieneApiClient {
  search(query: SearchQuery): Promise<SearchPage>;
  searchAll(query: SearchQuery, perPage?: number): AsyncIterable<SearchResultItem>;
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

const GET_ITEM_WORKFLOW = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    itemId
    path
    workflow {
      workflowState {
        stateId
        displayName
        final
      }
      workflow {
        workflowId
        displayName
      }
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
type GraphQLArchivedResponse = { archivedItems: ArchivedItem[] | null };
type GraphQLDeleteVersionResponse = {
  deleteItemVersion: { successful: boolean } | null;
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

  async function* searchAll(query: SearchQuery, perPage = 100): AsyncIterable<SearchResultItem> {
    let pageIndex = query.paging?.pageIndex ?? 0;
    const pageSize = query.paging?.pageSize ?? perPage;
    let seen = 0;
    while (true) {
      const page = await search({
        ...query,
        paging: { pageIndex, pageSize },
      });
      for (const r of page.results) yield r;
      seen += page.results.length;
      if (page.results.length < pageSize || seen >= page.totalCount) break;
      pageIndex += 1;
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
    throw createCliError("getItemFields requires path or itemId.", "INPUT_INVALID");
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
    throw createCliError("getItemVersions requires path or itemId.", "INPUT_INVALID");
  };

  const getItemWorkflow = async (
    itemId: string,
    path: string
  ): Promise<ItemWorkflowState | null> => {
    const data = await runHygieneAuthoringGraphQL<GraphQLWorkflowResponse>(
      environment,
      GET_ITEM_WORKFLOW,
      { itemId },
      readRequest
    );
    if (!data.item) return null;
    const wf = data.item.workflow;
    if (!wf || !wf.workflow) return null;
    return {
      itemId: data.item.itemId,
      path: data.item.path ?? path,
      workflowId: wf.workflow?.workflowId ?? null,
      workflowName: wf.workflow?.displayName ?? null,
      stateId: wf.workflowState?.stateId ?? null,
      stateName: wf.workflowState?.displayName ?? null,
      stateIsFinal: wf.workflowState?.final ?? false,
    };
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
      throw createCliError("deleteItemVersion requires either itemId or path.", "INPUT_INVALID");
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
      throw createCliError(
        `deleteItemVersion returned successful=${data.deleteItemVersion?.successful} for ${
          input.itemId ?? input.path
        } @${input.language} v${input.version}`,
        "UNKNOWN"
      );
    }
  };

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
  };
};

export { MEDIA_LIBRARY_ROOT, DEFAULT_MASTER_INDEX };

import type { SitecoreApiClientOptions } from "@/auth";
import { createScaiError } from "@/shared/errors";
import { trimEndChar } from "@/shared/strings";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { READ_RETRYABLE_STATUSES } from "@/shared/graphql";
import type { FieldValue } from "../ir/operations";
import { SITECORE_TEMPLATES } from "../ir/sitecore-templates";
import { resolveMediaUpload } from "./media-filename";
import { dashifyGuid, renderRefValue, sameLevelItemName } from "./ref-encoding";
import {
  type AddItemVersionInput,
  type AddItemVersionResult,
  type AuthoringApiClient,
  type CreateItemInput,
  type CreateItemResult,
  type GetItemOptions,
  type ItemSelector,
  type MoveItemInput,
  type RemoteItem,
  type UpdateItemInput,
  type UploadMediaInput,
  type UploadMediaResult,
} from "./client";
import { getAccessToken } from "./auth";
import { runAuthoringGraphQL, type AuthoringRequestOptions } from "./graphql";

/** Sitecore itemIds are uuids — bare or wrapped in curly braces. Anything
 *  that doesn't look like one is treated as a content-tree path. */
const GUID_PATTERN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;

const isItemId = (value: string): boolean => GUID_PATTERN.test(value.trim());

/**
 * Pick the folder template scai will auto-create missing parent path
 * segments under. Conventional SXA template per tree:
 *
 * - `/sitecore/templates/...`         → `Template Folder` (the SXA editor
 *                                        treats these as templates-tree
 *                                        organisational nodes)
 * - `/sitecore/layout/Renderings/...` → `Rendering Folder` (verified
 *                                        against live tenant — section
 *                                        folders under
 *                                        `/sitecore/layout/Renderings/Project/<site>/`
 *                                        all conform to this template,
 *                                        not generic `Folder`)
 * - `.../Presentation/Headless Variants/...`
 *                                     → `HeadlessVariantsGrouping` (every
 *                                        folder under a site's Headless
 *                                        Variants tree — section
 *                                        groupings like `UI`, `Layout`,
 *                                        etc. — must conform to this
 *                                        template, otherwise SXA's editor
 *                                        won't enumerate the variants
 *                                        underneath. Per-rendering folders
 *                                        (`<root>/UI/AvatarBlock`) are
 *                                        always emitted explicitly with
 *                                        `HEADLESS_VARIANTS`, so this
 *                                        fallback only fires for the
 *                                        section-grouping depth.)
 * - everything else                   → generic `Folder`
 *
 * Picking the wrong template here doesn't break createItem itself, but
 * it can leave SXA's editor UI unable to recognise the auto-created
 * folder when walking the tree.
 *
 * Hazard fixed by the Headless Variants branch: a previous scai version
 * emitted variant items before the explicit section-grouping CreateItem
 * was added. Tenants pushed under that version got their `UI` /
 * `Layout` / etc. section folders auto-created here as generic
 * `Folder`. Subsequent runs emit the section grouping with
 * `HEADLESS_VARIANTS_GROUPING`, but `CreateOnly` policy skips updating
 * the existing item, so the wrong template persists. Detecting the
 * tree here at least keeps NEW installs correct; existing tenants
 * still need a manual delete-and-republish (or a future template-
 * correction migration) to fix the stale folder.
 */
const folderTemplateForPath = (path: string): string => {
  const normalized = path.toLowerCase();
  if (normalized.startsWith("/sitecore/templates/")) {
    return SITECORE_TEMPLATES.TEMPLATE_FOLDER;
  }
  if (normalized.startsWith("/sitecore/layout/renderings/")) {
    return SITECORE_TEMPLATES.RENDERING_FOLDER;
  }
  if (normalized.includes("/presentation/headless variants/")) {
    return SITECORE_TEMPLATES.HEADLESS_VARIANTS_GROUPING;
  }
  return SITECORE_TEMPLATES.FOLDER;
};

/**
 * Production `AuthoringApiClient` against Sitecore Authoring GraphQL.
 *
 * Schema verified against XM Cloud Authoring API via introspection
 * (2026-04-30). Notable shape facts:
 *
 * - `Item.parent` and `Item.template` are sub-objects (not flat scalars).
 * - `CreateItemInput` does NOT accept `itemId` — Sitecore assigns IDs
 *   server-side. The `createItem` response is the source of truth.
 * - `FieldValueInput` is `{ name, value, reset? }`; per-field language /
 *   version are not supported here (set at the input level via
 *   `CreateItemInput.language`).
 */

const ITEM_FRAGMENT = `
  itemId
  name
  path
  parent {
    itemId
  }
  template {
    templateId
  }
  fields(ownFields: false) {
    nodes {
      name
      value
      templateField {
        templateFieldId
      }
    }
  }
`;

const GET_ITEM_BY_PATH = `
query($path: String!) {
  item(where: { path: $path }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_ITEM_BY_ID = `
query($itemId: ID!) {
  item(where: { itemId: $itemId }) {
    ${ITEM_FRAGMENT}
  }
}`;

// Per-language and per-(language, version) variants — used by the prune
// rollback snapshot path so each pruned item's full version stack across
// every operator-configured language gets captured. The default-context
// queries above are kept distinct because most call sites don't need
// language/version and shouldn't pay the GraphQL variable-binding cost.
const GET_ITEM_BY_ID_AT_LANG = `
query($itemId: ID!, $language: String!) {
  item(where: { itemId: $itemId, language: $language }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_ITEM_BY_PATH_AT_LANG = `
query($path: String!, $language: String!) {
  item(where: { path: $path, language: $language }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_ITEM_BY_ID_AT_VERSION = `
query($itemId: ID!, $language: String!, $version: Int!) {
  item(where: { itemId: $itemId, language: $language, version: $version }) {
    ${ITEM_FRAGMENT}
  }
}`;

const GET_ITEM_BY_PATH_AT_VERSION = `
query($path: String!, $language: String!, $version: Int!) {
  item(where: { path: $path, language: $language, version: $version }) {
    ${ITEM_FRAGMENT}
  }
}`;

// Tenant-level languages connection. Returns every language ISO code
// configured on the tenant — the upper bound on which languages an
// item could have versions in. The XM Cloud Authoring schema does NOT
// expose `Item.languages` (verified via recon against TestDemo,
// 2026-06-01); tenant-level enumeration plus per-(item, language)
// `getItemVersions` probes is the supported discovery path.
const GET_TENANT_LANGUAGES = `
query {
  languages {
    nodes {
      name
    }
  }
}`;

// Children reads MUST paginate. The Authoring API's `children` field is
// a GraphQL connection with a server-side default page size — an
// argument-less `children { nodes }` silently returns only the FIRST
// page. That truncation blinded every children-based recovery layer
// (plan-time sibling fallback, `idempotencyCheck` pre-create probe, the
// already-exists adoption after a name-conflict) for parents with many
// children — e.g. a Headless Variants root holding one folder per
// component: the folders that sorted past the first page were invisible,
// so a repeat push planned a create and Sitecore rejected it with
// `The item name "<x>" is already defined on this level.`
//
// The page size is inlined as a literal (not a typed variable) so the
// query stays valid whether the server types `first` as `Int` or
// Sitecore's `PaginationAmount` scalar.
const CHILDREN_PAGE_SIZE = 50;

const childrenConnection = `
    children(first: ${CHILDREN_PAGE_SIZE}, after: $after) {
      nodes {
        ${ITEM_FRAGMENT}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }`;

const GET_CHILDREN_BY_PATH = `
query($path: String!, $after: String) {
  item(where: { path: $path }) {
${childrenConnection}
  }
}`;

const GET_CHILDREN_BY_ID = `
query($itemId: ID!, $after: String) {
  item(where: { itemId: $itemId }) {
${childrenConnection}
  }
}`;

const CREATE_ITEM_MUTATION = `
mutation($input: CreateItemInput!) {
  createItem(input: $input) {
    item {
      itemId
    }
  }
}`;

const UPDATE_ITEM_MUTATION = `
mutation($input: UpdateItemInput!) {
  updateItem(input: $input) {
    item {
      itemId
    }
  }
}`;

const DELETE_ITEM_MUTATION = `
mutation($input: DeleteItemInput!) {
  deleteItem(input: $input) {
    successful
  }
}`;

const MOVE_ITEM_MUTATION = `
mutation($input: MoveItemInput!) {
  moveItem(input: $input) {
    item {
      itemId
    }
  }
}`;

const ADD_ITEM_VERSION_MUTATION = `
mutation($input: AddItemVersionInput!) {
  addItemVersion(input: $input) {
    item {
      version
    }
  }
}`;

const UPLOAD_MEDIA_MUTATION = `
mutation($input: UploadMediaInput!) {
  uploadMedia(input: $input) {
    presignedUploadUrl
  }
}`;

const GET_ITEM_VERSIONS_BY_ID = `
query($itemId: ID!, $language: String!) {
  item(where: { itemId: $itemId, language: $language }) {
    versions {
      version
    }
  }
}`;

const GET_ITEM_VERSIONS_BY_PATH = `
query($path: String!, $language: String!) {
  item(where: { path: $path, language: $language }) {
    versions {
      version
    }
  }
}`;

type RemoteItemNode = {
  itemId: string;
  name: string;
  path: string;
  parent: { itemId: string } | null;
  template: { templateId: string } | null;
  fields: {
    nodes: Array<{
      name: string;
      value: string;
      templateField: { templateFieldId: string } | null;
    }>;
  };
};

type GraphQLItemResponse = { item: RemoteItemNode | null };
type GraphQLChildrenResponse = {
  item: {
    children: {
      nodes: RemoteItemNode[];
      // Defensive-optional: a server that doesn't return pageInfo (or an
      // older recorded fixture) degrades to single-page behavior instead
      // of crashing the read.
      pageInfo?: { hasNextPage: boolean; endCursor: string | null } | null;
    };
  } | null;
};
type GraphQLCreateItemResponse = {
  createItem: { item: { itemId: string } | null } | null;
};

const toRemoteItem = (node: RemoteItemNode): RemoteItem => ({
  itemId: node.itemId,
  name: node.name,
  path: node.path,
  parentId: node.parent?.itemId ?? "",
  templateId: node.template?.templateId ?? "",
  // The Authoring API returns `field.name` as the field's display name
  // (e.g. "__Icon", "componentName"). Drift detection prefers the recipe
  // op's `fieldName` when present (recipe-created fields whose GUIDs the
  // tenant doesn't recognize); else falls back to the field's GUID at
  // `field.templateField.templateFieldId`. Sitecore normalizes those GUIDs
  // without dashes, so re-format to canonical 8-4-4-4-12.
  //
  // `node.fields` can be `null` when the item exists at the lookup
  // level but has no content in the requested (language, version) —
  // the per-language and per-(lang, version) GraphQL queries return
  // `fields: null` in that case. Guard universally so every caller
  // (single getItem, batched per-language/per-version, getChildren via
  // GET_CHILDREN_BY_ID) gets a consistent empty-fields shape.
  fields: (node.fields?.nodes ?? [])
    .filter((field) => field.templateField?.templateFieldId)
    .map((field) => ({
      fieldId: dashifyGuid(field.templateField!.templateFieldId),
      name: field.name,
      value: field.value,
    })),
});

const toAuthoringFieldsInput = (fields: FieldValue[]): Array<{ name: string; value: string }> =>
  fields.map((field) => ({
    // Sitecore's `FieldValueInput.name` accepts a field name OR id. For
    // recipe-created fields, the IR's `fieldId` is only a uuidv5 refKey
    // (the tenant's server-assigned GUID is different) — fall through to
    // `fieldName`, which Sitecore resolves against the item's template.
    // For system fields without a `fieldName`, the literal GUID works.
    name: field.fieldName ?? field.fieldId,
    value: renderRefValue(field.value),
  }));

export interface AuthoringClientOptions {
  /**
   * Auth + host options for the Authoring API. The CLI passes its full
   * resolved `EnvironmentConfiguration` (which structurally satisfies
   * `SitecoreApiClientOptions`) — typically augmented with `orgClientId`
   * from the root config's `orgClients` block so the auth layer can
   * resolve the org-scoped automation client.
   */
  environment: SitecoreApiClientOptions;
  request?: AuthoringRequestOptions;
  /**
   * Optional shared path → itemId cache. When provided, the client uses
   * it as a read-through layer for `ensurePathExists` (skipping a wire
   * call when the parent path was already resolved by an earlier
   * createItem in the same push) and writes new entries as it
   * auto-provisions folder ancestors.
   *
   * The recipe executor passes a map shared with its `capturedItemIds`
   * so the workspace prefetch can pre-seed path resolutions and the
   * client picks them up without re-fetching. Paths and recipe-internal
   * refKey GUIDs share the same map but never collide (paths start
   * with `/`).
   */
  pathItemIdCache?: Map<string, string>;
  /**
   * Maximum number of paths bundled into one aliased `getItemsByPaths`
   * GraphQL query. Defaults to 25 — picks a balance between request
   * payload size and round-trip count. Tunable for tenants with
   * unusually low or high request-size limits.
   */
  batchedReadSize?: number;
  /**
   * Number of batched-read queries dispatched in parallel. Defaults to 4.
   * The shared GraphQL transport handles 429/503 backoff automatically,
   * so safe to fan out — but kept conservative so a fresh push doesn't
   * thunder-herd a cold tenant.
   */
  batchedReadConcurrency?: number;
}

const DEFAULT_BATCH_READ_SIZE = 25;
const DEFAULT_BATCH_READ_CONCURRENCY = 4;

export const createAuthoringClient = (options: AuthoringClientOptions): AuthoringApiClient => {
  const { environment, request, pathItemIdCache } = options;
  const batchSize = options.batchedReadSize ?? DEFAULT_BATCH_READ_SIZE;
  const batchConcurrency = options.batchedReadConcurrency ?? DEFAULT_BATCH_READ_CONCURRENCY;

  /**
   * Per-call request options for read operations — extends caller-supplied
   * `request` with the broad retry status set. Reads are idempotent so
   * retrying through 500/502/504 is safe and absorbs transient gateway
   * errors without aborting the whole push.
   */
  const readRequest: AuthoringRequestOptions = {
    ...request,
    retry: { ...request?.retry, retryableStatuses: READ_RETRYABLE_STATUSES },
  };

  /**
   * Per-call request options for write operations. Writes retry ONLY on a
   * server-side "operation was canceled" — a cancelled operation is aborted
   * and rolled back, so it never applied and re-sending it is safe (this is
   * what a heavy localize pass hits when the Authoring API times out a batch
   * of language-version writes). Everything else stays fail-fast: the
   * Authoring GraphQL endpoint has no idempotency key, so 408/425/429/503 can
   * all be returned AFTER the upstream applied the mutation, and an ambiguous
   * abort / `fetch failed` may also have applied — retrying any of those risks
   * a silent double-apply. `retryableStatuses: ∅` + `retryAmbiguousNetwork:
   * false` leave exactly the cancellation branch active. The rollback flow
   * still recovers genuine partial-write states by replay.
   *
   * If 429 throttling becomes a real operational issue, add an
   * `Idempotency-Key` header on writes BEFORE widening this.
   */
  const writeRequest: AuthoringRequestOptions = {
    ...(request ?? {}),
    retry: {
      maxAttempts: 3,
      retryableStatuses: new Set(),
      retryAmbiguousNetwork: false,
    },
  };

  // Per-client cache for the tenant's configured language ISO codes.
  // First `getTenantLanguages` call hits the wire; subsequent calls
  // return the cached promise. The cache lives for the client's
  // lifetime — tenants don't add/remove languages in the middle of a
  // push, and re-reading per pruned item would be wasteful.
  let tenantLanguagesCache: Promise<string[]> | null = null;

  const fetchOne = async (
    selector: ItemSelector,
    opts?: GetItemOptions
  ): Promise<RemoteItemNode | null> => {
    const language = opts?.language;
    const version = opts?.version;
    if (version !== undefined && language === undefined) {
      throw createScaiError(
        "getItem options.version requires options.language to also be set.",
        "INPUT_INVALID"
      );
    }
    if (selector.itemId) {
      if (version !== undefined && language !== undefined) {
        const data = await runAuthoringGraphQL<GraphQLItemResponse>(
          environment,
          GET_ITEM_BY_ID_AT_VERSION,
          { itemId: selector.itemId, language, version },
          readRequest
        );
        return data.item;
      }
      if (language !== undefined) {
        const data = await runAuthoringGraphQL<GraphQLItemResponse>(
          environment,
          GET_ITEM_BY_ID_AT_LANG,
          { itemId: selector.itemId, language },
          readRequest
        );
        return data.item;
      }
      const data = await runAuthoringGraphQL<GraphQLItemResponse>(
        environment,
        GET_ITEM_BY_ID,
        { itemId: selector.itemId },
        readRequest
      );
      return data.item;
    }
    if (selector.path) {
      if (version !== undefined && language !== undefined) {
        const data = await runAuthoringGraphQL<GraphQLItemResponse>(
          environment,
          GET_ITEM_BY_PATH_AT_VERSION,
          { path: selector.path, language, version },
          readRequest
        );
        return data.item;
      }
      if (language !== undefined) {
        const data = await runAuthoringGraphQL<GraphQLItemResponse>(
          environment,
          GET_ITEM_BY_PATH_AT_LANG,
          { path: selector.path, language },
          readRequest
        );
        return data.item;
      }
      const data = await runAuthoringGraphQL<GraphQLItemResponse>(
        environment,
        GET_ITEM_BY_PATH,
        { path: selector.path },
        readRequest
      );
      return data.item;
    }
    throw createScaiError("ItemSelector requires either path or itemId.", "INPUT_INVALID");
  };

  /**
   * Batched path→item read using GraphQL aliased fields. One POST returns
   * up to `batchSize` items. Aliasing format:
   *
   *   query Batch($p0: String!, $p1: String!, ...) {
   *     i0: item(where: { path: $p0 }) { ...ItemFragment }
   *     i1: item(where: { path: $p1 }) { ...ItemFragment }
   *     ...
   *   }
   *
   * Aliases are stable per call (`i0`, `i1`, ...) so the response object
   * keys map cleanly back to the input slice. Missing items return
   * `null` under their alias — same shape as a single-path 404.
   */
  const fetchOneBatch = async (paths: readonly string[]): Promise<Array<RemoteItemNode | null>> => {
    if (paths.length === 0) return [];
    const variableDecls = paths.map((_, i) => `$p${i}: String!`).join(", ");
    const aliasedSelections = paths
      .map(
        (_, i) => `
  i${i}: item(where: { path: $p${i} }) {
    ${ITEM_FRAGMENT}
  }`
      )
      .join("");
    const query = `query Batch(${variableDecls}) {${aliasedSelections}\n}`;
    const variables: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 1) {
      variables[`p${i}`] = paths[i];
    }
    const data = await runAuthoringGraphQL<Record<string, RemoteItemNode | null>>(
      environment,
      query,
      variables,
      readRequest
    );
    return paths.map((_, i) => data[`i${i}`] ?? null);
  };

  // Hard page ceiling: 200 pages × CHILDREN_PAGE_SIZE = 10k children —
  // far beyond any recipe-managed container, and a guarantee that a
  // misbehaving server echoing a stable cursor can't spin the loop
  // forever.
  const CHILDREN_MAX_PAGES = 200;

  const fetchChildren = async (selector: ItemSelector): Promise<RemoteItemNode[]> => {
    let query: string;
    let baseVariables: Record<string, string>;
    if (selector.itemId) {
      query = GET_CHILDREN_BY_ID;
      baseVariables = { itemId: selector.itemId };
    } else if (selector.path) {
      query = GET_CHILDREN_BY_PATH;
      baseVariables = { path: selector.path };
    } else {
      throw createScaiError("ItemSelector requires either path or itemId.", "INPUT_INVALID");
    }
    const nodes: RemoteItemNode[] = [];
    let after: string | null = null;
    for (let page = 0; page < CHILDREN_MAX_PAGES; page += 1) {
      // `variables` computed before the call (and `data` explicitly
      // annotated) so `after`'s reassignment below doesn't put the
      // awaited result in its own inference cycle (TS7022).
      const variables: Record<string, string> =
        after === null ? baseVariables : { ...baseVariables, after };
      const data: GraphQLChildrenResponse = await runAuthoringGraphQL<GraphQLChildrenResponse>(
        environment,
        query,
        variables,
        readRequest
      );
      const connection = data.item?.children;
      if (!connection) break;
      nodes.push(...connection.nodes);
      const pageInfo = connection.pageInfo;
      if (
        !pageInfo?.hasNextPage ||
        !pageInfo.endCursor ||
        pageInfo.endCursor === after ||
        connection.nodes.length === 0
      ) {
        break;
      }
      after = pageInfo.endCursor;
    }
    return nodes;
  };

  /**
   * Walk the content-tree path bottom-up, returning the itemId of `path`.
   * Creates any missing segments using `folderTemplateForPath`. Recursive
   * — each level either finds an existing item OR creates one and walks
   * up further. The Sitecore root (`/sitecore`) MUST already exist; any
   * path that bottoms out before reaching an existing ancestor throws.
   *
   * Used by `createItem` to satisfy Authoring GraphQL's
   * `CreateItemInput.parent: ID!` typing — callers pass paths, scai
   * resolves to itemIds (auto-provisioning the SXA-style folder chain
   * if the tenant's per-site templates/renderings/content folders
   * haven't been scaffolded yet).
   */
  const ensurePathExists = async (rawPath: string): Promise<string> => {
    const path = trimEndChar(rawPath, "/");
    // Fast path: caller (or an earlier ensurePathExists) already resolved
    // this path. Avoids the redundant `getItem` round trip every sibling
    // createItem would otherwise pay under a shared section folder.
    const cached = pathItemIdCache?.get(path);
    if (cached) return cached;

    const existing = await fetchOne({ path });
    if (existing) {
      pathItemIdCache?.set(path, existing.itemId);
      return existing.itemId;
    }

    const lastSlash = path.lastIndexOf("/");
    if (lastSlash <= 0) {
      throw createScaiError(
        `Cannot auto-create root path '${path}'. The Sitecore root must already exist on the tenant.`,
        "INPUT_INVALID"
      );
    }
    const parentPath = path.slice(0, lastSlash);
    const name = path.slice(lastSlash + 1);
    if (!name) {
      throw createScaiError(`Path '${rawPath}' has no leaf segment to create.`, "INPUT_INVALID");
    }
    const parentItemId = await ensurePathExists(parentPath);
    const templateId = folderTemplateForPath(path);

    let itemId: string | undefined;
    try {
      const data = await runAuthoringGraphQL<GraphQLCreateItemResponse>(
        environment,
        CREATE_ITEM_MUTATION,
        {
          input: {
            parent: parentItemId,
            templateId,
            name,
            database: "master",
            language: "en",
            fields: [],
          },
        },
        writeRequest
      );
      itemId = data.createItem?.item?.itemId ?? undefined;
    } catch (error) {
      // Same idempotent-create fallback as `createItem` below. Two ways to
      // reach it: Sitecore's path index (the `fetchOne({path})` probe
      // above) lags writes, so a folder created seconds ago can read as
      // missing — and CONCURRENT pushes (the orchestrator's parallel
      // localize chunks / batch waves) can both probe-miss the same
      // missing segment and race the create; the loser lands here. The
      // parent-child read is not lag-prone, so resolving the existing
      // sibling by name and continuing is correct in both cases.
      if (isAlreadyExistsError(error)) {
        const existing = await findChildByName(parentItemId, name);
        if (existing) {
          pathItemIdCache?.set(path, existing.itemId);
          return existing.itemId;
        }
      }
      throw error;
    }
    if (!itemId) {
      throw createScaiError(
        `Auto-provisioning failed: Authoring API returned no itemId after creating folder '${path}'.`,
        "UNKNOWN"
      );
    }
    pathItemIdCache?.set(path, itemId);
    return itemId;
  };

  /**
   * Detect Sitecore's name-conflict error class. Authoring GraphQL
   * surfaces these as wrapped ScaiError messages of the form:
   *
   *   `Authoring GraphQL errors: The item name "X" is already defined on this level.`
   *
   * The variant `"is not unique"` and `"already exists"` are also
   * known phrasings on adjacent server versions; match permissively
   * so our idempotent-create fallback covers them all.
   */
  const isAlreadyExistsError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const msg = error.message;
    return (
      /already defined on this level/i.test(msg) ||
      /is not unique/i.test(msg) ||
      /already exists/i.test(msg) ||
      /name is already in use/i.test(msg)
    );
  };

  /**
   * Look up a single direct child of `parentItemId` by name. Used by
   * the idempotent-create fallback when `createItem` reports a
   * name conflict — the parent-child relationship is not subject to
   * Sitecore's path-index propagation lag, so this returns the
   * correct existing item even when `getItem({path})` for the same
   * path still reports null.
   */
  const findChildByName = async (
    parentItemId: string,
    name: string
  ): Promise<RemoteItemNode | null> => {
    const children = await fetchChildren({ itemId: parentItemId });
    // Exact match wins; otherwise fall back to Sitecore's own per-level
    // uniqueness semantics (names are case-insensitively unique on a
    // level) so a case-variant sibling — which the create mutation WILL
    // reject as "already defined on this level" — is still adoptable.
    return (
      children.find((c) => c.name === name) ??
      children.find((c) => sameLevelItemName(c.name, name)) ??
      null
    );
  };

  /** Shared `updateItem` implementation — also used by the adopt-and-retemplate path below. */
  const updateItemImpl = async (input: UpdateItemInput): Promise<void> => {
    // Template change (adopt-and-retemplate): the Authoring GraphQL
    // schema has NO `UpdateItemInput.templateId` (sending one fails
    // variable coercion — "The value of $input has a wrong structure")
    // and no changeTemplate mutation. The template assignment is stored
    // in the `__Template` system field, so the change rides the normal
    // fields channel — the same system-field write path `__Renderings`
    // and `__Masters` already use — as a Sitecore-formatted braced ID.
    const templateField =
      input.templateId !== undefined
        ? [
            {
              name: "__Template",
              value: `{${dashifyGuid(input.templateId).toUpperCase()}}`,
            },
          ]
        : [];
    await runAuthoringGraphQL(
      environment,
      UPDATE_ITEM_MUTATION,
      {
        input: {
          itemId: input.itemId,
          // `UpdateItemInput` carries language/version at the input level;
          // the Authoring API has no per-field language/version. A
          // SetField targeting a story-seed version lands here.
          ...(input.language !== undefined && { language: input.language }),
          ...(input.version !== undefined && { version: input.version }),
          fields: [...templateField, ...toAuthoringFieldsInput(input.fields)],
        },
      },
      writeRequest
    );
  };

  /**
   * Finish adopting an existing same-named child in place of a create —
   * the shared tail of the `idempotencyCheck` pre-check and the
   * already-exists fallback.
   *
   * Default behavior (no `retemplateOnAdopt`, or live template already
   * matching): return the existing itemId untouched — the historical
   * adopt-as-is contract.
   *
   * With `retemplateOnAdopt` and a live-template mismatch, the adopted
   * item is a NAME-TWIN whose shape doesn't match the recipe — the
   * signature of an item stranded by an earlier partial/rolled-back
   * install (rollback is best-effort; a failed `deleteItem` strands the
   * created item), possibly under a different site handle's template
   * GUID family at the same shared-data-folder path. Adopting it
   * untouched aborts the recipe on the first field write ("Cannot find
   * a field with the name <X>" — the write resolves field names against
   * the item's live template, which lacks the recipe's fields or
   * dangles entirely). Instead:
   *
   *   1. Retemplate the item to the op's expected (live) template.
   *   2. Seed the create's fields, exactly as the mutation would have.
   *
   * Behavior choice, against the two precedents:
   *   - v0.32.5's rebind guard REFUSES a template-mismatched marked
   *     sibling and creates fresh — right for a RENAME candidate, whose
   *     recipe name is free. Here the twin holds the recipe's own name
   *     at the recipe's own path, so "create fresh" is impossible (it
   *     collides right back); the only convergent outcome is making the
   *     name-matched item conform.
   *   - v0.33.0 adopts FOLDER-class items across template mismatches
   *     because folders carry no authored data (lossless). A
   *     recipe-seeded content item is the data-bearing analogue:
   *     identity is deterministic (`contentItemId(site, handle)`),
   *     Sitecore stores field values keyed by field ID, so values under
   *     a foreign template's field ids are unreachable/orphaned no
   *     matter what we do — retemplating loses nothing the recipe
   *     doesn't immediately re-seed, and it PRESERVES the item's GUID
   *     (unlike delete + recreate), so any cross-site layout references
   *     keep resolving to an item that at least renders this recipe's
   *     content.
   *
   * Mechanism: the Authoring GraphQL schema has no template-change
   * surface (no `UpdateItemInput.templateId`, no changeTemplate
   * mutation), so the retemplate is a `__Template` system-field write
   * through `updateItemImpl`'s fields channel. If the tenant rejects
   * or ignores that write, the follow-up field seed resolves names
   * against the OLD template and throws — either way the raw error is
   * wrapped into an actionable one naming the colliding item, its live
   * template, and the expected template — an explicit, diagnosable
   * outcome instead of the downstream field-write abort.
   */
  const adoptExistingChild = async (
    input: CreateItemInput,
    existing: RemoteItemNode
  ): Promise<CreateItemResult> => {
    const liveTemplateId = existing.template?.templateId ?? "";
    const templateMatches =
      liveTemplateId === "" || dashifyGuid(liveTemplateId) === dashifyGuid(input.templateId);
    if (!input.retemplateOnAdopt || templateMatches) {
      return { itemId: existing.itemId };
    }
    try {
      // Two calls on purpose: retemplate FIRST so the field write that
      // follows resolves names against the recipe's template — a single
      // combined call would leave the server's template-change/field-write
      // ordering unspecified.
      await updateItemImpl({ itemId: existing.itemId, templateId: input.templateId, fields: [] });
      if (input.fields.length > 0) {
        await updateItemImpl({ itemId: existing.itemId, fields: input.fields });
      }
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error);
      throw createScaiError(
        `createItem '${input.name}' adopted existing item '${existing.path}' (${existing.itemId}), ` +
          `but its live template ${liveTemplateId || "<none>"} does not match the expected template ` +
          `${input.templateId} and retemplating it failed: ${original}`,
        "NETWORK",
        {
          hint:
            "The item is a stranded name-twin from an earlier partial install. Inspect it in the " +
            "Content Editor; either change its template to the expected one (or delete it), then " +
            "re-run the push.",
        }
      );
    }
    return { itemId: existing.itemId };
  };

  /**
   * Resolve a `CreateItemInput.parent` value (itemId GUID OR content-tree
   * path) to a Sitecore itemId. The Authoring API's
   * `CreateItemInput.parent` is typed `ID!`, so paths must be resolved
   * before the mutation — otherwise GraphQL fails with
   * "Unable to convert type from String to Guid". Missing path segments
   * are auto-created as folders.
   */
  const resolveParentItemId = async (parent: string): Promise<string> => {
    const trimmed = parent.trim();
    if (isItemId(trimmed)) return trimmed.replace(/[{}]/g, "");
    if (trimmed.startsWith("/")) return ensurePathExists(trimmed);
    throw createScaiError(
      `createItem.input.parent must be a Sitecore itemId or content-tree path; got: '${trimmed}'.`,
      "INPUT_INVALID"
    );
  };

  return {
    async getItem(selector, options?: GetItemOptions): Promise<RemoteItem | null> {
      const node = await fetchOne(selector, options);
      return node ? toRemoteItem(node) : null;
    },

    async getItemsByPaths(paths): Promise<Map<string, RemoteItem | null>> {
      const result = new Map<string, RemoteItem | null>();
      if (paths.length === 0) return result;

      // De-duplicate within a single call so repeated paths don't
      // cost extra wire bytes; preserve the original strings for the
      // returned map (caller-key contract).
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const p of paths) {
        if (!seen.has(p)) {
          seen.add(p);
          unique.push(p);
        }
      }

      const batches: string[][] = [];
      for (let i = 0; i < unique.length; i += batchSize) {
        batches.push(unique.slice(i, i + batchSize));
      }

      const batchResults = await mapWithConcurrency(
        batches,
        (batch) => fetchOneBatch(batch),
        batchConcurrency
      );

      for (let b = 0; b < batches.length; b += 1) {
        const batch = batches[b];
        const nodes = batchResults[b];
        for (let i = 0; i < batch.length; i += 1) {
          const path = batch[i];
          const node = nodes[i];
          const item = node ? toRemoteItem(node) : null;
          result.set(path, item);
          // Side-effect: seed the path → itemId cache used by the
          // recipe executor's `ensurePathExists` and parent-resolution
          // fast paths. Skips writing nulls — `null` means "checked
          // and missing", and ensurePathExists distinguishes "not
          // cached" (must check) from "cached as missing" by re-reading
          // anyway when it auto-creates.
          if (item && pathItemIdCache && !pathItemIdCache.has(path)) {
            pathItemIdCache.set(path, item.itemId);
          }
        }
      }

      // Re-emit caller-input keys (caller may have passed dupes — same
      // value mapping back applies).
      for (const p of paths) {
        if (!result.has(p)) {
          // Should not happen given the loop above + de-dupe, but defend.
          result.set(p, null);
        }
      }
      return result;
    },

    async getChildren(parent, _options?: GetItemOptions): Promise<RemoteItem[]> {
      const nodes = await fetchChildren(parent);
      return nodes.map(toRemoteItem);
    },

    async createItem(input: CreateItemInput): Promise<CreateItemResult> {
      const parentItemId = await resolveParentItemId(input.parent);
      // Optional pre-create idempotency check. The planner reads
      // existence via `getItem({path})`, which hits Sitecore's path
      // index — that index lags writes by seconds-to-minutes. On a
      // rapid second push, the planner can see "missing" and plan a
      // create against a path the tenant actually already has.
      // Parent-child storage is not lag-prone, so `findChildByName`
      // here is authoritative: if the sibling exists, return its
      // itemId without ever calling the mutation. Catches the case
      // where Sitecore's create-mutation does NOT reject the duplicate
      // (observed in the field — `audit slug-conflicts` kept catching
      // duplicates that should have been upserts on rapid re-push).
      //
      // Opt-in via `idempotencyCheck: true` because it adds one
      // parent-children read per CreateItem op — recipe push opts in
      // (idempotency is the whole point), one-shot callers that
      // explicitly asked to create skip the check.
      if (input.idempotencyCheck) {
        const preExisting = await findChildByName(parentItemId, input.name);
        if (preExisting) {
          return adoptExistingChild(input, preExisting);
        }
      }
      try {
        const data = await runAuthoringGraphQL<GraphQLCreateItemResponse>(
          environment,
          CREATE_ITEM_MUTATION,
          {
            input: {
              parent: parentItemId,
              templateId: input.templateId,
              name: input.name,
              database: input.database ?? "master",
              language: input.language ?? "en",
              fields: toAuthoringFieldsInput(input.fields),
            },
          },
          writeRequest
        );
        const itemId = data.createItem?.item?.itemId;
        if (!itemId) {
          throw createScaiError(
            "createItem returned no itemId — Authoring API response was malformed.",
            "UNKNOWN"
          );
        }
        return { itemId };
      } catch (error) {
        // Idempotent-create fallback for the recurring "name already defined
        // on this level" failure mode. Sitecore's path index (used by
        // `getItem({path})` and the workspace prefetch) lags writes by
        // seconds-to-minutes — so a planner that checks-by-path and sees
        // "missing" can plan a create against a path that the tenant
        // actually already has, either from an earlier op in the same
        // push or from a previous push. The parent-child storage is
        // not lag-prone, so we fall through to `getChildren(parent)`
        // to locate the existing item by name and return its itemId
        // as if the create succeeded. The caller's `dispatchMutation`
        // captures it normally; for `CreateOnly` ops this is the
        // intended behavior, for `CreateAndUpdate` we accept that the
        // existing item's fields aren't updated in this push (the
        // next push's prefetch will see the item via path lookup, the
        // planner takes the update branch, and drift gets corrected).
        if (isAlreadyExistsError(error)) {
          const existing = await findChildByName(parentItemId, input.name);
          if (existing) {
            return adoptExistingChild(input, existing);
          }
          // The server insists a same-named sibling exists but the
          // (paginated, case-insensitive) children walk can't see it —
          // surface a precise conflict instead of the raw GraphQL
          // collision so the operator knows exactly which item to
          // inspect and what template the recipe expected.
          const original = error instanceof Error ? error.message : String(error);
          throw createScaiError(
            `createItem '${input.name}' (expected template ${input.templateId}) under parent ` +
              `${parentItemId} was rejected as a duplicate name, but no matching child was ` +
              `found among the parent's children — the existing item could not be adopted. ` +
              `Original error: ${original}`,
            "NETWORK",
            {
              hint:
                "Open the parent item in the Content Editor and inspect its children for the " +
                "conflicting item (it may be protected, orphaned, or in an inconsistent index " +
                "state). Rename or remove it, then re-run the push.",
            }
          );
        }
        throw error;
      }
    },

    async updateItem(input: UpdateItemInput): Promise<void> {
      await updateItemImpl(input);
    },

    async moveItem(input: MoveItemInput): Promise<void> {
      // Both selectors must carry either itemId or path. The Authoring
      // GraphQL `MoveItemInput` accepts the same selector shape on both
      // sides, so we forward verbatim.
      const buildSelector = (sel: ItemSelector, label: string): Record<string, string> => {
        if (sel.itemId) return { itemId: sel.itemId };
        if (sel.path) return { path: sel.path };
        throw createScaiError(`moveItem ${label} requires itemId or path.`, "INPUT_INVALID");
      };
      const wireInput = {
        ...buildSelector(input.selector, "source"),
        // Authoring's `MoveItemInput` names the destination
        // `targetParent` — same wire key as our typed input.
        targetParent: buildSelector(input.targetParent, "targetParent"),
      };
      await runAuthoringGraphQL<{
        moveItem: { item: { itemId: string } | null } | null;
      }>(environment, MOVE_ITEM_MUTATION, { input: wireInput }, writeRequest);
    },

    async deleteItem(selector: ItemSelector): Promise<void> {
      // `permanently: true` skips the recycle bin — rollback and integration
      // cleanup both want full removal. Default-false would leave items
      // discoverable by path under /sitecore/content/Recycle Bin.
      const input: {
        itemId?: string;
        path?: string;
        permanently: boolean;
      } = { permanently: true };
      if (selector.itemId) input.itemId = selector.itemId;
      else if (selector.path) input.path = selector.path;
      else throw createScaiError("deleteItem requires either path or itemId.", "INPUT_INVALID");
      const data = await runAuthoringGraphQL<{
        deleteItem: { successful: boolean } | null;
      }>(environment, DELETE_ITEM_MUTATION, { input }, writeRequest);
      if (!data.deleteItem?.successful) {
        throw createScaiError(
          `deleteItem returned successful: ${data.deleteItem?.successful} for ${
            selector.itemId ?? selector.path ?? "(no selector)"
          }`,
          "UNKNOWN"
        );
      }
    },

    async addItemVersion(input: AddItemVersionInput): Promise<AddItemVersionResult> {
      const data = await runAuthoringGraphQL<{
        addItemVersion: { item: { version: number } | null } | null;
      }>(
        environment,
        ADD_ITEM_VERSION_MUTATION,
        { input: { itemId: input.itemId, language: input.language } },
        writeRequest
      );
      const version = data.addItemVersion?.item?.version;
      if (typeof version !== "number") {
        throw createScaiError(
          "addItemVersion returned no version — Authoring API response was malformed.",
          "UNKNOWN"
        );
      }
      return { version };
    },

    async getItemVersions(selector: ItemSelector, language: string): Promise<number[]> {
      type VersionsResponse = { item: { versions: Array<{ version: number }> } | null };
      let data: VersionsResponse;
      if (selector.itemId) {
        data = await runAuthoringGraphQL<VersionsResponse>(
          environment,
          GET_ITEM_VERSIONS_BY_ID,
          { itemId: selector.itemId, language },
          readRequest
        );
      } else if (selector.path) {
        data = await runAuthoringGraphQL<VersionsResponse>(
          environment,
          GET_ITEM_VERSIONS_BY_PATH,
          { path: selector.path, language },
          readRequest
        );
      } else {
        throw createScaiError("getItemVersions requires either path or itemId.", "INPUT_INVALID");
      }
      return (data.item?.versions ?? [])
        .map((v) => v.version)
        .filter((v): v is number => typeof v === "number")
        .sort((a, b) => a - b);
    },

    async getItemPerLanguageBatch(
      selector: ItemSelector,
      languages: readonly string[]
    ): Promise<Array<{ language: string; versions: number[]; item: RemoteItem | null }>> {
      if (languages.length === 0) return [];
      // Aliased GraphQL: one round trip queries the item at each
      // language's latest version, including the version stack and
      // ITEM_FRAGMENT fields. Aliases are stable per call so the
      // response maps cleanly back to each input language.
      const isById = !!selector.itemId;
      if (!isById && !selector.path) {
        throw createScaiError(
          "getItemPerLanguageBatch requires either path or itemId.",
          "INPUT_INVALID"
        );
      }
      const lookupVar = isById ? "$itemId: ID!" : "$path: String!";
      const lookupClause = isById ? "itemId: $itemId" : "path: $path";
      const variableDecls = [lookupVar, ...languages.map((_, i) => `$lang${i}: String!`)].join(
        ", "
      );
      const aliasedSelections = languages
        .map(
          (_, i) => `
  lang${i}: item(where: { ${lookupClause}, language: $lang${i} }) {
    ${ITEM_FRAGMENT}
    versions { version }
  }`
        )
        .join("");
      const query = `query Batch(${variableDecls}) {${aliasedSelections}\n}`;
      const variables: Record<string, string> = isById
        ? { itemId: selector.itemId! }
        : { path: selector.path! };
      for (let i = 0; i < languages.length; i += 1) {
        variables[`lang${i}`] = languages[i];
      }
      type LangNode = (RemoteItemNode & { versions?: Array<{ version: number }> }) | null;
      const data = await runAuthoringGraphQL<Record<string, LangNode>>(
        environment,
        query,
        variables,
        readRequest
      );
      return languages.map((language, i) => {
        const node = data[`lang${i}`];
        if (!node) return { language, versions: [], item: null };
        const versions = (node.versions ?? [])
          .map((v) => v.version)
          .filter((v): v is number => typeof v === "number")
          .sort((a, b) => a - b);
        // Items with no version in this language return
        // `versions: []` — treat as "not authored in this language"
        // and skip the toRemoteItem call. (The fields null-guard now
        // lives in toRemoteItem itself, so the call would be safe
        // either way, but skipping avoids a degenerate item return.)
        if (versions.length === 0) return { language, versions, item: null };
        return { language, versions, item: toRemoteItem(node) };
      });
    },

    async getItemAtVersionsBatch(
      selector: ItemSelector,
      requests: ReadonlyArray<{ language: string; version: number }>
    ): Promise<Array<RemoteItem | null>> {
      if (requests.length === 0) return [];
      const isById = !!selector.itemId;
      if (!isById && !selector.path) {
        throw createScaiError(
          "getItemAtVersionsBatch requires either path or itemId.",
          "INPUT_INVALID"
        );
      }
      const lookupVar = isById ? "$itemId: ID!" : "$path: String!";
      const lookupClause = isById ? "itemId: $itemId" : "path: $path";
      const variableDecls = [
        lookupVar,
        ...requests.flatMap((_, i) => [`$lang${i}: String!`, `$ver${i}: Int!`]),
      ].join(", ");
      const aliasedSelections = requests
        .map(
          (_, i) => `
  r${i}: item(where: { ${lookupClause}, language: $lang${i}, version: $ver${i} }) {
    ${ITEM_FRAGMENT}
  }`
        )
        .join("");
      const query = `query Batch(${variableDecls}) {${aliasedSelections}\n}`;
      const variables: Record<string, string | number> = isById
        ? { itemId: selector.itemId! }
        : { path: selector.path! };
      for (let i = 0; i < requests.length; i += 1) {
        variables[`lang${i}`] = requests[i].language;
        variables[`ver${i}`] = requests[i].version;
      }
      const data = await runAuthoringGraphQL<Record<string, RemoteItemNode | null>>(
        environment,
        query,
        variables,
        readRequest
      );
      return requests.map((_, i) => {
        const node = data[`r${i}`];
        return node ? toRemoteItem(node) : null;
      });
    },

    async uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
      // Step 1: presign. The `uploadMedia` mutation accepts an `itemPath`
      // relative to `/sitecore/media library` (no prefix, no extension —
      // Sitecore's `InvalidItemNameChars` rejects `.`/`/` in item names;
      // file extension is stored on the underlying Blob field, not the
      // item name). Intermediate folders are auto-created.
      const presignResponse = await runAuthoringGraphQL<{
        uploadMedia: { presignedUploadUrl: string } | null;
      }>(
        environment,
        UPLOAD_MEDIA_MUTATION,
        {
          input: {
            itemPath: input.itemPath,
            ...(input.alt !== undefined && { alt: input.alt }),
            overwriteExisting: input.overwriteExisting ?? true,
          },
        },
        writeRequest
      );
      const presignedUrl = presignResponse.uploadMedia?.presignedUploadUrl;
      if (!presignedUrl) {
        throw createScaiError(
          `uploadMedia returned no presignedUploadUrl for itemPath '${input.itemPath}'.`,
          "UNKNOWN"
        );
      }

      // Step 2: POST multipart bytes to the presigned URL. The presigned
      // URL still requires the Bearer token (verified 2026-06-06 against
      // TestDemo — unauthenticated POSTs return a 200 with an OAuth
      // login HTML body, NOT an upload). The response body is JSON
      // `{Id, Name, ItemPath}` on success.
      const token = await getAccessToken(environment);
      const form = new FormData();
      // Sitecore derives the media item's `Extension` AND `Mime Type` fields
      // from the multipart file — NOT from the item name or the mutation input.
      // A missing extension (an `external-url` tail with none, or the `"media"`
      // fallback) leaves `Extension` empty and the blob won't render; a junk
      // `Content-Type` forwarded from a CDN produces a bizarre `Mime Type`.
      // `resolveMediaUpload` guarantees a filename extension and a canonical
      // image MIME type derived from it. See `media-filename.ts`.
      const { fileName, mimeType } = resolveMediaUpload(
        input.fileName ?? "media",
        input.mimeType ?? "image/png"
      );
      const blob = new Blob([new Uint8Array(input.bytes)], { type: mimeType });
      form.append("file", blob, fileName);
      const uploadResponse = await fetch(presignedUrl, {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!uploadResponse.ok) {
        const detail = await uploadResponse.text().catch(() => "");
        throw createScaiError(
          `uploadMedia presigned POST failed (${uploadResponse.status}): ${detail.substring(0, 200)}`,
          "UNKNOWN"
        );
      }
      const responseText = await uploadResponse.text();
      let parsed: { Id?: string; Name?: string; ItemPath?: string };
      try {
        parsed = JSON.parse(responseText) as typeof parsed;
      } catch {
        throw createScaiError(
          `uploadMedia presigned POST returned non-JSON body (likely auth challenge): ${responseText.substring(0, 200)}`,
          "UNKNOWN"
        );
      }
      if (!parsed.Id) {
        throw createScaiError(
          `uploadMedia presigned POST response missing Id: ${responseText.substring(0, 200)}`,
          "UNKNOWN"
        );
      }
      return {
        itemId: parsed.Id,
        itemPath: parsed.ItemPath ?? input.itemPath,
        name: parsed.Name ?? input.itemPath.split("/").pop() ?? "",
      };
    },

    async getTenantLanguages(): Promise<string[]> {
      // Return the cached promise on repeat calls so concurrent callers
      // share one in-flight request (the common case: planPruneChildren
      // calls this once per `recipe push` and threads it into the
      // snapshot pass for every pruned item).
      if (tenantLanguagesCache) return tenantLanguagesCache;
      type LanguagesResponse = { languages: { nodes: Array<{ name: string }> } | null };
      tenantLanguagesCache = (async () => {
        try {
          const data = await runAuthoringGraphQL<LanguagesResponse>(
            environment,
            GET_TENANT_LANGUAGES,
            {},
            readRequest
          );
          const langs = (data.languages?.nodes ?? [])
            .map((l) => l.name)
            .filter((name): name is string => typeof name === "string" && name.length > 0);
          // Always include "en" as a safety net — tenants without any
          // explicit language config still need a default for the
          // inverse createItem path. Dedup if "en" is already present.
          const withDefault = langs.includes("en") ? langs : ["en", ...langs];
          return withDefault.length > 0 ? withDefault : ["en"];
        } catch {
          // Best-effort: any failure falls back to the safe default.
          // The caller (planPruneChildren) treats this the same as a
          // single-language tenant.
          return ["en"];
        }
      })();
      return tenantLanguagesCache;
    },
  };
};

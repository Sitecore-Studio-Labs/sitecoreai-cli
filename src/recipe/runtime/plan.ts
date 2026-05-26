import type {
  AddItemVersionOp,
  AppendToMultiListOp,
  CreateItemOp,
  CreateSiteFromTemplateOp,
  FieldValue,
  Operation,
  OperationIr,
  PushPolicy,
  RefValue,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "../ir/operations";
import { LAYOUT_FIELDS, SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { SCAI_HANDLE_FIELD_NAME } from "../items/marker";
import { templatePathRefKey } from "../items/guids";
import { renderRefValue, resolveRecipeRefs } from "../api/ref-encoding";
import { layoutXmlEquivalent } from "../layout/parse";
import type {
  AuthoringApiClient,
  CreateItemInput,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "../api/client";
import type { NewSiteInput, SitesApiClient } from "../api/sites-client";

/**
 * `scai provision recipe plan` and `scai provision recipe push` share this read-then-diff path:
 *
 *   for each op:
 *     resolve the target item (path-based for CreateItem, captured-id
 *       based for update-style ops)
 *     read remote state; diff against IR
 *     emit mutation per policy (create / update / skip / error)
 *
 * Sitecore's Authoring API server-assigns itemIds on `createItem`. The
 * IR carries deterministic uuidv5 refKeys (recipe-internal) plus
 * Sitecore paths (deterministic from recipe + envProfile roots). On each
 * push, the executor maintains a per-run `capturedItemIds: Map<refKey,
 * sitecoreItemId>` populated from `getItem(by path)` and `createItem`
 * responses. Subsequent ops resolve their target by refKey → captured
 * itemId, and `ref-recipe` field values resolve through the same map.
 */

export interface FieldDiffEntry {
  fieldId: string;
  before: string | null;
  after: string;
  language?: string;
  version?: number;
}

type ActionStatus = "create" | "update" | "skip" | "error";

export interface PlannedAction {
  index: number;
  operation: Operation;
  status: ActionStatus;
  reason?: string;
  diff?: FieldDiffEntry[];
  /** Snapshot of the mutation the executor will/would dispatch. */
  mutation?:
    | { kind: "createItem"; input: CreateItemInput }
    | { kind: "updateItem"; input: UpdateItemInput }
    | {
        kind: "createSite";
        input: NewSiteInput;
        /**
         * RefKey of the site item — the executor stores the
         * server-assigned site itemId here in `capturedItemIds` so
         * subsequent SetField ops scoped to the site (dictionary
         * overrides etc.) can resolve.
         */
        siteRefKey: string;
      }
    | {
        kind: "addItemVersion";
        /** Sitecore itemId of the target item. */
        itemId: string;
        /** Language whose numbered-version stack to extend. */
        language: string;
        /** How many versions to add to reach the op's declared `version`. */
        addCount: number;
      };
  /**
   * Pre-mutation remote state captured during plan-time read. `null` means
   * the target item did not exist at plan time. Used by rollback to
   * derive inverse mutations.
   */
  snapshot?: RemoteItem | null;
}

export interface PlanSummary {
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface Plan {
  schemaVersion: "1";
  recipeHandle: string;
  actions: PlannedAction[];
  summary: PlanSummary;
}

export type PlanEvent =
  | { kind: "op-start"; index: number; operation: Operation }
  | { kind: "op-result"; action: PlannedAction }
  | { kind: "op-error"; index: number; operation: Operation; error: string };

export interface PlanOptions {
  emit?: (event: PlanEvent) => void;
  /**
   * Per-run map from recipe-internal refKey (uuidv5) to Sitecore-assigned
   * itemId. The executor passes a shared map and updates it as creates
   * resolve. Plan mode passes a fresh map; refs that don't resolve
   * during plan-mode produce `skip` actions.
   */
  capturedItemIds?: Map<string, string>;
  /**
   * Sites API client — only consulted when an IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets that don't include
   * SiteRecipes don't need a sites client; passing undefined is fine
   * and yields an `error` action only if a site op is encountered.
   */
  sitesClient?: SitesApiClient;
  /**
   * Workspace-wide path → RemoteItem snapshot cache. When provided,
   * `buildAction` consults it before issuing `client.getItem({ path })`
   * for CreateItem ops. Cache hits skip the wire call entirely.
   */
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * Workspace-wide path → itemId cache (shared with the AuthoringApiClient).
   * Threaded so `buildAction` can populate it after a successful read,
   * and so the planner sees same path resolutions a sibling recipe
   * already made earlier in the push.
   */
  pathItemIdCache?: Map<string, string>;
}

const lookupField = (
  remote: RemoteItem,
  fieldId: string,
  fieldName: string | undefined,
  language: string | undefined,
  version: number | undefined
): RemoteFieldValue | undefined =>
  remote.fields.find((f) => {
    // Match by name when the IR carries one — recipe-created field GUIDs
    // are IR-internal refKeys that don't match the tenant's actual GUIDs,
    // so name is the only reliable selector. Else match by GUID (system
    // fields' GUIDs are real Sitecore built-ins).
    const idMatches = fieldName
      ? f.name === fieldName
      : f.fieldId.toLowerCase() === fieldId.toLowerCase();
    return (
      idMatches &&
      // Sitecore Authoring GraphQL doesn't return per-field language/version
      // on the basic `Item.fields` query — `f.language`/`f.version` are
      // typically undefined. Match only when the recipe's filter is also
      // undefined or when the API DID return them (custom integrations).
      (language === undefined || f.language === undefined || f.language === language) &&
      (version === undefined || f.version === undefined || f.version === version)
    );
  });

/** Resolve every recipe-ref / source-prefix in a field value list. */
const resolveAll = (
  fields: FieldValue[],
  capturedItemIds: ReadonlyMap<string, string>
): FieldValue[] =>
  fields.map((field) => ({
    ...field,
    value: resolveRecipeRefs(field.value, capturedItemIds),
  }));

/**
 * Build an `UpdateItemInput`, lifting a uniform field `language` / `version`
 * to the input level. The Authoring API writes every `FieldValueInput` at
 * the input's language/version — per-field language/version is not on the
 * wire — so a `SetField` targeting a non-default language or a story-seed
 * numbered version must surface it here. When the fields disagree (or carry
 * none) the level is left unset and the write lands on the item's default
 * language / latest version.
 */
const toUpdateItemInput = (itemId: string, fields: FieldValue[]): UpdateItemInput => {
  const input: UpdateItemInput = { itemId, fields };
  const languages = new Set(fields.map((field) => field.language));
  if (languages.size === 1 && fields[0]?.language !== undefined) {
    input.language = fields[0].language;
  }
  const versions = new Set(fields.map((field) => field.version));
  if (versions.size === 1 && fields[0]?.version !== undefined) {
    input.version = fields[0].version;
  }
  return input;
};

const computeFieldDrift = (
  desired: FieldValue[],
  remote: RemoteItem,
  capturedItemIds: ReadonlyMap<string, string>
): FieldDiffEntry[] => {
  const drift: FieldDiffEntry[] = [];
  for (const field of desired) {
    const resolvedValue: RefValue = resolveRecipeRefs(field.value, capturedItemIds);
    const want = renderRefValue(resolvedValue);
    const found = lookupField(
      remote,
      field.fieldId,
      field.fieldName,
      field.language,
      field.version
    );
    if (!found) {
      drift.push({
        fieldId: field.fieldId,
        before: null,
        after: want,
        language: field.language,
        version: field.version,
      });
      continue;
    }
    // Layout fields (`__Renderings` / `__Final Renderings`) carry XML
    // that Sitecore's layout pipeline normalises on write (canonical →
    // SXA delta, plus baseline `<p:da>` directives). A raw string
    // compare would report a phantom update on every re-push, so diff
    // them structurally — same placements ⇒ no drift.
    const isLayoutField =
      field.fieldId === LAYOUT_FIELDS.RENDERINGS ||
      field.fieldId === LAYOUT_FIELDS.FINAL_RENDERINGS;
    const equal = isLayoutField ? layoutXmlEquivalent(found.value, want) : found.value === want;
    if (!equal) {
      drift.push({
        fieldId: field.fieldId,
        before: found.value,
        after: want,
        language: field.language,
        version: field.version,
      });
    }
  }
  return drift;
};

/**
 * Resolve a CreateItem op's parent ref to a Sitecore itemId.
 *
 * Sitecore's `createItem` requires `parent: ID!` (a GUID). Path-only
 * parents (`ref-path`) are looked up via `getItem({ path })` and cached
 * in `capturedItemIds` keyed by the path string itself. Recipe-internal
 * `ref-recipe` parents resolve via the same map keyed by their refKey,
 * populated as parent ops apply.
 *
 * Returns `unresolvedRefKey` only when a `ref-recipe` parent's CreateItem
 * has not yet captured an itemId (plan-mode against an empty tenant
 * before applies happen).
 */
const resolveCreateItemParent = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): { resolved: string } | { unresolvedRefKey: string } => {
  if (op.parent.kind === "ref-path") {
    const cached = capturedItemIds.get(op.parent.value);
    if (cached) return { resolved: cached };
    // Plan-mode fallback when the path lookup returned null (tenant
    // doesn't have it yet, or we're testing without a live tenant).
    return { resolved: op.parent.value };
  }
  const itemId = capturedItemIds.get(op.parent.refKey);
  if (itemId) {
    return { resolved: itemId };
  }
  // Plan-mode preview fallback: when the parent's CreateItem hasn't run
  // yet (captured map empty), derive the parent path from op.path. Apply-
  // mode normally fills the captured map before children dispatch, so this
  // branch is mostly for `recipe plan` output.
  const trail = `/${op.name}`;
  if (op.path.endsWith(trail)) {
    const parentPath = op.path.slice(0, -trail.length);
    if (parentPath) {
      return { resolved: parentPath };
    }
  }
  return { unresolvedRefKey: op.parent.refKey };
};

/**
 * Strict variant of parent resolution for the plan-time sibling-name
 * fallback. Unlike `resolveCreateItemParent` (which has plan-mode-friendly
 * path-string fallbacks), this returns an itemId ONLY when one is
 * actually in the captured map — so the caller can safely pass the
 * result to `getChildren({ itemId })` without risk of feeding it a path.
 */
const resolveParentItemIdForFallback = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): string | null => {
  const candidate =
    op.parent.kind === "ref-path"
      ? capturedItemIds.get(op.parent.value)
      : capturedItemIds.get(op.parent.refKey);
  if (!candidate) return null;
  if (candidate.startsWith("/")) return null;
  return candidate;
};

/**
 * The `Scai Handle` recipe-identity marker `injectHandleMarker` stamped on a
 * CreateItem op, or `undefined` for an op that carries none (e.g. an IR that
 * never went through `injectHandleMarker`).
 */
const opHandleMarker = (op: CreateItemOp): string | undefined => {
  const field = op.fields.find(
    (f) => (f.fieldName ?? "").toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase()
  );
  return field && field.value.kind === "string" ? field.value.value : undefined;
};

/** The `Scai Handle` marker value on a live item, or `undefined` when unmarked. */
const remoteHandleMarker = (item: RemoteItem): string | undefined =>
  item.fields.find((f) => (f.name ?? "").toLowerCase() === SCAI_HANDLE_FIELD_NAME.toLowerCase())
    ?.value;

/**
 * Resolve a CreateItem op's templateOf to a Sitecore item ID.
 *
 *   - String form: usually a constant Sitecore built-in GUID. If it
 *     matches a refKey captured during this push (e.g. SV item under
 *     a recipe-created template), resolve to the captured itemId.
 *   - `{kind: "ref-path"}` form: late-resolved against a content-tree
 *     path. The push pipeline seeds `crossRecipeRefs[templatePathRefKey(path)] = path`;
 *     the executor's `getItemsByPaths` batch lookup populates
 *     `capturedItemIds` before planning starts. A miss here means the
 *     template item doesn't exist on the tenant — planner skips with a
 *     clear reason rather than letting the upstream createItem throw.
 */
const resolveTemplateOf = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): { resolved: string } | { unresolvedRefKey: string; reason?: string } => {
  if (typeof op.templateOf === "string") {
    // If templateOf matches a refKey in our captured map, resolve it.
    // Otherwise it's a known Sitecore built-in GUID and we use as-is.
    const captured = capturedItemIds.get(op.templateOf);
    if (captured) {
      return { resolved: captured };
    }
    // Known Sitecore built-in (Template, Section, Field, Folder, Rendering, etc.).
    return { resolved: op.templateOf };
  }
  // ref-path: resolve via the seed map.
  const refKey = templatePathRefKey(op.templateOf.value);
  const captured = capturedItemIds.get(refKey);
  if (captured) return { resolved: captured };
  return {
    unresolvedRefKey: refKey,
    reason: `templateOf path '${op.templateOf.value}' did not resolve. The template item is missing from the tenant or the path is wrong — verify the template exists.`,
  };
};

const planCreateItem = (
  op: CreateItemOp,
  remote: RemoteItem | null,
  index: number,
  capturedItemIds: ReadonlyMap<string, string>
): PlannedAction => {
  if (!remote) {
    const parent = resolveCreateItemParent(op, capturedItemIds);
    if ("unresolvedRefKey" in parent) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: `Parent ref ${parent.unresolvedRefKey} not yet captured (parent's CreateItem hasn't run).`,
      };
    }
    const tpl = resolveTemplateOf(op, capturedItemIds);
    if ("unresolvedRefKey" in tpl) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: tpl.reason ?? `templateOf ref ${tpl.unresolvedRefKey} not yet captured.`,
      };
    }
    // Plan-mode preview tolerates unresolved field refs: we report status
    // create, but omit the mutation snapshot until apply-mode actually
    // captures the dependent itemIds. Apply-mode populates the captured
    // map as it goes, so by the time a child op runs its parents' refs
    // are present and resolveAll succeeds.
    let resolvedFields: FieldValue[];
    try {
      resolvedFields = resolveAll(op.fields, capturedItemIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        index,
        operation: op,
        status: "create",
        reason: `Plan preview: ${message}`,
      };
    }
    return {
      index,
      operation: op,
      status: "create",
      mutation: {
        kind: "createItem",
        input: {
          parent: parent.resolved,
          templateId: tpl.resolved,
          name: op.name,
          fields: resolvedFields,
          // The planner reads existence via the path index, which lags
          // writes by seconds-to-minutes. On a rapid second push the
          // planner can see "missing" and plan a create against a path
          // the tenant already has — request an authoritative
          // parent-children pre-check at apply time to prevent
          // duplicate-sibling creation (the root cause of the
          // `audit slug-conflicts` false positives after re-push).
          idempotencyCheck: true,
        },
      },
    };
  }
  if (op.policy === "CreateOnly") {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item already exists and policy is CreateOnly.",
    };
  }
  const drift = computeFieldDrift(op.fields, remote, capturedItemIds);
  if (drift.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Item exists and all tracked fields match.",
    };
  }
  const driftedSet = new Set(
    drift.map((d) => `${d.fieldId}:${d.language ?? ""}:${d.version ?? ""}`)
  );
  const fieldsToSet = resolveAll(
    op.fields.filter((f) => driftedSet.has(`${f.fieldId}:${f.language ?? ""}:${f.version ?? ""}`)),
    capturedItemIds
  );
  return {
    index,
    operation: op,
    status: "update",
    diff: drift,
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, fieldsToSet),
    },
  };
};

const planUpdateOp = (
  index: number,
  op: SetFieldOp | SetBaseTemplatesOp | SetStandardValuesOp,
  itemRefKey: string,
  desiredFields: FieldValue[],
  policy: PushPolicy,
  remote: RemoteItem | null,
  capturedItemIds: ReadonlyMap<string, string>
): PlannedAction => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${itemRefKey}) not yet captured/created.`,
    };
  }
  const drift = computeFieldDrift(desiredFields, remote, capturedItemIds);
  if (drift.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "Field already at desired value.",
    };
  }
  if (policy === "CreateOnly") {
    const allBlankBefore = drift.every((d) => d.before === null || d.before === "");
    if (!allBlankBefore) {
      return {
        index,
        operation: op,
        status: "skip",
        reason: "Field already set; CreateOnly policy preserves CMS edits.",
      };
    }
  }
  return {
    index,
    operation: op,
    status: "update",
    diff: drift,
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, resolveAll(desiredFields, capturedItemIds)),
    },
  };
};

const setFieldDesired = (op: SetFieldOp): FieldValue[] => [
  {
    fieldId: op.fieldId,
    fieldName: op.fieldName,
    language: op.language,
    version: op.version,
    value: op.value,
  },
];

const setBaseTemplatesDesired = (op: SetBaseTemplatesOp): FieldValue[] => [
  {
    fieldId: SYSTEM_FIELDS.BASE_TEMPLATE,
    value: { kind: "ref-guid-list", values: op.baseTemplates },
  },
];

const setStandardValuesDesired = (op: SetStandardValuesOp): FieldValue[] => [
  {
    fieldId: SYSTEM_FIELDS.STANDARD_VALUES,
    value: { kind: "ref-recipe", refKey: op.standardValuesRefKey },
  },
];

/**
 * Compute the lookup selector for a given op. CreateItem looks up by
 * path; update-style ops look up by the captured itemId for their target
 * refKey. Returns `null` when the captured map doesn't have the refKey
 * yet — that signals the planner to skip.
 */
const lookupSelector = (
  op: Operation,
  capturedItemIds: ReadonlyMap<string, string>
): ItemSelector | null => {
  if (op.op === "CreateItem") {
    return { path: op.path };
  }
  if (op.op === "CreateSiteFromTemplate") {
    // Site idempotency lookup goes through SitesApiClient.listSites, not
    // Authoring API getItem; planCreateSite handles the lookup itself.
    return null;
  }
  let refKey: string;
  if (op.op === "SetField" || op.op === "SetBaseTemplates") {
    refKey = op.itemRefKey;
  } else if (op.op === "SetStandardValues") {
    refKey = op.templateRefKey;
  } else {
    // AppendToMultiList / AddItemVersion — target item keyed by itemRefKey.
    refKey = op.itemRefKey;
  }
  const itemId = capturedItemIds.get(refKey);
  return itemId ? { itemId } : null;
};

/**
 * Plan a single op against the current remote state. Exposed so the
 * executor's apply mode can interleave plan-and-apply per-op (each op's
 * plan sees the cascading effect of earlier ops' applies — required for
 * idempotency: a second push must see no drift on update-style ops whose
 * targets the first push created).
 *
 * Updates `capturedItemIds` when `getItem(by path)` finds an existing
 * item (so subsequent ops can resolve refs without dispatching).
 *
 * When a `pathSnapshotCache` is provided (workspace prefetch), each
 * `getItem({ path })` call short-circuits to the cached value when the
 * path is already known — `null` means "checked and missing", a
 * `RemoteItem` means "use this snapshot". Non-path lookups (by itemId)
 * still hit the wire.
 */
export const buildAction = async (
  index: number,
  op: Operation,
  client: AuthoringApiClient,
  capturedItemIds: Map<string, string>,
  sitesClient?: SitesApiClient,
  pathSnapshotCache?: Map<string, RemoteItem | null>
): Promise<PlannedAction> => {
  const cachedReadByPath = async (path: string): Promise<RemoteItem | null> => {
    if (pathSnapshotCache?.has(path)) {
      return pathSnapshotCache.get(path) ?? null;
    }
    const remote = await client.getItem({ path });
    pathSnapshotCache?.set(path, remote);
    return remote;
  };

  // Late-path resolution: SetField ops whose target is materialised
  // mid-push (e.g. dictionary phrases under a CreateSiteFromTemplate)
  // carry an optional `latePath`. If the op's itemRefKey isn't yet in
  // the captured map AND a latePath is set, do an on-demand getItem
  // lookup to seed the map BEFORE lookupSelector runs. Without this,
  // lookupSelector sees no captured itemId and the SetField skips
  // with "not yet captured/created" — even though the item exists.
  if (
    (op.op === "SetField" || op.op === "AppendToMultiList") &&
    op.latePath &&
    !capturedItemIds.has(op.itemRefKey)
  ) {
    const lateRemote = await cachedReadByPath(op.latePath);
    if (lateRemote) {
      capturedItemIds.set(op.itemRefKey, lateRemote.itemId);
    }
  }

  const selector = lookupSelector(op, capturedItemIds);
  let remote = await (async (): Promise<RemoteItem | null> => {
    if (!selector) return null;
    if (selector.path) return cachedReadByPath(selector.path);
    return client.getItem(selector);
  })();
  if (op.op === "CreateItem" && remote) {
    capturedItemIds.set(op.id, remote.itemId);
  }
  // For CreateItem with a path-only parent (top-level items like the
  // configured templatesRoot/renderingsRoot), resolve the parent path to
  // its Sitecore-assigned itemId once and cache it on the captured map
  // keyed by path. The Authoring API requires `parent: ID!` (GUID) on
  // createItem; passing a path errors with "String→Guid" conversion.
  if (op.op === "CreateItem" && op.parent.kind === "ref-path") {
    const parentPath = op.parent.value;
    if (!capturedItemIds.has(parentPath)) {
      const parentRemote = await cachedReadByPath(parentPath);
      if (parentRemote) {
        capturedItemIds.set(parentPath, parentRemote.itemId);
      }
    }
  }
  // Sibling fallback for CreateItem against a null-cached path. Two cases
  // both end with the planner finding the live item it would otherwise
  // duplicate:
  //
  //   1. Path-index lag — Sitecore's path index trails writes by
  //      seconds-to-minutes, so a repeat push within that window sees
  //      `getItem({path})` return null for a path the tenant already has.
  //      A name match among the parent's children is the lag-immune fix.
  //   2. Rename — a CMS user renamed the item, so neither the path nor the
  //      sibling NAME matches. The `Scai Handle` marker is identity that
  //      survives a rename: a child still carrying this recipe's handle IS
  //      the item, just renamed. The marker carries the *recipe* handle, so
  //      every item one recipe creates under a shared parent gets the same
  //      marker — the match is trusted only when exactly one sibling
  //      carries it (an unambiguous (parent, handle) pair); >1 falls
  //      through to the name path, never risking a wrong rebind.
  //
  // Without this, the planner schedules a duplicate create — the
  // `createItem` mutation then either errors through the authoring-client's
  // name-conflict trap (best case) or silently produces a duplicate item.
  //
  // `getChildren(parent)` walks the live item tree and is not lag-prone.
  // Gated on parent-itemId-known so we don't pay an extra getChildren round
  // trip on a true first push (where the parent itself is null too).
  if (op.op === "CreateItem" && !remote) {
    const parentItemId = resolveParentItemIdForFallback(op, capturedItemIds);
    if (parentItemId) {
      const siblings = await client.getChildren({ itemId: parentItemId });
      let match = siblings.find((s) => s.name === op.name);
      if (!match) {
        const handle = opHandleMarker(op);
        if (handle !== undefined) {
          const marked = siblings.filter((s) => remoteHandleMarker(s) === handle);
          if (marked.length === 1) match = marked[0];
        }
      }
      if (match) {
        remote = match;
        capturedItemIds.set(op.id, match.itemId);
        pathSnapshotCache?.set(op.path, match);
      }
    }
  }

  const action = await (async (): Promise<PlannedAction> => {
    switch (op.op) {
      case "CreateItem":
        return planCreateItem(op, remote, index, capturedItemIds);
      case "SetField":
        return planUpdateOp(
          index,
          op,
          op.itemRefKey,
          setFieldDesired(op),
          op.policy,
          remote,
          capturedItemIds
        );
      case "SetBaseTemplates":
        return planUpdateOp(
          index,
          op,
          op.itemRefKey,
          setBaseTemplatesDesired(op),
          op.policy,
          remote,
          capturedItemIds
        );
      case "SetStandardValues":
        return planUpdateOp(
          index,
          op,
          op.templateRefKey,
          setStandardValuesDesired(op),
          op.policy,
          remote,
          capturedItemIds
        );
      case "CreateSiteFromTemplate":
        return planCreateSite(index, op, capturedItemIds, sitesClient);
      case "AppendToMultiList":
        return planAppendToMultiList(index, op, remote, capturedItemIds);
      case "AddItemVersion":
        return planAddItemVersion(index, op, remote, client);
    }
  })();
  return { ...action, snapshot: remote };
};

/**
 * Parse a Sitecore multi-list field value (pipe-separated GUIDs, each
 * either bare or curly-wrapped) into a normalised lowercase, no-curly
 * GUID set. Tolerates extra whitespace / empty entries from operator
 * edits.
 */
const parseMultiList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\{|\}$/g, "").toLowerCase());
};

const formatMultiList = (guids: readonly string[]): string =>
  guids.map((g) => `{${g.toUpperCase()}}`).join("|");

/**
 * Plan an `AppendToMultiList` op. Reads the target's current field
 * value, computes the union with the desired values (resolving recipe
 * refs first), and emits an updateItem mutation only when the merge
 * adds something new — otherwise a skip with a clear reason.
 */
const planAppendToMultiList = (
  index: number,
  op: AppendToMultiListOp,
  remote: RemoteItem | null,
  capturedItemIds: ReadonlyMap<string, string>
): PlannedAction => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured — section definition may not exist or path lookup hasn't run.`,
    };
  }

  // Resolve every desired value into a concrete GUID. ref-recipe entries
  // resolve via the captured map; ref-guid entries pass through.
  const desired: string[] = [];
  for (const entry of op.values) {
    if (entry.kind === "ref-guid") {
      desired.push(entry.value.toLowerCase());
    } else {
      const itemId = capturedItemIds.get(entry.refKey);
      if (!itemId) {
        return {
          index,
          operation: op,
          status: "skip",
          reason: `AppendToMultiList: refKey ${entry.refKey} not yet captured — producer recipe hasn't landed.`,
        };
      }
      desired.push(itemId.toLowerCase());
    }
  }

  // Read the current field value — match by name when carried (recipe-
  // defined fields), else by GUID (system fields).
  const found = remote.fields.find((f) => {
    const idMatches = op.fieldName
      ? f.name === op.fieldName
      : f.fieldId.toLowerCase() === op.fieldId.toLowerCase();
    return idMatches;
  });
  const existing = parseMultiList(found?.value ?? null);
  const existingSet = new Set(existing);

  const additions = desired.filter((g) => !existingSet.has(g));
  if (additions.length === 0) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: "All desired values already present in multi-list (merge-unique).",
    };
  }

  const merged = [...existing, ...additions];
  const updatedField: FieldValue = {
    fieldId: op.fieldId,
    ...(op.fieldName !== undefined && { fieldName: op.fieldName }),
    value: { kind: "string", value: formatMultiList(merged) },
  };

  return {
    index,
    operation: op,
    status: "update",
    diff: [
      {
        fieldId: op.fieldId,
        before: found?.value ?? null,
        after: formatMultiList(merged),
      },
    ],
    mutation: {
      kind: "updateItem",
      input: toUpdateItemInput(remote.itemId, [updatedField]),
    },
  };
};

/**
 * Plan an `AddItemVersion` op. Reads the target item's current versions in
 * `op.language` and emits an `addItemVersion` mutation only when the
 * declared `version` doesn't exist yet — so a re-push of a story-seed
 * recipe is an all-`skip` no-op once the version stack is materialised.
 *
 * `addCount` is `op.version - currentMax`: the executor adds that many
 * versions (Sitecore assigns the numbers sequentially). When `language` has
 * no versions yet `currentMax` is 0, and adding version 1 also creates the
 * language version.
 */
const planAddItemVersion = async (
  index: number,
  op: AddItemVersionOp,
  remote: RemoteItem | null,
  client: AuthoringApiClient
): Promise<PlannedAction> => {
  if (!remote) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Target item (refKey ${op.itemRefKey}) not yet captured/created.`,
    };
  }
  const existing = await client.getItemVersions({ itemId: remote.itemId }, op.language);
  const currentMax = existing.length > 0 ? Math.max(...existing) : 0;
  if (currentMax >= op.version) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Version ${op.version} already exists in '${op.language}'.`,
    };
  }
  return {
    index,
    operation: op,
    status: "create",
    mutation: {
      kind: "addItemVersion",
      itemId: remote.itemId,
      language: op.language,
      addCount: op.version - currentMax,
    },
  };
};

/**
 * Plan a `CreateSiteFromTemplate` op. Idempotency lookup goes through
 * `SitesApiClient.listSites` (filter by name) — the Sites API doesn't
 * resolve site instances by Sitecore content-tree path the way Authoring
 * API does for items.
 *
 * Outcomes:
 *   - sitesClient missing → status: error (executor was not threaded one)
 *   - templateRefKey not yet captured → status: skip (the SiteTemplate
 *     hasn't been pushed; cross-recipe ref pre-seeding will pick it up
 *     on the next push)
 *   - site already exists with the same name → status: skip; capture
 *     the existing site's itemId so subsequent SetField overrides resolve
 *   - site doesn't exist → status: create; mutation `createSite` carries
 *     a fully-resolved NewSiteInput plus the op's siteRefKey
 *
 * "Already exists with a different template" is NOT detected here —
 * Sites API doesn't expose a clean way to read a site's template
 * back. If a same-named site references a different template, the
 * push silently treats it as "skip"; operators must delete and re-push
 * to switch templates. Tracked as a follow-up.
 */
const planCreateSite = async (
  index: number,
  op: CreateSiteFromTemplateOp,
  capturedItemIds: Map<string, string>,
  sitesClient: SitesApiClient | undefined
): Promise<PlannedAction> => {
  if (!sitesClient) {
    return {
      index,
      operation: op,
      status: "error",
      reason:
        "CreateSiteFromTemplate requires a SitesApiClient — none was provided to the executor.",
    };
  }
  const templateId = capturedItemIds.get(op.templateRefKey);
  if (!templateId) {
    return {
      index,
      operation: op,
      status: "skip",
      reason: `siteTemplate refKey ${op.templateRefKey} not yet captured (push the SiteTemplate first or via cross-recipe ref).`,
    };
  }
  const sites = await sitesClient.listSites();
  const existing = sites.find((s) => s.name === op.siteName);
  if (existing?.id) {
    capturedItemIds.set(op.siteRefKey, existing.id);
    return {
      index,
      operation: op,
      status: "skip",
      reason: `Site '${op.siteName}' already exists.`,
    };
  }
  const input: NewSiteInput = {
    siteName: op.siteName,
    templateId,
    language: op.language,
    ...(op.displayName !== undefined && { displayName: op.displayName }),
    ...(op.description !== undefined && { description: op.description }),
    ...(op.hostName !== undefined && { hostName: op.hostName }),
    ...(op.collectionId !== undefined && { collectionId: op.collectionId }),
    ...(op.collectionName !== undefined && { collectionName: op.collectionName }),
    ...(op.collectionDisplayName !== undefined && {
      collectionDisplayName: op.collectionDisplayName,
    }),
    ...(op.collectionDescription !== undefined && {
      collectionDescription: op.collectionDescription,
    }),
  };
  return {
    index,
    operation: op,
    status: "create",
    mutation: { kind: "createSite", input, siteRefKey: op.siteRefKey },
  };
};

export const buildPlan = async (
  ir: OperationIr,
  client: AuthoringApiClient,
  options: PlanOptions = {}
): Promise<Plan> => {
  const actions: PlannedAction[] = [];
  const summary: PlanSummary = { create: 0, update: 0, skip: 0, error: 0 };
  const capturedItemIds = options.capturedItemIds ?? new Map<string, string>();

  for (let index = 0; index < ir.operations.length; index += 1) {
    const op = ir.operations[index];
    options.emit?.({ kind: "op-start", index, operation: op });
    let action: PlannedAction;
    try {
      action = await buildAction(
        index,
        op,
        client,
        capturedItemIds,
        options.sitesClient,
        options.pathSnapshotCache
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      action = {
        index,
        operation: op,
        status: "error",
        reason: message,
      };
      options.emit?.({ kind: "op-error", index, operation: op, error: message });
    }
    summary[action.status] += 1;
    actions.push(action);
    options.emit?.({ kind: "op-result", action });
  }

  return {
    schemaVersion: "1",
    recipeHandle: ir.recipeHandle,
    actions,
    summary,
  };
};

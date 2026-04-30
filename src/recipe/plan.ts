import type {
  CreateItemOp,
  FieldValue,
  Operation,
  OperationIr,
  PushPolicy,
  RefValue,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "./ir/operations";
import { SYSTEM_FIELDS } from "./ir/sitecore-templates";
import { renderRefValue, resolveRecipeRefs } from "./api/ref-encoding";
import type {
  AuthoringApiClient,
  CreateItemInput,
  ItemSelector,
  RemoteFieldValue,
  RemoteItem,
  UpdateItemInput,
} from "./api/client";

/**
 * `scai recipe plan` and `scai recipe push` share this read-then-diff path:
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
    | { kind: "updateItem"; input: UpdateItemInput };
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
}

const lookupField = (
  remote: RemoteItem,
  fieldId: string,
  language?: string,
  version?: number
): RemoteFieldValue | undefined =>
  remote.fields.find(
    (f) =>
      f.fieldId.toLowerCase() === fieldId.toLowerCase() &&
      // Sitecore Authoring GraphQL doesn't return per-field language/version
      // on the basic `Item.fields` query — `f.language`/`f.version` are
      // typically undefined. Match only when the recipe's filter is also
      // undefined or when the API DID return them (custom integrations).
      (language === undefined || f.language === undefined || f.language === language) &&
      (version === undefined || f.version === undefined || f.version === version)
  );

/** Resolve every recipe-ref / source-prefix in a field value list. */
const resolveAll = (
  fields: FieldValue[],
  capturedItemIds: ReadonlyMap<string, string>
): FieldValue[] =>
  fields.map((field) => ({
    ...field,
    value: resolveRecipeRefs(field.value, capturedItemIds),
  }));

const computeFieldDrift = (
  desired: FieldValue[],
  remote: RemoteItem,
  capturedItemIds: ReadonlyMap<string, string>
): FieldDiffEntry[] => {
  const drift: FieldDiffEntry[] = [];
  for (const field of desired) {
    const resolvedValue: RefValue = resolveRecipeRefs(field.value, capturedItemIds);
    const want = renderRefValue(resolvedValue);
    const found = lookupField(remote, field.fieldId, field.language, field.version);
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
    if (found.value !== want) {
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

/** Resolve a CreateItem op's templateOf — usually a constant Sitecore GUID,
 *  but the SV item case has it as the recipe's own template refKey. */
const resolveTemplateOf = (
  op: CreateItemOp,
  capturedItemIds: ReadonlyMap<string, string>
): { resolved: string } | { unresolvedRefKey: string } => {
  // If templateOf matches a refKey in our captured map, resolve it.
  // Otherwise it's a known Sitecore built-in GUID and we use as-is.
  const captured = capturedItemIds.get(op.templateOf);
  if (captured) {
    return { resolved: captured };
  }
  // Known Sitecore built-in (Template, Section, Field, Folder, Rendering, etc.).
  return { resolved: op.templateOf };
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
        reason: `templateOf ref ${tpl.unresolvedRefKey} not yet captured.`,
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
      input: { itemId: remote.itemId, fields: fieldsToSet },
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
      input: {
        itemId: remote.itemId,
        fields: resolveAll(desiredFields, capturedItemIds),
      },
    },
  };
};

const setFieldDesired = (op: SetFieldOp): FieldValue[] => [
  {
    fieldId: op.fieldId,
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
  const refKey =
    op.op === "SetField" || op.op === "SetBaseTemplates" ? op.itemRefKey : op.templateRefKey;
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
 */
export const buildAction = async (
  index: number,
  op: Operation,
  client: AuthoringApiClient,
  capturedItemIds: Map<string, string>
): Promise<PlannedAction> => {
  const selector = lookupSelector(op, capturedItemIds);
  const remote = selector ? await client.getItem(selector) : null;
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
      const parentRemote = await client.getItem({ path: parentPath });
      if (parentRemote) {
        capturedItemIds.set(parentPath, parentRemote.itemId);
      }
    }
  }

  const action = (() => {
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
    }
  })();
  return { ...action, snapshot: remote };
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
      action = await buildAction(index, op, client, capturedItemIds);
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

import type { AuthoringApiClient, RemoteItem, UpdateItemInput } from "./api/client";
import type { FieldValue } from "./ir/operations";
import type { PlannedAction } from "./plan";

/**
 * Best-effort rollback for partial recipe pushes.
 *
 * When the executor's apply phase errors mid-IR, ops that already landed
 * are still on the tenant. The rollback module unwinds them in LIFO order
 * (reverse of the apply order, which mirrors topological order) using the
 * pre-mutation snapshot each op captured at plan time:
 *
 *   - applied `createItem` (snapshot was null) → `deleteItem(itemId)`
 *   - applied `updateItem` → `updateItem` with the prior value of each
 *     touched field, or empty string when the field was unset
 *
 * "Best-effort" means a rollback step that itself errors is logged and
 * counted, never cascaded — remaining rollbacks still run. The result
 * carries `{rolledBack, errors}` for the terminal `failed` event payload.
 */

export type InverseMutation =
  | { kind: "deleteItem"; itemId: string }
  | { kind: "updateItem"; input: UpdateItemInput };

export interface RollbackError {
  index: number;
  label: string;
  error: string;
}

export interface RollbackResult {
  rolledBack: number;
  errors: RollbackError[];
}

export type RollbackEvent =
  | { kind: "rollback-start"; action: PlannedAction }
  | { kind: "rollback-skip"; action: PlannedAction; reason: string }
  | { kind: "rollback-success"; action: PlannedAction }
  | { kind: "rollback-failed"; action: PlannedAction; error: string };

export interface RollbackOptions {
  emit?: (event: RollbackEvent) => void;
}

const findPriorValue = (
  snapshot: RemoteItem | null | undefined,
  fieldId: string,
  language?: string,
  version?: number
): string | null => {
  if (!snapshot) return null;
  const found = snapshot.fields.find(
    (f) =>
      f.fieldId.toLowerCase() === fieldId.toLowerCase() &&
      (language === undefined || f.language === language) &&
      (version === undefined || f.version === version)
  );
  return found ? found.value : null;
};

/**
 * Produce the inverse mutation for an applied action. Returns `null` when
 * there's nothing to undo (a skip with no mutation).
 *
 * For an applied `createItem`, the inverse is `deleteItem(itemId)` where
 * `itemId` is the Sitecore-assigned ID — captured by the executor on
 * dispatch and looked up here via `capturedItemIds[action.operation.id]`.
 *
 * For an applied `updateItem`, each touched field reverts to its prior
 * snapshot value. If a field was unset prior, the inverse sets it to ""
 * (Sitecore's pragmatic clear). True "field-not-set" semantics would
 * require a deleteField mutation; deferred to Phase 4.
 */
export const inverseOf = (
  action: PlannedAction,
  capturedItemIds: ReadonlyMap<string, string>
): InverseMutation | null => {
  if (!action.mutation) return null;

  if (action.mutation.kind === "createItem") {
    if (action.operation.op !== "CreateItem") {
      throw new Error("createItem mutation expected on a CreateItem operation.");
    }
    const itemId = capturedItemIds.get(action.operation.id);
    if (!itemId) {
      // The create dispatched but we never captured its assigned itemId —
      // refuse to roll back rather than guess. Caller treats as best-effort
      // failure and continues.
      throw new Error(`Rollback: no captured itemId for createItem refKey ${action.operation.id}.`);
    }
    return { kind: "deleteItem", itemId };
  }

  // updateItem: each touched field reverts to its prior snapshot value.
  const priorFields: FieldValue[] = action.mutation.input.fields.map((field) => {
    const prior = findPriorValue(action.snapshot, field.fieldId, field.language, field.version);
    return {
      fieldId: field.fieldId,
      language: field.language,
      version: field.version,
      value: { kind: "string", value: prior ?? "" },
    };
  });

  return {
    kind: "updateItem",
    input: { itemId: action.mutation.input.itemId, fields: priorFields },
  };
};

/**
 * Unwind `applied` actions in LIFO order. Each step catches its own
 * errors so a rollback failure on op N doesn't abort rollback of op N-1.
 */
export const rollback = async (
  applied: PlannedAction[],
  client: AuthoringApiClient,
  capturedItemIds: ReadonlyMap<string, string>,
  options: RollbackOptions = {}
): Promise<RollbackResult> => {
  const result: RollbackResult = { rolledBack: 0, errors: [] };

  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const action = applied[i];
    let inverse: InverseMutation | null;
    try {
      inverse = inverseOf(action, capturedItemIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({
        index: action.index,
        label: action.operation.label,
        error: message,
      });
      options.emit?.({ kind: "rollback-failed", action, error: message });
      continue;
    }

    if (!inverse) {
      options.emit?.({
        kind: "rollback-skip",
        action,
        reason: "no inverse needed (no forward mutation)",
      });
      continue;
    }

    options.emit?.({ kind: "rollback-start", action });
    try {
      if (inverse.kind === "deleteItem") {
        await client.deleteItem({ itemId: inverse.itemId });
      } else {
        await client.updateItem(inverse.input);
      }
      result.rolledBack += 1;
      options.emit?.({ kind: "rollback-success", action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({
        index: action.index,
        label: action.operation.label,
        error: message,
      });
      options.emit?.({ kind: "rollback-failed", action, error: message });
      // best-effort: continue with remaining rollbacks
    }
  }

  return result;
};

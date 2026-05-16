/**
 * Recipe identity marker — the `Scai Handle` field.
 *
 * Every recipe-managed Sitecore item carries its recipe handle in a
 * `Scai Handle` field (a shared field on the Standard Template). The
 * handle — not the mutable content-tree path — is the recipe's identity
 * hook: a moved or renamed item is still matched on the next push, and
 * `readCurrent` recovers the exact authored handle instead of
 * synthesising one from the item name.
 *
 * This module owns the push-write half — `injectHandleMarker` stamps the
 * marker onto every `CreateItem` op a compiled recipe emits. Reading the
 * marker back (planner match + `readCurrent`) lives with those consumers.
 *
 * See docs/recipe-sync-architecture.md, "Recipe identity — the marker field".
 */
import type { FieldValue, OperationIr } from "./ir/operations";

/** Field name of the recipe-identity marker on the Standard Template. */
export const SCAI_HANDLE_FIELD_NAME = "Scai Handle";

/**
 * Placeholder `fieldId` for the marker. The marker is always written and
 * matched by NAME — the authoring client's field input and the planner's
 * drift check both prefer `fieldName` — and the real field's GUID is
 * server-assigned per environment, so a stable sentinel is correct here.
 */
const SCAI_HANDLE_FIELD_ID = "00000000-0000-0000-0000-5ca15ca15ca1";

const markerField = (handle: string): FieldValue => ({
  fieldId: SCAI_HANDLE_FIELD_ID,
  fieldName: SCAI_HANDLE_FIELD_NAME,
  value: { kind: "string", value: handle },
});

/**
 * Inject the recipe handle as a `Scai Handle` field on every `CreateItem`
 * op in an IR, so every recipe-managed item carries its recipe identity.
 *
 * Pure. Idempotent — a `CreateItem` op that already carries the marker is
 * returned unchanged. The marker rides the op's `fields`, so it is written
 * on create and re-converged through the same field-drift path on update.
 */
export const injectHandleMarker = (ir: OperationIr): OperationIr => ({
  ...ir,
  operations: ir.operations.map((op) => {
    if (op.op !== "CreateItem") return op;
    if (op.fields.some((field) => field.fieldName === SCAI_HANDLE_FIELD_NAME)) {
      return op;
    }
    return { ...op, fields: [...op.fields, markerField(ir.recipeHandle)] };
  }),
});

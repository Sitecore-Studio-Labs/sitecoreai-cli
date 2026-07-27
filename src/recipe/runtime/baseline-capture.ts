/**
 * Walk an IR + its capturedItemIds map at the end of a successful apply
 * and emit one `BaselineFieldEntry` per field the recipe wrote. The push
 * task feeds this to `writeBaseline` to persist the snapshot.
 *
 * What "wrote" means here:
 *  - `SetField` ops — one entry per (itemRefKey, fieldId, fieldName?,
 *    language?, version?, hash(renderedValue)).
 *  - `SetBaseTemplates` — one entry per templateRefKey, fieldId is the
 *    `__Base template` GUID, value is the pipe-joined base list.
 *  - `SetStandardValues` — one entry on the template, fieldId is
 *    `__Standard values`, value is the standard-values item GUID.
 *  - `CreateItem.fields[]` — one entry per embedded field on a created
 *    item (icon, display name, etc.). These ride with the item creation
 *    and aren't separately tracked as SetField ops, but they're equally
 *    "what was written" and re-pushing a recipe with the same fields
 *    should diff-clean.
 *
 * Ops that don't write a per-field value (CreateItem itself, PruneChildren,
 * CreateSiteFromTemplate, AddItemVersion, AppendToMultiList) emit nothing
 * — they're structural, not value-bearing. AppendToMultiList specifically
 * is excluded because its merge-unique semantics mean the on-tenant value
 * is the UNION of every recipe that contributed; capturing one recipe's
 * write hash wouldn't reflect what the field would re-read as.
 *
 * The capturedItemIds is used only for `ref-recipe` / `ref-recipe-list` /
 * `ref-source-fields` resolution — converting recipe-internal refKeys to
 * the concrete GUIDs the executor wrote. Hashes are computed over the
 * SAME wire string `renderRefValue` would produce on the next push, so
 * apples-to-apples comparison at plan time.
 */

import type {
  FieldValue,
  Operation,
  OperationIr,
  RefValue,
  SetBaseTemplatesOp,
  SetFieldOp,
  SetStandardValuesOp,
} from "../ir/operations";
import type { PlannedAction } from "./plan";
import { SYSTEM_FIELDS } from "../ir/sitecore-templates";
import { renderRefValue, resolveRecipeRefs } from "../api/ref-encoding";
import type { BaselineFieldEntry } from "./baseline";
import { hashFieldValueForBaseline } from "./baseline";

/**
 * Stable refKey for the `__Standard values` field on a template. Mirrors
 * `setStandardValuesDesired` in plan.ts — that helper synthesizes a
 * `__Standard values` SetField op for diff purposes; the baseline
 * captures the same triple so post-apply state matches plan-time
 * classification.
 */
const STANDARD_VALUES_FIELD_ID = SYSTEM_FIELDS.STANDARD_VALUES;
const BASE_TEMPLATE_FIELD_ID = SYSTEM_FIELDS.BASE_TEMPLATE;

const fieldEntryFromFieldValue = (
  itemRefKey: string,
  field: FieldValue,
  capturedItemIds: ReadonlyMap<string, string>
): BaselineFieldEntry | null => {
  // Defensive: a malformed FieldValue (no `value`) shouldn't reach the
  // baseline writer — it would have failed earlier in the pipeline. Skip
  // rather than throw so the baseline write doesn't break a successful apply.
  if (field.value === undefined) return null;
  const resolved: RefValue = resolveRecipeRefs(field.value, capturedItemIds);
  const rendered = renderRefValue(resolved);
  return {
    itemRefKey,
    fieldId: field.fieldId,
    ...(field.fieldName !== undefined && { fieldName: field.fieldName }),
    ...(field.language !== undefined && { language: field.language }),
    ...(field.version !== undefined && { version: field.version }),
    // hashFieldValueForBaseline canonicalises layout XML before hashing
    // so push (canonical XML) and tenant read-back (SXA delta XML)
    // produce the same baseline hash for the same logical layout.
    valueHash: hashFieldValueForBaseline(field.fieldId, rendered),
  };
};

const fieldEntryFromSetField = (
  op: SetFieldOp,
  capturedItemIds: ReadonlyMap<string, string>
): BaselineFieldEntry | null =>
  fieldEntryFromFieldValue(
    op.itemRefKey,
    {
      fieldId: op.fieldId,
      ...(op.fieldName !== undefined && { fieldName: op.fieldName }),
      ...(op.language !== undefined && { language: op.language }),
      ...(op.version !== undefined && { version: op.version }),
      value: op.value,
    },
    capturedItemIds
  );

const fieldEntryFromSetBaseTemplates = (
  op: SetBaseTemplatesOp,
  capturedItemIds: ReadonlyMap<string, string>
): BaselineFieldEntry | null =>
  fieldEntryFromFieldValue(
    op.itemRefKey,
    {
      fieldId: BASE_TEMPLATE_FIELD_ID,
      fieldName: "__Base template",
      value: { kind: "ref-recipe-list", refKeys: op.baseTemplates },
    },
    capturedItemIds
  );

const fieldEntryFromSetStandardValues = (
  op: SetStandardValuesOp,
  capturedItemIds: ReadonlyMap<string, string>
): BaselineFieldEntry | null =>
  fieldEntryFromFieldValue(
    op.templateRefKey,
    {
      fieldId: STANDARD_VALUES_FIELD_ID,
      fieldName: "__Standard values",
      value: { kind: "ref-recipe", refKey: op.standardValuesRefKey },
    },
    capturedItemIds
  );

/**
 * Applied-state evidence for one push — the executed plan's actions plus
 * the CreateItem refKeys the apply ADOPTED (existing item, fields NOT
 * written). When present, `collectBaselineEntries` records only field
 * values the tenant verifiably holds after this push:
 *
 *  - CreateItem `create` actions whose refKey was NOT adopted — the item
 *    was freshly created with the recipe's fields.
 *  - SetField/SetBaseTemplates/SetStandardValues `update` actions — the
 *    desired value was written.
 *  - `skip` actions with `skipKind: "in-sync"` — the planner proved the
 *    tenant already held the desired value.
 *
 * Everything else (adopted creates, `unresolved` / `create-only` /
 * `cms-wins` skips) is deliberately NOT baselined: the tenant does not
 * hold the desired value there, and recording it anyway is exactly the
 * over-capture that manufactured permanent phantom `cms-edit` conflicts
 * — the recipe kept matching the (fictional) baseline while the tenant
 * kept "diverging" from it. An uncaptured cell simply classifies as
 * `first-push` next time, which applies cleanly.
 */
export interface AppliedEvidence {
  actions: readonly PlannedAction[];
  adoptedItemRefKeys?: ReadonlySet<string>;
}

const capturableOps = (
  ir: OperationIr,
  applied: AppliedEvidence | undefined
): readonly Operation[] => {
  if (!applied) return ir.operations as Operation[];
  const adopted = applied.adoptedItemRefKeys;
  const ops: Operation[] = [];
  for (const action of applied.actions) {
    const op = action.operation;
    switch (op.op) {
      case "CreateItem":
        if (action.status === "create" && !adopted?.has(op.id)) ops.push(op);
        break;
      case "SetField":
      case "SetBaseTemplates":
      case "SetStandardValues":
        if (
          action.status === "update" ||
          (action.status === "skip" && action.skipKind === "in-sync")
        ) {
          ops.push(op);
        }
        break;
      default:
        break;
    }
  }
  return ops;
};

/**
 * Walk every value-bearing op in `ir.operations` and collect one
 * `BaselineFieldEntry` per write. Returns `[]` for an IR with no
 * value-bearing ops (structural-only recipes — pure CreateItem +
 * PruneChildren shouldn't have a baseline either, the "no entries" case
 * just round-trips as recipe-change next plan).
 *
 * Pass `applied` (the executed plan's actions + adopted refKeys) to
 * capture APPLIED state instead of desired state — see
 * {@link AppliedEvidence}. Without it (legacy callers/tests) every
 * value-bearing op is captured, desired-state style.
 */
export const collectBaselineEntries = (
  ir: OperationIr,
  capturedItemIds: ReadonlyMap<string, string>,
  applied?: AppliedEvidence
): BaselineFieldEntry[] => {
  const entries: BaselineFieldEntry[] = [];
  for (const op of capturableOps(ir, applied)) {
    switch (op.op) {
      case "CreateItem":
        // op.fields is typed required but mock IRs in unit tests can omit
        // it; tolerate missing/empty for resilience.
        for (const f of op.fields ?? []) {
          const entry = fieldEntryFromFieldValue(op.id, f, capturedItemIds);
          if (entry !== null) entries.push(entry);
        }
        break;
      case "SetField": {
        const entry = fieldEntryFromSetField(op, capturedItemIds);
        if (entry !== null) entries.push(entry);
        break;
      }
      case "SetBaseTemplates": {
        const entry = fieldEntryFromSetBaseTemplates(op, capturedItemIds);
        if (entry !== null) entries.push(entry);
        break;
      }
      case "SetStandardValues": {
        const entry = fieldEntryFromSetStandardValues(op, capturedItemIds);
        if (entry !== null) entries.push(entry);
        break;
      }
      // The structural ops emit nothing — they don't write a per-field
      // value the baseline would later compare against:
      case "AddItemVersion": // creates a version stack slot, no field write
      case "AppendToMultiList": // merge-unique = union across recipes; hash isn't meaningful
      case "CreateSiteFromTemplate": // Sites API surface, not Authoring
      case "PruneChildren": // delete-side, not write-side
        break;
    }
  }
  return entries;
};

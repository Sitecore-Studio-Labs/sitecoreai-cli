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
import type { CreateItemOp, FieldValue, OperationIr } from "../ir/operations";
import { SITECORE_TEMPLATES } from "../ir/sitecore-templates";

/** Field name of the recipe-identity marker on the Standard Template. */
export const SCAI_HANDLE_FIELD_NAME = "Scai Handle";

/** GUID compare ignoring case, braces, and hyphens (Authoring returns hyphen-less). */
const sameGuid = (a: string, b: string): boolean => {
  const norm = (g: string): string => g.trim().toLowerCase().replace(/[{}-]/g, "");
  return norm(a) === norm(b);
};

/**
 * Sitecore template-authoring items — a template, its Template Sections, and
 * its Template Fields — are based on these system data templates.
 *
 * The marker field lives on the Standard Template. Content items inherit it,
 * but template-authoring items do NOT expose it as a writable field: the
 * Authoring API rejects a `Scai Handle` write on them with "Cannot find a
 * field with the name Scai Handle", aborting the create. (The "every item
 * inherits it" assumption in `ensure-marker-field.ts` is flagged unverified
 * for exactly this reason — a live XM Cloud tenant disproves it.)
 *
 * So the marker is skipped for these. Templates never needed it: they match
 * by path/name on push, and `readCurrent` synthesises their handle from the
 * item name.
 */
const TEMPLATE_SYSTEM_TEMPLATE_IDS = [
  SITECORE_TEMPLATES.TEMPLATE,
  SITECORE_TEMPLATES.TEMPLATE_SECTION,
  SITECORE_TEMPLATES.TEMPLATE_FIELD,
];

/**
 * True when the op creates a template-authoring item (template / section /
 * field) that cannot carry the marker field. Only a built-in GUID
 * `templateOf` can match — a recipe-created template's refKey (uuidv5) or a
 * `ref-path` templateOf never does, so content items keep the marker.
 */
const createsTemplateSystemItem = (op: CreateItemOp): boolean =>
  typeof op.templateOf === "string" &&
  TEMPLATE_SYSTEM_TEMPLATE_IDS.some((id) => sameGuid(id, op.templateOf as string));

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
 * Inject the recipe handle as a `Scai Handle` field on every content-item
 * `CreateItem` op in an IR, so every recipe-managed content item carries its
 * recipe identity. Template-authoring items (template / section / field) are
 * skipped — they cannot carry the field (see `createsTemplateSystemItem`).
 *
 * Pure. Idempotent — a `CreateItem` op that already carries the marker is
 * returned unchanged. The marker rides the op's `fields`, so it is written
 * on create and re-converged through the same field-drift path on update.
 */
export const injectHandleMarker = (ir: OperationIr): OperationIr => ({
  ...ir,
  operations: ir.operations.map((op) => {
    if (op.op !== "CreateItem") return op;
    if (createsTemplateSystemItem(op)) return op;
    if (op.fields.some((field) => field.fieldName === SCAI_HANDLE_FIELD_NAME)) {
      return op;
    }
    return { ...op, fields: [...op.fields, markerField(ir.recipeHandle)] };
  }),
});

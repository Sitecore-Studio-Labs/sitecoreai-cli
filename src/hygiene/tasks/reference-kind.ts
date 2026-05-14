/**
 * Reference-kind classification for blocker reports.
 *
 * Cleanup tasks that scan content for inbound references (subtree,
 * site-residue, duplicates) walk every field on every item and report
 * any field whose value mentions a target item id. Without further
 * classification, every blocker reads "field X references the target"
 * — uninformative.
 *
 * The Sitecore-specific system fields below carry structural semantics
 * the operator cares about. `_basetemplates` is "this template inherits
 * from the target"; deleting the target orphans every inheritor's
 * fields. `__masters` is "this template lists the target as an
 * Insert Option"; deleting it removes a child-creation entry from the
 * editor's New menu. `__source` is branch-template descent. The
 * `datasource template` field on a Rendering item is the type-gate for
 * "Create Local Datasource" in Pages / Experience Editor.
 *
 * The classifier maps a field name to one of these structural kinds,
 * falling back to `field-value` for the long tail of custom droplist /
 * treelist / link fields. That category split is what an agent (or
 * operator) needs to decide whether a blocker is recoverable.
 *
 * Mirrors `TemplateReferenceKind` in `./audit-template-dependencies`,
 * with `field-value` added as the catch-all for non-structural refs
 * that the template-deps audit doesn't classify. We don't import the
 * narrower type here to avoid a cycle — `audit-template-dependencies`
 * imports `./shared`, and `./shared` would otherwise want to import
 * this module.
 */

export type ReferenceKind =
  | "primary-template"
  | "base-template"
  | "insert-options"
  | "branch-source"
  | "datasource-template"
  | "field-value";

/**
 * Classify a Sitecore field name into a structured reference kind.
 * Case-insensitive — `__masters` and `__Masters` match the same kind.
 * Whitespace-tolerant — "datasource template" matches the rendering
 * datasource type-gate; the field-name attribute on a Rendering item
 * sometimes appears with mixed casing.
 */
export const classifyReferenceKind = (fieldName: string): ReferenceKind => {
  const normalized = fieldName.toLowerCase().trim();
  switch (normalized) {
    case "_template":
      return "primary-template";
    case "_basetemplates":
      return "base-template";
    case "__masters":
      return "insert-options";
    case "__source":
      return "branch-source";
    case "datasource template":
      return "datasource-template";
    default:
      return "field-value";
  }
};

/**
 * Severity ordering for blocker categorization output. Structural
 * blockers (base-template, insert-options, etc.) come first because
 * they're the load-bearing reasons a delete will fail. Plain field-
 * value refs at the bottom are usually recoverable (clear the field
 * or repoint it after the delete).
 */
export const REFERENCE_KIND_PRIORITY: Record<ReferenceKind, number> = {
  "base-template": 0,
  "insert-options": 1,
  "branch-source": 2,
  "datasource-template": 3,
  "primary-template": 4,
  "field-value": 5,
};

/**
 * URL-string encoder for Sitecore SXA's `TemplatesMapping` field on
 * the Page Designs root item. The field stores a property bag in
 * URL-encoded form:
 *
 *   {tplGuid1}={designGuid1}&{tplGuid2}={designGuid2}
 *
 * Each page design contributes one entry per applies-to template.
 *
 * Multi-recipe merging is the executor's job — when several
 * `PageDesignRecipe`s in one push contribute their own slices of the
 * mapping, the executor reads the existing field, merges contributions
 * keyed by template GUID, and writes the combined result. This module
 * is purely the wire-format encoder for one slice.
 */

const formatGuidCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

export interface TemplatesMappingEntry {
  /** Page-template item GUID (e.g. for `home-page@1`). */
  templateGuid: string;
  /** Page-design item GUID this template should use. */
  designGuid: string;
}

/**
 * Encode a list of template-to-design mappings into the URL-string
 * form Sitecore stores in the `TemplatesMapping` field. GUIDs are
 * normalized to upper-case curly form before URL-encoding.
 */
export function encodeTemplatesMapping(entries: readonly TemplatesMappingEntry[]): string {
  return entries
    .map(
      ({ templateGuid, designGuid }) =>
        `${encodeURIComponent(formatGuidCurly(templateGuid))}=${encodeURIComponent(formatGuidCurly(designGuid))}`
    )
    .join("&");
}

/**
 * Per-field-type pruners for `cleanup subtree --orphan-external-refs prune`.
 *
 * Each pruner inspects the field value, decides whether it can handle
 * the shape, and returns the pruned value with target references
 * surgically removed (preserving sibling entries). Returning `null`
 * means "this isn't my shape" — caller tries the next pruner.
 *
 * Order of attempts in the caller is renderings-XML first (most
 * specific) then multi-list (catches pipe-separated GUID lists). If
 * none match, the field is a single-value reference and we fall back
 * to clearing it entirely.
 */

const normalize = (raw: string): string => raw.toLowerCase().replace(/[{}-]/g, "");

const isRenderingsXml = (value: string): boolean => {
  const trimmed = value.trimStart();
  // Sitecore layout always starts with the outer `<r ` element, either
  // canonical (`<r xmlns:xsd=…`) or delta (`<r xmlns:p="p" …`). A bare
  // `<r>` with no attributes is the empty-renderings form some tenants
  // emit; accept that too.
  return trimmed.startsWith("<r ") || trimmed.startsWith("<r>");
};

/**
 * Detect a pipe-separated GUID list (multi-list, treelist, single
 * multi-link). Returns false on values that contain a pipe but aren't
 * GUID-shaped (rare custom delimited fields). Empty strings are not
 * multi-lists — the caller's no-op path handles them.
 */
const isMultiList = (value: string): boolean => {
  if (!value.includes("|") && !/^\s*\{?[0-9a-f-]{32,}\}?\s*$/i.test(value)) return false;
  const parts = value
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  // Every part must be GUID-shaped (with or without curly braces /
  // dashes). Reject if any token has whitespace or non-hex chars.
  return parts.every((p) =>
    /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i.test(p)
  );
};

/**
 * Remove every target id from a pipe-separated GUID list, preserving
 * the formatting (curly-uppercase vs bare-lowercase) of the surviving
 * entries. Returns the pruned list or `null` if the value isn't a
 * multi-list.
 */
export const pruneMultiList = (value: string, targetIds: ReadonlySet<string>): string | null => {
  if (!isMultiList(value)) return null;
  const remaining = value
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !targetIds.has(normalize(p)));
  return remaining.join("|");
};

/**
 * Remove every `<r ... />` element whose `id`/`s:id` (rendering item)
 * or `ds`/`s:ds` (datasource item) attribute references a target id.
 * Other renderings stay in their original placeholder; the outer
 * `<r>...<d>...</d></r>` wrapper is preserved even when every inner
 * rendering is removed (callers can post-process empty layouts if
 * needed).
 *
 * Pattern-based parser: each inner rendering is a self-closing `<r
 * attr="value" attr="value" />` element. The outer wrapper `<r ` is
 * followed by namespace declarations / `xmlns`, never by a `/`, so the
 * self-closing-only regex never touches it.
 */
export const pruneRenderingsXml = (
  value: string,
  targetIds: ReadonlySet<string>
): string | null => {
  if (!isRenderingsXml(value)) return null;
  return value.replace(/<r ([^>]*?)\/>/g, (match, attrs: string) => {
    // Match both canonical (`id="…"`, `ds="…"`) and SXA delta
    // (`s:id="…"`, `s:ds="…"`) attribute forms. The dotall-friendly
    // `\s` covers tabs and newlines authors sometimes paste in.
    const idMatch = /(?:^|\s)(?:s:)?id="([^"]+)"/i.exec(attrs);
    const dsMatch = /(?:^|\s)(?:s:)?ds="([^"]+)"/i.exec(attrs);
    const hit = (val: string | undefined): boolean => {
      if (!val) return false;
      // The `ds` attribute can hold a path sentinel (`local:slot`) or
      // a content-tree path in some SXA configs — not a GUID. Skip
      // non-GUID values; we only match by id.
      if (!/^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i.test(val))
        return false;
      return targetIds.has(normalize(val));
    };
    if (hit(idMatch?.[1]) || hit(dsMatch?.[1])) return "";
    return match;
  });
};

/**
 * Try every pruner in priority order; return the first successful
 * prune. Falls through to `null` when no pruner matches — the caller
 * should treat that as "single-value field; clearing is the prune."
 */
export const pruneFieldValue = (value: string, targetIds: ReadonlySet<string>): string | null => {
  const xmlPruned = pruneRenderingsXml(value, targetIds);
  if (xmlPruned !== null) return xmlPruned;
  const listPruned = pruneMultiList(value, targetIds);
  if (listPruned !== null) return listPruned;
  return null;
};

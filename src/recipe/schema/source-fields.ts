/**
 * Renderer for the structured source fields on `SitecoreFieldAugment`.
 *
 * The recipe author surface decomposes Sitecore's `Source` field into
 * orthogonal pieces:
 *
 *   sourceTypes   string[]   — picker filter (template handles)
 *   sourceQuery   string     — where to look (Sitecore Query)
 *   sourceScope   string     — where to look (fixed content path)
 *   sourceRaw     string     — escape hatch (verbatim Source string)
 *
 * `renderSourceFields` composes them into the URL-encoded Source value
 * Sitecore expects. The combinations preserve longstanding Sitecore
 * semantics:
 *
 *   sourceQuery alone        → `query:<query>`         (Droplist shorthand)
 *   sourceTypes alone        → `IncludeTemplatesForSelection={GUID},...`
 *   sourceScope alone        → `DataSource=<path>`
 *   sourceQuery + types      → `DataSource=query:<query>&IncludeTemplatesForSelection=...`
 *   sourceScope + types      → `DataSource=<path>&IncludeTemplatesForSelection=...`
 *   sourceRaw                → verbatim, ignores everything else
 *
 * Authors who need a Source form outside this surface (e.g. a bare
 * `/sitecore/content/Tags` Treelist source) use `sourceRaw`.
 */

export interface SourceFields {
  sourceTypes?: readonly string[];
  sourceQuery?: string;
  sourceScope?: string;
  sourceRaw?: string;
}

const formatGuidCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

/**
 * Compose structured source fields into the Sitecore-encoded Source string.
 * `resolveHandle` maps a recipe handle to its deterministic template GUID
 * (typically `templateId(handle)` from `guids.ts`).
 *
 * Returns `undefined` when no source fields are set — callers can use this
 * to decide whether to emit the Source field at all.
 */
export const renderSourceFields = (
  fields: SourceFields,
  resolveHandle: (handle: string) => string
): string | undefined => {
  if (fields.sourceRaw !== undefined) {
    return fields.sourceRaw;
  }

  const types =
    fields.sourceTypes && fields.sourceTypes.length > 0 ? fields.sourceTypes : undefined;
  const query = fields.sourceQuery;
  const scope = fields.sourceScope;

  if (!types && !query && !scope) {
    return undefined;
  }

  const includeTemplates = types
    ? `IncludeTemplatesForSelection=${types.map((h) => formatGuidCurly(resolveHandle(h))).join(",")}`
    : undefined;

  // Standalone forms preserve Sitecore's per-field-type shorthand.
  if (!types && query && !scope) {
    return `query:${query}`;
  }
  if (types && !query && !scope) {
    return includeTemplates!;
  }
  if (!types && !query && scope) {
    return `DataSource=${scope}`;
  }

  // Combined form — URL-encoded property bag.
  const parts: string[] = [];
  if (query) parts.push(`DataSource=query:${query}`);
  else if (scope) parts.push(`DataSource=${scope}`);
  if (includeTemplates) parts.push(includeTemplates);
  return parts.join("&");
};

/**
 * True when the structured source fields require recipe-handle resolution
 * to render. The compiler uses this to decide between emitting a plain
 * `string` RefValue at compile time vs deferring to the executor via
 * `ref-source-fields`.
 */
export const sourceFieldsNeedHandleResolution = (fields: SourceFields): boolean =>
  Array.isArray(fields.sourceTypes) && fields.sourceTypes.length > 0;

/**
 * Convert the author-surface `SitecoreFieldSource` discriminated union
 * to the flat `SourceFields` bag the renderer + IR consume. Internal
 * adapter — author surface stays union-shaped (clean for JSON Schema
 * and Agent Studio), compiler internals stay flat-shaped (clean for
 * `renderSourceFields` and the `ref-source-fields` IR op).
 *
 * Returns an empty bag when `source` is undefined, so callers can
 * unconditionally invoke this and feed the result to
 * `renderSourceFields` / `sourceFieldsNeedHandleResolution`.
 */
export const augmentSourceToFields = (
  source:
    | { kind: "filter"; types?: readonly string[]; query?: string; scope?: string }
    | { kind: "raw"; value: string }
    | undefined
): SourceFields => {
  if (!source) return {};
  if (source.kind === "raw") {
    return { sourceRaw: source.value };
  }
  return {
    sourceTypes: source.types,
    sourceQuery: source.query,
    sourceScope: source.scope,
  };
};

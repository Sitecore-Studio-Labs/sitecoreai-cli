/**
 * Parser for the recipe-level `sitecore.source` prefix conventions.
 *
 * Authors write convenient short forms — `template:<handle>`,
 * `templates:<h1>,<h2>`, `query:...`, `datasource:<q>&template:<h>`. The
 * compiler dispatches on the parsed tagged union to:
 *   - resolve handles to deterministic template GUIDs
 *   - emit Sitecore's actual Source string format
 *     (`IncludeTemplatesForSelection={GUID}`, `DataSource=<q>&...`, …)
 *
 * Anything that doesn't match a known prefix is `kind: "raw"` and passes
 * through verbatim.
 */

const QUERY_PREFIX = "query:";
const TEMPLATE_PREFIX = "template:";
const TEMPLATES_PREFIX = "templates:";
const DATASOURCE_PREFIX = "datasource:";
const TEMPLATE_AMP_SUFFIX = "&template:";

export type SourceConvention =
  | { kind: "query"; query: string }
  | { kind: "template"; handle: string }
  | { kind: "templates"; handles: string[] }
  | { kind: "datasource-template"; query: string; handle: string }
  | { kind: "datasource"; query: string }
  | { kind: "raw"; value: string };

const splitHandles = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const parseSourceConvention = (raw: string): SourceConvention => {
  if (raw.startsWith(QUERY_PREFIX)) {
    return { kind: "query", query: raw };
  }
  if (raw.startsWith(TEMPLATE_PREFIX)) {
    return { kind: "template", handle: raw.slice(TEMPLATE_PREFIX.length).trim() };
  }
  if (raw.startsWith(TEMPLATES_PREFIX)) {
    return { kind: "templates", handles: splitHandles(raw.slice(TEMPLATES_PREFIX.length)) };
  }
  if (raw.startsWith(DATASOURCE_PREFIX)) {
    const rest = raw.slice(DATASOURCE_PREFIX.length);
    const ampIdx = rest.indexOf(TEMPLATE_AMP_SUFFIX);
    if (ampIdx >= 0) {
      return {
        kind: "datasource-template",
        query: rest.slice(0, ampIdx),
        handle: rest.slice(ampIdx + TEMPLATE_AMP_SUFFIX.length).trim(),
      };
    }
    return { kind: "datasource", query: rest };
  }
  return { kind: "raw", value: raw };
};

const formatGuidCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

/**
 * Render a parsed source convention back to the Sitecore wire format,
 * given a `resolveHandle` function that maps a recipe handle to a
 * deterministic template GUID (typically `templateId(handle)`).
 */
export const renderSourceConvention = (
  parsed: SourceConvention,
  resolveHandle: (handle: string) => string
): string => {
  switch (parsed.kind) {
    case "query":
      return parsed.query;
    case "template":
      return `IncludeTemplatesForSelection=${formatGuidCurly(resolveHandle(parsed.handle))}`;
    case "templates":
      return `IncludeTemplatesForSelection=${parsed.handles
        .map((handle) => formatGuidCurly(resolveHandle(handle)))
        .join(",")}`;
    case "datasource-template":
      return `DataSource=${parsed.query}&IncludeTemplatesForSelection=${formatGuidCurly(
        resolveHandle(parsed.handle)
      )}`;
    case "datasource":
      return `DataSource=${parsed.query}`;
    case "raw":
      return parsed.value;
  }
};

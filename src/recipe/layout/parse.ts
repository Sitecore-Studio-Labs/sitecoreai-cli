/**
 * Parse a Sitecore layout XML string back into a structural `Layout` shape.
 *
 * This is the inverse of `emitLayoutXml` (`./emit.ts`): where the emitter
 * turns a recipe-level `Layout` into the wire string Sitecore stores on the
 * `__Renderings` / `__Final Renderings` field, `parseLayoutXml` walks that
 * wire string and reconstructs the `Layout` — the seam `read-current.ts`
 * uses to reverse-project the layout-bearing recipe kinds (partial-design,
 * page-design, page).
 *
 * ## Both wire forms
 *
 * `emitLayoutXml` emits two forms; this parser auto-detects and handles
 * both off the root element's namespace declarations:
 *
 *  - **canonical** — `<r xmlns:xsd xmlns:xsi><d id="{device}" [l="{layout}"]>
 *    <r id ph ds par uid /></d></r>`. The default form; Page Design
 *    items round-trip it byte-for-byte.
 *
 *  - **delta** — SXA Partial Design form: `<r xmlns:p xmlns:s p:p="1"><d>
 *    <p:da name="l" /><r uid p:before|p:after s:ph s:ds s:id s:par />
 *    </d></r>`. The Partial Design Layout pipeline normalises canonical
 *    input into this form on first write.
 *
 * The two forms differ only in attribute prefixes (`s:ph` vs `ph`; legacy `placeh` accepted),
 * the always-present `s:par=""` in delta, the `<p:da name="l" />` directive
 * element delta carries, and the per-placement anchor attributes
 * (`p:before` / `p:after`) delta uses instead of document order. Either
 * way the parser reads the `<r>` rendering elements in document order —
 * which is the placement order both emitters write — so placement ordering
 * is preserved without interpreting the delta anchors. (The delta anchors
 * are themselves derived from document order by `emitDelta`, so document
 * order is the faithful signal.)
 *
 * ## What a parsed placement carries
 *
 * Each `<r>` rendering element yields a `ParsedPlacement`:
 *
 *   id    → renderingGuid   (bare 32-hex, lower-case)
 *   ph    → placeholderKey  (the `Layout.placeholders` dictionary key)
 *   ds    → datasourceGuid  (bare hex) — or a `local:<slot>` sentinel
 *   par   → variant + params (URL-decoded; the `FieldNames` param lifts
 *           out to `variant`, the rest stay in `params`)
 *   uid   → placementUid    (bare hex; informational — placement identity
 *           is positional, not uid-derived, on the reverse path)
 *
 * GUID→handle resolution is NOT done here: this module is a pure
 * wire-format decoder with no knowledge of the recipe handle space.
 * `read-current.ts` owns the GUID→handle index and maps
 * `ParsedPlacement` → `ComponentPlacement`.
 */

import { createScaiError } from "@/shared/errors";

/**
 * A single rendering placement decoded from one `<r>` element, before
 * GUID→handle resolution. `read-current.ts` turns this into a recipe-level
 * `ComponentPlacement`.
 */
export interface ParsedPlacement {
  /** Rendering item GUID, bare 32-hex lower-case (the `id` attribute). */
  renderingGuid: string;
  /** Placeholder key — the `Layout.placeholders` dictionary key. */
  placeholderKey: string;
  /** Placement UID, bare hex. Informational; placement identity is positional. */
  uid: string;
  /**
   * Datasource the placement binds to. Absent when the `<r>` element had
   * no `ds` attribute (a `kind: "none"` config-driven rendering).
   *
   *  - `{ kind: "guid" }`  — a real Sitecore item GUID (bare hex). The
   *    caller resolves it to a `shared` (content-item) or `scoped`
   *    (page-local) datasource ref.
   *  - `{ kind: "local" }` — the `local:<slot>` sentinel `emitLayoutXml`
   *    writes for an unresolved scoped ref. Maps straight to a
   *    `kind: "scoped"` datasourceRef with that slot.
   */
  datasource?: { kind: "guid"; guid: string } | { kind: "local"; slot: string };
  /** SXA Rendering Variant — the `FieldNames` rendering parameter, if present. */
  variant?: string;
  /** Remaining rendering parameters (everything in `par` except `FieldNames`). */
  params?: Record<string, string>;
}

/**
 * The structural result of parsing a layout XML string. `placeholders`
 * preserves placement order per key — array order is render order, the
 * same contract `LayoutSchema` carries.
 */
export interface ParsedLayout {
  placeholders: Record<string, ParsedPlacement[]>;
  /**
   * The wire form the input was in — `"canonical"` or `"delta"`. Returned
   * for diagnostics; callers reconstructing a `Layout` ignore it (the
   * recipe `Layout` shape is form-agnostic).
   */
  mode: "canonical" | "delta";
  /**
   * SXA JSON Layout definition GUID (bare hex), recovered from the device
   * element's `l="{…}"` attribute when present. Only canonical layouts
   * carry it (a page-template `__Standard Values` shell); `undefined`
   * otherwise.
   */
  layoutId?: string;
}

/** Normalise a Sitecore GUID to bare 32-hex, lower-case (strip `{}` and `-`). */
const normalizeGuid = (guid: string): string => guid.trim().toLowerCase().replace(/[{}-]/g, "");

/**
 * Decode the XML-attribute entity escapes `escapeXmlAttribute` introduces.
 * Inverse of the emitter's `&` → `&amp;` etc. chain; `&amp;` is decoded
 * last so a literal `&amp;lt;` in the source survives intact.
 */
const unescapeXmlAttribute = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

/**
 * Pull every `name="value"` (or `name='value'`) attribute off a single XML
 * element's start tag into a map. Attribute values are XML-unescaped; the
 * map key is the raw attribute name including any namespace prefix
 * (`s:ph`, `p:before`). Sitecore's layout XML never nests quotes inside
 * an attribute value other than via the `&quot;` entity, so a
 * non-greedy `"[^"]*"` / `'[^']*'` scan is exact for this format.
 */
const parseAttributes = (tag: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  // The attribute-name class is bounded at 256 chars so a pathological
  // input string of many trailing `-` chars can't trigger polynomial
  // backtracking (CodeQL js/polynomial-redos guard). SXA Layout
  // attribute names are short identifiers (`s:placeh`, `p:before`,
  // `id`, `params`, …); 256 is ~32× any real-world value.
  const attrRe = /([\w:.-]{1,256})\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag)) !== null) {
    const rawValue = match[3] !== undefined ? match[3] : (match[4] ?? "");
    attrs[match[1]] = unescapeXmlAttribute(rawValue);
  }
  return attrs;
};

/**
 * Decode a `par` blob (URL-encoded `key=value&key=value` pairs) into a
 * `{ variant, params }` split. The SXA Rendering Variant selection rides
 * as the `FieldNames` parameter (see `emit.ts` `resolvePlacement`), so it
 * is lifted out to `variant`; every other pair stays in `params`.
 *
 * Exported for direct unit testing — it is the trickiest decode in the
 * round-trip and the one place a `+`-vs-`%20` or empty-value quirk would
 * bite.
 *
 * `params` is `undefined` (not `{}`) when no non-FieldNames pairs remain,
 * so the reconstructed placement omits an empty `params` rather than
 * fabricating one — the lossy-projection contract `read-current.ts` keeps.
 */
export const decodeParBlob = (
  par: string
): { variant?: string; params?: Record<string, string> } => {
  const trimmed = par.trim();
  if (trimmed === "") return {};

  let variant: string | undefined;
  const params: Record<string, string> = {};
  for (const pair of trimmed.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    // A bare token with no `=` is a degenerate pair — treat it as a
    // key with an empty value rather than dropping it.
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawValue = eq >= 0 ? pair.slice(eq + 1) : "";
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue);
    if (key === "FieldNames") {
      variant = value;
    } else {
      params[key] = value;
    }
  }

  const result: { variant?: string; params?: Record<string, string> } = {};
  if (variant !== undefined) result.variant = variant;
  if (Object.keys(params).length > 0) result.params = params;
  return result;
};

/**
 * Build a `ParsedPlacement` from one `<r>` rendering element's attributes.
 * Handles both wire forms by reading either the prefixed (`s:ph`,
 * `s:ds`, `s:id`, `s:par`) or the canonical (`ph`, `ds`, `id`, `par`)
 * attribute name — delta-form `<r>` elements only ever carry the prefixed
 * set, canonical only the bare set, so a prefer-prefixed-then-bare lookup
 * is unambiguous.
 */
const placementFromAttributes = (attrs: Record<string, string>): ParsedPlacement => {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      if (attrs[name] !== undefined) return attrs[name];
    }
    return undefined;
  };

  const rawId = pick("s:id", "id");
  if (rawId === undefined || rawId.trim() === "") {
    throw createScaiError(
      "layout XML <r> element is missing its rendering id attribute — not a parseable placement.",
      "INPUT_INVALID"
    );
  }
  // `ph`/`s:ph` is the attribute Sitecore itself reads and writes.
  // `placeh`/`s:placeh` is accepted for back-compat: earlier scai
  // versions emitted that (bugged) name and tenants still carry it.
  const placeholderKey = pick("s:ph", "ph", "s:placeh", "placeh") ?? "";
  const uid = pick("uid");

  const placement: ParsedPlacement = {
    renderingGuid: normalizeGuid(rawId),
    placeholderKey,
    uid: uid !== undefined ? normalizeGuid(uid) : "",
  };

  const rawDs = pick("s:ds", "ds");
  if (rawDs !== undefined && rawDs.trim() !== "") {
    if (rawDs.startsWith("local:")) {
      // Page-relative datasource — `local:/Data/<slot>` is the form both
      // emitLayoutXml and XM Cloud Pages write for page-local items. The
      // recipe-level slot name is the path under the page's Data folder,
      // so the `/Data/` prefix is stripped when present (legacy
      // `local:<slot>` sentinels without it parse unchanged).
      const rawSlot = rawDs.slice("local:".length);
      placement.datasource = {
        kind: "local",
        slot: rawSlot.replace(/^\/Data\//i, ""),
      };
    } else {
      placement.datasource = { kind: "guid", guid: normalizeGuid(rawDs) };
    }
  }

  // `par` is optional in canonical form, always present (often empty) in
  // delta form — `decodeParBlob` treats an empty blob as no variant/params.
  const par = pick("s:par", "par");
  if (par !== undefined) {
    const { variant, params } = decodeParBlob(par);
    if (variant !== undefined) placement.variant = variant;
    if (params !== undefined) placement.params = params;
  }

  return placement;
};

/**
 * Parse a Sitecore layout XML string into a `ParsedLayout`.
 *
 * Auto-detects the wire form (`canonical` vs `delta`) from the root `<r>`
 * element's namespace declarations — `xmlns:p` / `p:p` is the delta
 * marker. Reads every `<r>` rendering element inside the single device
 * element in document order, groups them by `placeh`, and preserves
 * per-placeholder placement order.
 *
 * Returns an empty-placeholders `ParsedLayout` for an empty string or a
 * device shell with no renderings (a page-template standard-values layout)
 * — an empty layout is valid, not an error.
 *
 * Throws `INPUT_INVALID` only for genuinely malformed input: a string that
 * isn't a layout XML root, or an `<r>` element with no rendering id.
 */
export function parseLayoutXml(xml: string): ParsedLayout {
  const trimmed = xml.trim();
  if (trimmed === "") {
    return { placeholders: {}, mode: "canonical" };
  }

  // The root element is always `<r …>`. Isolate its start tag to read the
  // namespace declarations that distinguish the two wire forms.
  const rootTagMatch = /^<r\b([^>]*)>/.exec(trimmed);
  if (!rootTagMatch) {
    throw createScaiError(
      "string is not a Sitecore layout XML — expected a <r> root element.",
      "INPUT_INVALID"
    );
  }
  const rootAttrs = parseAttributes(`<r${rootTagMatch[1]}>`);
  // Delta form declares the `p` (parameters) namespace and carries `p:p`;
  // canonical declares the XSD/XSI schema namespaces. Default to canonical.
  const mode: "canonical" | "delta" =
    rootAttrs["xmlns:p"] !== undefined || rootAttrs["p:p"] !== undefined ? "delta" : "canonical";

  // The device element wraps every rendering. Recover its `l` (JSON
  // Layout) attribute when present — canonical-only.
  let layoutId: string | undefined;
  const deviceTagMatch = /<d\b([^>]*)>/.exec(trimmed);
  if (deviceTagMatch) {
    const deviceAttrs = parseAttributes(`<d${deviceTagMatch[1]}>`);
    if (deviceAttrs["l"] !== undefined && deviceAttrs["l"].trim() !== "") {
      layoutId = normalizeGuid(deviceAttrs["l"]);
    }
  }

  const placeholders: Record<string, ParsedPlacement[]> = {};

  // Scan every `<r …/>` (or `<r …></r>`) element that is NOT the root.
  // The root `<r>` start tag has children, so it never matches the
  // self-closing / short-form `<r …/>` pattern; the rendering elements
  // emitLayoutXml writes are always self-closing. `<p:da …/>` is the
  // delta directive element — skipped because it doesn't match `<r\b`.
  const renderingRe = /<r\b([^>]*?)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = renderingRe.exec(trimmed)) !== null) {
    const attrs = parseAttributes(`<r${match[1]}/>`);
    const placement = placementFromAttributes(attrs);
    if (placeholders[placement.placeholderKey] === undefined) {
      placeholders[placement.placeholderKey] = [];
    }
    placeholders[placement.placeholderKey].push(placement);
  }

  const result: ParsedLayout = { placeholders, mode };
  if (layoutId !== undefined) result.layoutId = layoutId;
  return result;
}

/**
 * Canonical comparable projection of a parsed layout — placeholder keys
 * sorted (key order is irrelevant), placement order preserved (it IS the
 * render order), params sorted, `uid` and `mode` dropped.
 */
const canonicalLayout = (parsed: ParsedLayout): string => {
  const placeholders = Object.keys(parsed.placeholders)
    .sort()
    .map((key) => [
      key,
      parsed.placeholders[key].map((placement) => ({
        rendering: placement.renderingGuid,
        placeholder: placement.placeholderKey,
        datasource: placement.datasource ?? null,
        variant: placement.variant ?? null,
        params: Object.fromEntries(Object.entries(placement.params ?? {}).sort()),
      })),
    ]);
  return JSON.stringify({ layoutId: parsed.layoutId ?? null, placeholders });
};

/**
 * Structural equality of two layout XML strings — the seam the planner
 * uses to decide whether a layout field genuinely drifted.
 *
 * Sitecore's layout pipeline normalises layout XML on write: canonical
 * input is rewritten to SXA delta form, and a versioned `__Final
 * Renderings` picks up extra `<p:da>` baseline directives. A naive
 * string compare of "what the recipe emits" vs "what the tenant stores"
 * then reports a phantom update on every re-push. Parsing both sides and
 * comparing the recovered structure makes the diff wire-form-agnostic —
 * same placeholders, same placements (rendering, datasource, variant,
 * params) in the same order ⇒ equivalent.
 *
 * Placement `uid`s are excluded (placement identity is positional, and
 * the uid is a deterministic derivation either way); `mode` is excluded
 * (it IS the wire-form difference being normalised away); `layoutId` IS
 * compared — it's semantically meaningful.
 *
 * Falls back to strict string equality when either side fails to parse,
 * so genuinely malformed input is never silently treated as equal.
 */
export const layoutXmlEquivalent = (a: string, b: string): boolean => {
  if (a === b) return true;
  try {
    return canonicalLayout(parseLayoutXml(a)) === canonicalLayout(parseLayoutXml(b));
  } catch {
    return false;
  }
};

/**
 * Variant of `layoutXmlEquivalent` that takes pre-parsed layouts —
 * use it when the caller already parsed both sides (the planner's
 * `computeFieldDrift` parses once for the equivalence check AND
 * once-per-side for hashing — passing the pre-parsed values dedupes
 * the regex-driven parse work on the hot path).
 */
export const layoutXmlEquivalentFromParsed = (a: ParsedLayout, b: ParsedLayout): boolean =>
  canonicalLayout(a) === canonicalLayout(b);

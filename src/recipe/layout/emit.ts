import { v5 as uuidv5 } from "uuid";

import { createCliError } from "@/shared/errors";

/**
 * Emit a Sitecore layout XML string from a structural `Layout` shape.
 *
 * Sitecore stores layout as a single XML string in the `__Renderings`
 * (shared) or `__Final Renderings` (versioned) field on any item that
 * holds a layout — pages, partial designs, page designs. This emitter
 * is the single seam that turns recipe-level structural layout into
 * that wire form. The output is deterministic given the same inputs:
 * placement UIDs derive from the parent item ID + placeholder + index +
 * componentHandle, so re-pushes produce identical XML.
 *
 * Wire format:
 *
 *   <r xmlns:xsd="..." xmlns:xsi="...">
 *     <d id="{deviceGuid}">
 *       <r id="{renderingId}" placeh="/header" ds="{datasourceId}"
 *          par="FieldNames=default&Size=lg" uid="{placementUid}" />
 *       ...
 *     </d>
 *   </r>
 *
 * Recipe → wire mapping:
 *
 *   componentHandle              → id (renderingId(handle), curly-uppercase)
 *   placeholder key (dict key)   → placeh
 *   datasourceRef.kind=shared    → ds (contentItemId(handle), curly-uppercase)
 *   datasourceRef.kind=scoped    → REJECTED for partial/page designs
 *                                  (no host page to resolve against)
 *   datasourceRef.kind=none      → no ds attribute
 *   variant                      → par (FieldNames=<variant>, URL-encoded)
 *   params                       → par (key=value pairs, URL-encoded)
 *   (parentItemId, placeholder, index, componentHandle) → uid (uuidv5)
 */

export interface ComponentPlacementInput {
  componentHandle: string;
  variant?: string;
  params?: Record<string, string>;
  datasourceRef?:
    | { kind: "shared"; handle: string }
    | { kind: "scoped"; slot: string }
    | { kind: "none" };
}

export interface LayoutInput {
  placeholders: Record<string, readonly ComponentPlacementInput[]>;
}

export interface LayoutEmitContext {
  /**
   * The Sitecore item ID this layout will live on (partial-design or
   * page-design item). Seeds deterministic placement UIDs.
   */
  parentItemId: string;
  /** Sitecore device GUID. Caller passes `DEFAULT_DEVICE_ID` from sitecore-templates.ts. */
  deviceId: string;
  /** Maps a component recipe handle to its rendering item GUID. */
  renderingIdFor: (handle: string) => string;
  /** Maps a content-item recipe handle to its content item GUID. */
  contentItemIdFor: (handle: string) => string;
  /**
   * Whether `kind: "scoped"` datasource refs are permitted. False for
   * partial-design and page-design layouts (they don't have a host page
   * to resolve scoped refs against). True will be set by Phase 5
   * `PageRecipe` compilation when scoped refs become meaningful.
   */
  allowScoped: boolean;
  /**
   * Wire form for the emitted XML.
   *
   * - `"canonical"` (default) — `<r xmlns:xsd=… xmlns:xsi=…><d><r id placeh
   *   ds par uid /></d></r>`. What our recipe inputs naturally describe.
   *   Page Design items round-trip this byte-for-byte.
   *
   * - `"delta"` — SXA Partial Design wire form: `<r xmlns:p xmlns:s
   *   p:p="1"><d><p:da name="l"/><r uid p:before|p:after s:placeh s:ds
   *   s:id s:par /></d></r>`. The Partial Design Layout pipeline
   *   normalizes canonical input INTO this form on first write, so
   *   emitting it directly means the first push round-trips and
   *   converges in one cycle. Page Design layouts must NOT use this
   *   mode (they preserve canonical and would diverge).
   */
  mode?: "canonical" | "delta";
}

const formatGuidCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

const escapeXmlAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const encodeParams = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

const placementUid = (
  parentItemId: string,
  placeholderKey: string,
  index: number,
  componentHandle: string
): string => uuidv5(`placement:${placeholderKey}:${index}:${componentHandle}`, parentItemId);

/**
 * Compiled view of a single placement, ready for either canonical or
 * delta serialization. Computed once per placement so the two emitters
 * share resolution + escaping logic.
 */
interface ResolvedPlacement {
  renderingId: string;
  uid: string;
  placeholderKey: string;
  /** Already-escaped `ds="…"` fragment, or empty string if no datasource. */
  dsAttr: string;
  /** Already-escaped + URL-encoded params string (no leading attr name). */
  parValue: string;
}

const resolvePlacement = (
  placement: ComponentPlacementInput,
  placeholderKey: string,
  index: number,
  ctx: LayoutEmitContext
): ResolvedPlacement => {
  const renderingId = formatGuidCurly(ctx.renderingIdFor(placement.componentHandle));
  const uid = formatGuidCurly(
    placementUid(ctx.parentItemId, placeholderKey, index, placement.componentHandle)
  );

  let dsAttr = "";
  if (placement.datasourceRef !== undefined) {
    switch (placement.datasourceRef.kind) {
      case "shared":
        dsAttr = ` ds="${formatGuidCurly(ctx.contentItemIdFor(placement.datasourceRef.handle))}"`;
        break;
      case "scoped":
        if (!ctx.allowScoped) {
          throw createCliError(
            `scoped datasourceRef is invalid in this layout context (no host page to resolve against). Slot: '${placement.datasourceRef.slot}'. Use 'shared' for reusable content or 'none' for config-driven renderings.`,
            "INPUT_INVALID"
          );
        }
        // Scoped resolution is a Phase 5 concern (PageRecipe). Emit
        // an explicit local-* sentinel so any premature execution
        // fails loudly with a recognizable marker.
        dsAttr = ` ds="local:${escapeXmlAttribute(placement.datasourceRef.slot)}"`;
        break;
      case "none":
        // No ds attribute — rendering is config-driven via params.
        break;
    }
  }

  const allParams: Record<string, string> = { ...(placement.params ?? {}) };
  if (placement.variant !== undefined) {
    // SXA Rendering Variant selection rides as the FieldNames
    // rendering parameter — this is the SXA convention.
    allParams.FieldNames = placement.variant;
  }
  const parValue = Object.keys(allParams).length > 0 ? encodeParams(allParams) : "";

  return { renderingId, uid, placeholderKey, dsAttr, parValue };
};

/**
 * Emit the layout XML for a `Layout` block. Returns an empty string
 * when the layout has no placements — caller decides whether to write
 * an empty `__Renderings` field or skip it.
 *
 * Mode selection (see `LayoutEmitContext.mode` JSDoc):
 *  - `"canonical"` (default) — what page-design items round-trip cleanly.
 *  - `"delta"` — SXA partial-design wire form so first push converges.
 *
 * Throws when a `kind: "scoped"` datasourceRef appears and
 * `ctx.allowScoped` is false — partial designs and page designs reject
 * scoped refs because they lack a host page.
 */
export function emitLayoutXml(layout: LayoutInput, ctx: LayoutEmitContext): string {
  const placeholderEntries = Object.entries(layout.placeholders).filter(
    ([, placements]) => placements.length > 0
  );
  if (placeholderEntries.length === 0) {
    return "";
  }

  if ((ctx.mode ?? "canonical") === "delta") {
    return emitDelta(placeholderEntries, ctx);
  }
  return emitCanonical(placeholderEntries, ctx);
}

const emitCanonical = (
  placeholderEntries: ReadonlyArray<[string, readonly ComponentPlacementInput[]]>,
  ctx: LayoutEmitContext
): string => {
  const elements: string[] = [];
  for (const [placeholderKey, placements] of placeholderEntries) {
    placements.forEach((placement, idx) => {
      const r = resolvePlacement(placement, placeholderKey, idx, ctx);
      const parAttr = r.parValue ? ` par="${escapeXmlAttribute(r.parValue)}"` : "";
      elements.push(
        `<r id="${r.renderingId}" placeh="${escapeXmlAttribute(r.placeholderKey)}"${r.dsAttr}${parAttr} uid="${r.uid}" />`
      );
    });
  }
  return `<r xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><d id="${formatGuidCurly(ctx.deviceId)}">${elements.join("")}</d></r>`;
};

/**
 * Emit SXA Partial Design delta form. Per-placeholder anchor sequence:
 *  - First placement in a placeholder: `p:before="*"` (insert before all)
 *  - Last placement (when there are 2+ placements): `p:after="*[1=2]"`
 *    (sentinel: position after a non-matching XPath = "at the end")
 *  - Middle placements: `p:after="r[@uid='<previous-uid-in-placeholder>']"`
 *
 * Single-placement placeholders only emit `p:before="*"`. Across
 * placeholders, anchor sequences are independent — each placeholder's
 * placements form their own first/middle/last sequence in the order
 * the recipe declares them. Attribute names get the `s:` prefix
 * (`s:placeh`, `s:ds`, `s:id`, `s:par`); `uid` stays unprefixed; and
 * `s:par=""` is always present (canonical form omits empty `par`).
 */
const emitDelta = (
  placeholderEntries: ReadonlyArray<[string, readonly ComponentPlacementInput[]]>,
  ctx: LayoutEmitContext
): string => {
  const elements: string[] = [`<p:da name="l" />`];
  for (const [placeholderKey, placements] of placeholderEntries) {
    let prevUid: string | null = null;
    placements.forEach((placement, idx) => {
      const r = resolvePlacement(placement, placeholderKey, idx, ctx);
      const isFirst = idx === 0;
      const isLast = idx === placements.length - 1;

      let anchorAttr: string;
      if (isFirst) {
        anchorAttr = ` p:before="*"`;
      } else if (isLast) {
        anchorAttr = ` p:after="*[1=2]"`;
      } else if (prevUid) {
        // Middle: reference the previous sibling's uid (without curlies in
        // the XPath — Sitecore writes them bare in the `r[@uid='…']` form).
        anchorAttr = ` p:after="r[@uid='${escapeXmlAttribute(prevUid)}']"`;
      } else {
        // Defensive — shouldn't be reachable since prevUid is set after idx 0.
        anchorAttr = ` p:after="*[1=2]"`;
      }

      // Convert canonical `ds="…"` → namespaced `s:ds="…"`. The dsAttr
      // string already includes a leading space + `ds=` prefix, so we
      // splice the `s:` prefix in.
      const sDsAttr = r.dsAttr ? r.dsAttr.replace(/^ ds=/, " s:ds=") : "";
      // s:par is always emitted in delta form (canonical omits empty par).
      const sParAttr = ` s:par="${escapeXmlAttribute(r.parValue)}"`;

      elements.push(
        `<r uid="${r.uid}"${anchorAttr} s:placeh="${escapeXmlAttribute(r.placeholderKey)}"${sDsAttr} s:id="${r.renderingId}"${sParAttr} />`
      );
      prevUid = r.uid;
    });
  }
  return `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${formatGuidCurly(ctx.deviceId)}">${elements.join("")}</d></r>`;
};

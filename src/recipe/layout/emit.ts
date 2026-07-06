import { v5 as uuidv5 } from "uuid";

import { createScaiError } from "@/shared/errors";

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
 *       <r id="{renderingId}" ph="/header" ds="{datasourceId}"
 *          par="FieldNames=default&Size=lg" uid="{placementUid}" />
 *       ...
 *     </d>
 *   </r>
 *
 * The placeholder attribute is `ph` (`s:ph` in delta form) — Sitecore's
 * layout engine reads exactly that name and silently ignores anything
 * else. An earlier iteration wrote `placeh`, which Sitecore stored
 * verbatim but never bound to a placeholder, so pushed pages rendered
 * empty until a first save in Pages rewrote the XML.
 *
 * Recipe → wire mapping:
 *
 *   componentHandle              → id (renderingId(handle), curly-uppercase)
 *   placeholder key (dict key)   → ph
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
  /**
   * Nested placements (schema-legal on any placement). ONLY a
   * `PageRecipe` layout can host them — `compilePageRecipe` flattens
   * the tree into concrete dynamic-placeholder keys before emission,
   * so a placement reaching this emitter with children still attached
   * is a partial-/page-design layout, which has no host page to anchor
   * the nesting. Rejected loudly rather than silently dropped.
   */
  placeholders?: Record<string, readonly ComponentPlacementInput[]>;
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
   * to resolve scoped refs against); `PageRecipe` sets it true.
   */
  allowScoped: boolean;
  /**
   * Resolver for `kind: "scoped"` datasource refs — maps a placement's
   * `slot` to the GUID of the page-local datasource item the caller
   * materialises at `<page>/Data/<slot>`; the scoped `<r>` element then
   * carries `ds="{resolvedGuid}"`.
   *
   * When `allowScoped` is true but this is absent, a scoped ref emits
   * the page-relative `ds="local:/Data/<slot>"` form — the wire form
   * XM Cloud Pages itself writes for page-local datasources (resolved
   * against the context item at render time, and re-pointed for free
   * when a page is copied). `PageRecipe` layouts use this form; the
   * GUID resolver remains for callers that need absolute references.
   */
  scopedDatasourceIdFor?: (slot: string) => string;
  /**
   * Wire form for the emitted XML.
   *
   * - `"canonical"` (default) — `<r xmlns:xsd=… xmlns:xsi=…><d><r id ph
   *   ds par uid /></d></r>`. What our recipe inputs naturally describe.
   *   Page Design items round-trip this byte-for-byte.
   *
   * - `"delta"` — the SXA delta wire form: `<r xmlns:p xmlns:s
   *   p:p="1"><d><r uid p:before|p:after s:ph s:ds s:id s:par
   *   /></d></r>`, merged over the base layout (a page's template
   *   standard values; a partial design's inherited layout) by
   *   Sitecore's XmlDeltas at read time. This is the form XM Cloud
   *   Pages writes to `__Final Renderings` on every author save, so
   *   emitting it directly means the first push round-trips and
   *   converges in one cycle. Page Design layouts must NOT use this
   *   mode (they preserve canonical and would diverge).
   */
  mode?: "canonical" | "delta";
  /**
   * Whether delta mode emits the `<p:da name="l" />` device-attributes
   * directive as the first child of `<d>`. Defaults to true — the form
   * the SXA Partial Design pipeline round-trips. Page `__Final
   * Renderings` deltas must pass false: operator-verified Pages-authored
   * deltas never carry the directive, and the page inherits its
   * `l="{JSON layout}"` pointer from the template's standard values.
   * Ignored in canonical mode.
   */
  deltaDeviceDirective?: boolean;
  /**
   * Optional resolver mapping (componentHandle, variantName) to the
   * headless Variant Definition item's refKey GUID. When it returns a
   * GUID, the placement's `FieldNames` rendering parameter carries the
   * curly-braced GUID — the form XM Cloud Pages writes, which its
   * variant picker displays as the selection and the layout service
   * resolves back to the variant item's NAME for the front end's
   * export lookup. When absent (or when it returns undefined — e.g.
   * the component recipe doesn't declare the variant, so no Variant
   * Definition item exists to reference), `FieldNames` falls back to
   * the raw variant name, which the layout service passes through
   * unresolved and the front end matches by name directly.
   */
  variantRefFor?: (componentHandle: string, variantName: string) => string | undefined;
  /**
   * SXA JSON Layout definition GUID. When set, the device element
   * carries an `l="{layoutId}"` attribute — `<d id="{device}"
   * l="{layout}">…</d>` — and `emitLayoutXml` emits the wrapper shell
   * even when there are zero placements (a page-template `__Standard
   * Values` layout: device + JSON-layout pointer, no renderings). Used
   * only in `"canonical"` mode; `"delta"` ignores it. When unset, the
   * device element has no `l` attribute (partial / page-design layouts).
   */
  layoutId?: string;
}

const formatGuidCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

const escapeXmlAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

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
  if (placement.placeholders && Object.keys(placement.placeholders).length > 0) {
    throw createScaiError(
      `Placement '${placement.componentHandle}' in placeholder '${placeholderKey}' carries nested placeholders, which this layout context cannot host.`,
      "INPUT_INVALID",
      {
        hint: "Nested placements are only valid in a PageRecipe layout (the page compiler flattens them into dynamic-placeholder keys). Partial-design and page-design layouts must place components flat.",
      }
    );
  }
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
          throw createScaiError(
            `scoped datasourceRef is invalid in this layout context (no host page to resolve against). Slot: '${placement.datasourceRef.slot}'. Use 'shared' for reusable content or 'none' for config-driven renderings.`,
            "INPUT_INVALID"
          );
        }
        if (ctx.scopedDatasourceIdFor) {
          // Absolute form — the GUID of the item the caller materialises
          // at `<page>/Data/<slot>`.
          dsAttr = ` ds="${formatGuidCurly(ctx.scopedDatasourceIdFor(placement.datasourceRef.slot))}"`;
        } else {
          // Page-relative form — what XM Cloud Pages itself writes for
          // page-local datasources. Resolved against the context item at
          // render time; survives page copy without re-pointing.
          dsAttr = ` ds="local:/Data/${escapeXmlAttribute(placement.datasourceRef.slot)}"`;
        }
        break;
      case "none":
        // No ds attribute — rendering is config-driven via params.
        break;
    }
  }

  const allParams: Record<string, string> = { ...(placement.params ?? {}) };
  if (placement.variant !== undefined) {
    // SXA Rendering Variant selection rides as the FieldNames
    // rendering parameter — as the Variant Definition item's GUID when
    // one exists (Pages' own convention; its picker needs the item
    // reference), by name otherwise (front-end export lookup matches
    // the raw name).
    const variantRef = ctx.variantRefFor?.(placement.componentHandle, placement.variant);
    allParams.FieldNames = variantRef ? formatGuidCurly(variantRef) : placement.variant;
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
  // With `layoutId` set the caller wants the device+layout shell even
  // when empty (a page-template standard-values layout). Otherwise an
  // empty layout emits nothing — the caller decides whether to skip the
  // field write.
  if (placeholderEntries.length === 0 && ctx.layoutId === undefined) {
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
        `<r id="${r.renderingId}" ph="${escapeXmlAttribute(r.placeholderKey)}"${r.dsAttr}${parAttr} uid="${r.uid}" />`
      );
    });
  }
  const layoutAttr = ctx.layoutId ? ` l="${formatGuidCurly(ctx.layoutId)}"` : "";
  return `<r xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><d id="${formatGuidCurly(ctx.deviceId)}"${layoutAttr}>${elements.join("")}</d></r>`;
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
 * (`s:ph`, `s:ds`, `s:id`, `s:par`); `uid` stays unprefixed; and
 * `s:par=""` is always present (canonical form omits empty `par`).
 */
const emitDelta = (
  placeholderEntries: ReadonlyArray<[string, readonly ComponentPlacementInput[]]>,
  ctx: LayoutEmitContext
): string => {
  const elements: string[] = (ctx.deltaDeviceDirective ?? true) ? [`<p:da name="l" />`] : [];
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
        `<r uid="${r.uid}"${anchorAttr} s:ph="${escapeXmlAttribute(r.placeholderKey)}"${sDsAttr} s:id="${r.renderingId}"${sParAttr} />`
      );
      prevUid = r.uid;
    });
  }
  return `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${formatGuidCurly(ctx.deviceId)}">${elements.join("")}</d></r>`;
};

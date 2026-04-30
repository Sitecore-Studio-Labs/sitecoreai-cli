import { v5 as uuidv5 } from "uuid";

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
 * Emit the layout XML for a `Layout` block. Returns an empty string
 * when the layout has no placements — caller decides whether to write
 * an empty `__Renderings` field or skip it.
 *
 * Throws when a `kind: "scoped"` datasourceRef appears and
 * `ctx.allowScoped` is false — partial designs and page designs reject
 * scoped refs because they lack a host page.
 */
export function emitLayoutXml(layout: LayoutInput, ctx: LayoutEmitContext): string {
  const elements: string[] = [];

  for (const [placeholderKey, placements] of Object.entries(layout.placeholders)) {
    placements.forEach((placement, idx) => {
      const renderingId = formatGuidCurly(ctx.renderingIdFor(placement.componentHandle));
      const uid = formatGuidCurly(
        placementUid(ctx.parentItemId, placeholderKey, idx, placement.componentHandle)
      );

      let dsAttr = "";
      if (placement.datasourceRef !== undefined) {
        switch (placement.datasourceRef.kind) {
          case "shared":
            dsAttr = ` ds="${formatGuidCurly(ctx.contentItemIdFor(placement.datasourceRef.handle))}"`;
            break;
          case "scoped":
            if (!ctx.allowScoped) {
              throw new Error(
                `scoped datasourceRef is invalid in this layout context (no host page to resolve against). Slot: '${placement.datasourceRef.slot}'. Use 'shared' for reusable content or 'none' for config-driven renderings.`
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
      const parAttr =
        Object.keys(allParams).length > 0
          ? ` par="${escapeXmlAttribute(encodeParams(allParams))}"`
          : "";

      elements.push(
        `<r id="${renderingId}" placeh="${escapeXmlAttribute(placeholderKey)}"${dsAttr}${parAttr} uid="${uid}" />`
      );
    });
  }

  if (elements.length === 0) {
    return "";
  }

  return `<r xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><d id="${formatGuidCurly(ctx.deviceId)}">${elements.join("")}</d></r>`;
}

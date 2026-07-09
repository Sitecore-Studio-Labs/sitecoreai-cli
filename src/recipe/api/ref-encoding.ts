import { createScaiError } from "@/shared/errors";
import type { RefValue } from "../ir/operations";
import { renderSourceFields } from "../schema/source-fields";

/**
 * Render a typed `RefValue` to the canonical Sitecore string form.
 *
 * Sitecore field storage is always a string — the `RefValue` discriminator
 * tells us *how* to serialize that string for Sitecore to understand it.
 * See `plans/sitecore-relationships.md` (Reference encoding patterns) for
 * the per-pattern serialization rules.
 *
 * `ref-recipe` / `ref-recipe-list` cannot be rendered directly — the
 * executor must resolve their `refKey` against the per-run captured-itemId
 * map first (see `resolveRecipeRefs` below). Calling `renderRefValue` on
 * an unresolved recipe-ref is a programmer error.
 */
export const renderRefValue = (value: RefValue): string => {
  switch (value.kind) {
    case "string":
      return value.value;
    case "bool":
      return value.value ? "1" : "0";
    case "number":
      return String(value.value);
    case "ref-guid":
      return toCurly(value.value);
    case "ref-guid-list":
      return value.values.map(toCurly).join("|");
    case "ref-recipe":
    case "ref-recipe-list":
    case "ref-source-fields":
    case "media-xml-ref":
      throw createScaiError(
        `Unresolved ${value.kind} cannot be rendered — call resolveRecipeRefs first.`,
        "UNKNOWN"
      );
    case "ref-path":
      return value.value;
    case "query":
      return value.value;
    case "url-string-map":
      return Object.entries(value.entries)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
    default: {
      const exhaustive: never = value;
      throw createScaiError(`Unhandled RefValue kind: ${JSON.stringify(exhaustive)}`, "UNKNOWN");
    }
  }
};

/** Dashed-GUID token, optionally curly-braced, anywhere in a string. */
const GUID_TOKEN_RE =
  /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;

/**
 * Substitute recipe-internal refKey GUIDs EMBEDDED IN A STRING with their
 * captured tenant itemIds.
 *
 * Layout XML (`__Renderings` / `__Final Renderings`) is compiled to a
 * plain string with `renderingId(site, handle)` / `contentItemId(...)` /
 * `variantId(...)` uuidv5 refKeys baked in — but the Authoring API mints
 * its own item ids at create time (`CreateItemInput` carries no id), so
 * those refKeys never match anything on the tenant. Every GUID-shaped
 * token in the string is looked up in the captured map: hits are
 * replaced with the real (dashed, uppercase) tenant id, misses pass
 * through untouched — real Sitecore constants (device ids, the JSON
 * layout definition) and tenant-pre-existing GUIDs are never in the
 * captured map, so they survive verbatim. A uuidv5 refKey colliding
 * with an unrelated real GUID is cryptographically negligible.
 */
export const substituteCapturedGuids = (
  text: string,
  capturedItemIds: ReadonlyMap<string, string>
): string => {
  if (capturedItemIds.size === 0 || !text.includes("-")) return text;
  return text.replace(GUID_TOKEN_RE, (token) => {
    const braced = token.startsWith("{");
    // Tokens with exactly one brace are malformed — leave them alone.
    if (braced !== token.endsWith("}")) return token;
    const captured = capturedItemIds.get(dashifyGuid(token.replace(/[{}]/g, "")));
    if (!captured) return token;
    const dashed = dashifyGuid(captured).toUpperCase();
    return braced ? `{${dashed}}` : dashed;
  });
};

/**
 * Hotlink fallback for a `media-xml-ref` whose producer `MediaUpload`
 * failed to source its bytes from an EXTERNAL URL (dead link, blocked
 * host, transient 5xx). Keyed by the MediaUpload op's refKey; populated
 * by `planMediaUpload` when it marks the upload `error`. The resolver
 * degrades the referencing field to the legacy `<image src="…" />` form
 * instead of aborting the whole recipe — imagery is progressive
 * enhancement, so hotlinking stays the fallback when ingest fails.
 * Asset-source (repo-local file) failures never populate this map: a
 * missing checked-in asset is an authoring bug and must keep failing
 * hard via the resolver throw below.
 */
export interface MediaFallback {
  url: string;
  alt?: string;
}

const escapeXmlAttr = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * The legacy hotlink image XML (`<image src="…" alt="…" />`). Known
 * trade-off: the `src=` form shows in Pages' field editor but does not
 * render via the Layout Service — an author can re-pick the image. It
 * is still strictly better than losing the whole page install.
 */
export const renderMediaFallbackXml = (fallback: MediaFallback): string => {
  const attrs = [`src="${escapeXmlAttr(fallback.url)}"`];
  if (fallback.alt !== undefined) attrs.push(`alt="${escapeXmlAttr(fallback.alt)}"`);
  return `<image ${attrs.join(" ")} />`;
};

/**
 * Substitute every `ref-recipe` / `ref-recipe-list` against the captured
 * Sitecore itemId map. Returns a new `RefValue` with `ref-guid` /
 * `ref-guid-list` in their place. Throws when a refKey is missing — that
 * indicates a topological ordering bug (executor referenced an item that
 * hadn't been created yet).
 *
 * `string` values are scanned for embedded refKey GUIDs (see
 * `substituteCapturedGuids`) — the seam that makes compile-time layout
 * XML resolve against server-assigned item ids.
 *
 * `mediaFallbacks` (optional) degrades `media-xml-ref` misses whose
 * producer `MediaUpload` failed on an external URL — see
 * {@link MediaFallback}. A miss with NEITHER capture nor fallback is a
 * real producer/ordering bug and keeps throwing.
 */
export const resolveRecipeRefs = (
  value: RefValue,
  capturedItemIds: ReadonlyMap<string, string>,
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>
): RefValue => {
  switch (value.kind) {
    case "string": {
      const substituted = substituteCapturedGuids(value.value, capturedItemIds);
      return substituted === value.value ? value : { kind: "string", value: substituted };
    }
    case "ref-recipe": {
      const itemId = capturedItemIds.get(value.refKey);
      if (itemId) return { kind: "ref-guid", value: itemId };
      // Pass-through: when a refKey isn't in the captured map but looks
      // like a literal Sitecore GUID (e.g. `SITECORE_TEMPLATES.FOLDER`
      // baked into an aggregator's ref-recipe list), treat it as a
      // literal rather than failing. Recipe-internal refKeys are also
      // valid GUIDs in shape, so this is purely a fallback for items
      // that don't get produced by sibling CreateItem ops — built-in
      // templates, tenant-pre-existing items.
      if (isGuid(value.refKey)) {
        return { kind: "ref-guid", value: value.refKey };
      }
      throw createScaiError(
        `ref-recipe refKey ${value.refKey} not in captured map — was the producing CreateItem op skipped or did it run after this op?`,
        "UNKNOWN"
      );
    }
    case "ref-recipe-list": {
      const guids: string[] = [];
      for (const refKey of value.refKeys) {
        const itemId = capturedItemIds.get(refKey);
        if (itemId) {
          guids.push(itemId);
          continue;
        }
        // Same pass-through as `ref-recipe` above — built-in Sitecore
        // template constants and tenant-pre-existing items appear in
        // aggregator ref-recipe-list values; honour them as literals.
        if (isGuid(refKey)) {
          guids.push(refKey);
          continue;
        }
        if (value.tolerateMissing) continue;
        throw createScaiError(
          `ref-recipe-list refKey ${refKey} not in captured map — was the producing CreateItem op skipped or did it run after this op?`,
          "UNKNOWN"
        );
      }
      return { kind: "ref-guid-list", values: guids };
    }
    case "ref-source-fields": {
      // Structured source fields with recipe-handle references in
      // `sourceTypes`. Resolve each handle to its captured Sitecore
      // itemId, then render. Recipe handles map to refKeys via
      // `templateId(site, handle)`, which the planner registers when the
      // referenced template's CreateItem op completes. The site name is
      // embedded on the value at compile time — the encoder can't otherwise
      // know which site the recipe set was compiled under.
      const rendered = renderSourceFields(
        {
          sourceTypes: value.sourceTypes,
          sourceQuery: value.sourceQuery,
          sourceScope: value.sourceScope,
        },
        (handle) => {
          const refKey = templateIdForHandle(value.site, handle);
          const itemId = capturedItemIds.get(refKey);
          if (!itemId) {
            throw createScaiError(
              `ref-source-fields references handle '${handle}' (refKey ${refKey}); not yet in captured map.`,
              "UNKNOWN"
            );
          }
          return itemId;
        }
      );
      // sourceTypes is non-empty in this branch (IR validation), so
      // renderSourceFields always returns a string.
      return { kind: "string", value: rendered as string };
    }
    case "media-xml-ref": {
      // Resolve the recipe-internal refKey for an uploaded media item
      // to its server-assigned Sitecore itemId, then wrap as the SXA
      // media-XML reference encoding (`<image mediaid="{GUID}" />`).
      // The `__Thumbnail` field — and any other Thumbnail-typed field —
      // only resolves the media item correctly when the value is this
      // XML wrapper; a raw GUID silently no-ops.
      //
      // Populated by `MediaUploadOp`'s apply step (sub-milestone E,
      // 2026-06-06): the executor stamps the server-assigned media
      // itemId into `capturedItemIds[op.id]` after the presigned-URL
      // POST resolves. A miss here means the producer `MediaUploadOp`
      // didn't run (or ran-and-skipped without capturing) — surface a
      // clear error so operators see the gap rather than a silent
      // empty `__Thumbnail`.
      const itemId = capturedItemIds.get(value.refKey);
      if (!itemId) {
        // Graceful degrade: the producer MediaUpload failed to source
        // its bytes from an EXTERNAL URL and registered a hotlink
        // fallback. Emit the legacy `<image src="…" />` form so one
        // dead image URL degrades that one field instead of killing
        // the entire page install. Asset-source failures never register
        // a fallback, so they (and genuine ordering bugs) still throw.
        const fallback = mediaFallbacks?.get(value.refKey);
        if (fallback) {
          return { kind: "string", value: renderMediaFallbackXml(fallback) };
        }
        throw createScaiError(
          `media-xml-ref refKey ${value.refKey} not in captured map — the producer MediaUploadOp didn't capture an itemId for this push. Check the plan/event stream for the upstream MediaUpload op's outcome.`,
          "UNKNOWN"
        );
      }
      const curly = `{${dashifyGuid(itemId).toUpperCase()}}`;
      return { kind: "string", value: `<image mediaid="${curly}" />` };
    }
    default:
      return value;
  }
};

// Re-import here to avoid a circular dep with `guids.ts → ir/operations`.
// `templateId` is a pure uuidv5 derivation; importing it lazily keeps the
// resolver self-contained.
import { templateId as templateIdForHandle } from "../items/guids";

/**
 * Normalise a Sitecore itemId to the canonical 8-4-4-4-12 dashed
 * form. Authoring GraphQL returns IDs without dashes
 * (`825b30b4b40b422e992023a1b6bda89c`), but Sitecore's Treelist
 * field-value parser only resolves IDs in dashed form
 * (`{825B30B4-B40B-422E-9920-23A1B6BDA89C}`). Without this, multilist
 * field values written by `toCurly` come out as `{NODASH}` and the
 * editor renders "Item not found" for every entry even though the
 * items exist.
 *
 * Returns input unchanged (lowercased) when the value isn't a 32-hex
 * GUID — defensive against ref values that aren't actual itemIds.
 */
export const dashifyGuid = (guid: string): string => {
  const compact = guid.replace(/[{}-]/g, "").toLowerCase();
  if (compact.length !== 32) return guid.toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
};

/**
 * True when the string is a valid Sitecore item GUID — 32 hex chars,
 * with or without dashes, with or without curly braces. Used by the
 * `ref-recipe` / `ref-recipe-list` resolvers to pass through literal
 * GUIDs (built-in Sitecore template constants, tenant-pre-existing
 * items) that aren't produced by sibling CreateItem ops.
 */
const isGuid = (s: string): boolean => {
  const compact = s.replace(/[{}-]/g, "");
  return compact.length === 32 && /^[0-9a-fA-F]{32}$/.test(compact);
};

const toCurly = (guid: string): string => `{${dashifyGuid(guid).toUpperCase()}}`;

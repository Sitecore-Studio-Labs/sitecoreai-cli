import { createCliError } from "@/shared/errors";
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
      throw createCliError(
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
      throw createCliError(`Unhandled RefValue kind: ${JSON.stringify(exhaustive)}`, "UNKNOWN");
    }
  }
};

/**
 * Substitute every `ref-recipe` / `ref-recipe-list` against the captured
 * Sitecore itemId map. Returns a new `RefValue` with `ref-guid` /
 * `ref-guid-list` in their place. Throws when a refKey is missing — that
 * indicates a topological ordering bug (executor referenced an item that
 * hadn't been created yet).
 */
export const resolveRecipeRefs = (
  value: RefValue,
  capturedItemIds: ReadonlyMap<string, string>
): RefValue => {
  switch (value.kind) {
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
      throw createCliError(
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
        throw createCliError(
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
            throw createCliError(
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
    default:
      return value;
  }
};

// Re-import here to avoid a circular dep with `guids.ts → ir/operations`.
// `templateId` is a pure uuidv5 derivation; importing it lazily keeps the
// resolver self-contained.
import { templateId as templateIdForHandle } from "../guids";

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

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
      throw new Error(
        `Unresolved ${value.kind} cannot be rendered — call resolveRecipeRefs first.`
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
      throw new Error(`Unhandled RefValue kind: ${JSON.stringify(exhaustive)}`);
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
      if (!itemId) {
        throw new Error(
          `ref-recipe refKey ${value.refKey} not in captured map — was the producing CreateItem op skipped or did it run after this op?`
        );
      }
      return { kind: "ref-guid", value: itemId };
    }
    case "ref-recipe-list": {
      const guids: string[] = [];
      for (const refKey of value.refKeys) {
        const itemId = capturedItemIds.get(refKey);
        if (!itemId) {
          throw new Error(
            `ref-recipe-list refKey ${refKey} not in captured map — was the producing CreateItem op skipped or did it run after this op?`
          );
        }
        guids.push(itemId);
      }
      return { kind: "ref-guid-list", values: guids };
    }
    case "ref-source-fields": {
      // Structured source fields with recipe-handle references in
      // `sourceTypes`. Resolve each handle to its captured Sitecore
      // itemId, then render. Recipe handles map to refKeys via
      // `templateId(handle)`, which the planner registers when the
      // referenced template's CreateItem op completes.
      const rendered = renderSourceFields(
        {
          sourceTypes: value.sourceTypes,
          sourceQuery: value.sourceQuery,
          sourceScope: value.sourceScope,
        },
        (handle) => {
          const refKey = templateIdForHandle(handle);
          const itemId = capturedItemIds.get(refKey);
          if (!itemId) {
            throw new Error(
              `ref-source-fields references handle '${handle}' (refKey ${refKey}); not yet in captured map.`
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

const toCurly = (guid: string): string => `{${guid.toUpperCase()}}`;

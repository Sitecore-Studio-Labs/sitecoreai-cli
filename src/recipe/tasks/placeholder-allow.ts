/**
 * Placeholder allow-controls resolver — runs after `runRecipePush`'s
 * IR loop to register each recipe's rendering with the SXA placeholder
 * slots it declares compatibility with.
 *
 * Why this lives outside the IR pipeline: scai's IR ops target items
 * by recipe-internal refKey or known content-tree path. Placeholder
 * Settings items are looked up by their `Placeholder Key` *field
 * value*, which the compiler can't know in advance — different
 * tenants name their placeholder items differently while sharing the
 * same key. So this step does a runtime walk of the configured roots
 * and matches by field, then updates `Allowed Controls` directly via
 * the Authoring API.
 *
 * Idempotent: existing entries on `Allowed Controls` are preserved;
 * we only append IDs that aren't already there. Safe to re-run.
 */

import type { AuthoringApiClient, RemoteItem } from "../api/client";
import { dashifyGuid } from "../api/ref-encoding";
import {
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_TEMPLATE_ID,
} from "../ir/sitecore-templates";
import type { ComponentTemplateRecipe, Recipe } from "../schema/recipe";

const joinPath = (parent: string, name: string): string =>
  parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;

const isPlaceholder = (item: RemoteItem): boolean =>
  normaliseGuid(item.templateId) === normaliseGuid(PLACEHOLDER_TEMPLATE_ID);

const normaliseGuid = (guid: string): string =>
  guid.replace(/[{}-]/g, "").toLowerCase();

const toCurly = (guid: string): string => `{${dashifyGuid(guid).toUpperCase()}}`;

/**
 * Look up the rendering's itemId for a component-template recipe.
 * Mirrors the path the recipe push compiler emits at:
 *   `<renderingsRoot>/<section>/<recipe.name>` (when section is set)
 *   `<renderingsRoot>/<recipe.name>` (legacy flat layout)
 *
 * Returns null when the rendering item isn't on the tenant — usually
 * because the recipe's IR aborted before creating it. The caller skips
 * that recipe instead of failing the whole resolver.
 */
const resolveRenderingItemId = async (
  client: AuthoringApiClient,
  renderingsRoot: string,
  recipe: ComponentTemplateRecipe,
  sectionName: string | undefined,
): Promise<string | null> => {
  const path = sectionName
    ? joinPath(joinPath(renderingsRoot, sectionName), recipe.name)
    : joinPath(renderingsRoot, recipe.name);
  const item = await client.getItem({ path });
  return item ? item.itemId : null;
};

/**
 * Walk the configured Placeholder Settings roots once and collect
 * every Placeholder item with its `Placeholder Key` value. Doesn't
 * filter — callers match keys against this collected list. Recursive
 * so nested folders (Partial Design / Page Designs / Container 70 /
 * etc.) are all visited.
 */
const collectPlaceholders = async (
  client: AuthoringApiClient,
  roots: readonly string[],
): Promise<Array<{ item: RemoteItem; placeholderKey: string }>> => {
  const found: Array<{ item: RemoteItem; placeholderKey: string }> = [];
  const visit = async (path: string): Promise<void> => {
    const item = await client.getItem({ path });
    if (!item) return;
    if (isPlaceholder(item)) {
      const keyField = item.fields.find(
        (f) =>
          normaliseGuid(f.fieldId) ===
          normaliseGuid(PLACEHOLDER_FIELDS.PLACEHOLDER_KEY),
      );
      const placeholderKey = keyField?.value?.trim();
      if (placeholderKey) {
        found.push({ item, placeholderKey });
      }
      // A Placeholder item may itself contain children (e.g. a default
      // Allowed Controls subtree). Recurse anyway — cheap, and safer
      // than assuming leaf-only.
    }
    const children = await client.getChildren({ path });
    for (const child of children) {
      await visit(child.path);
    }
  };
  for (const root of roots) {
    await visit(root);
  }
  return found;
};

const findAllowedControlsValue = (item: RemoteItem): string => {
  const field = item.fields.find(
    (f) =>
      normaliseGuid(f.fieldId) ===
      normaliseGuid(PLACEHOLDER_FIELDS.ALLOWED_CONTROLS),
  );
  return field?.value ?? "";
};

const splitMultilist = (value: string): string[] =>
  value
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const mergeAllowedControls = (
  existing: string,
  toAdd: readonly string[],
): { value: string; added: number } => {
  // Normalise existing entries to dashed-curly form so de-dup works
  // regardless of what shape was previously stored (some tools write
  // `{NODASH}`, others `{DASHED}`). Final value uses dashed-curly
  // only — that's what Sitecore's Treelist resolver expects.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of splitMultilist(existing)) {
    const canonical = toCurly(entry);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  let added = 0;
  for (const itemId of toAdd) {
    const canonical = toCurly(itemId);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
    added += 1;
  }
  return { value: result.join("|"), added };
};

export interface PlaceholderAllowResult {
  /** Number of placeholder items whose Allowed Controls field was updated. */
  patched: number;
  /** Number of `(placeholder, rendering)` pairs added across all updates. */
  totalAdded: number;
  /** Recipe handles whose rendering item couldn't be resolved on the tenant. */
  unresolvedRecipeHandles: string[];
  /** Recipe placeholder keys with no matching Placeholder item under any root. */
  unmatchedPlaceholderKeys: string[];
}

export interface PlaceholderAllowOptions {
  client: AuthoringApiClient;
  recipes: readonly Recipe[];
  renderingsRoot: string;
  placeholderSettingsRoots: readonly string[];
  /** When false, plan but do not write. */
  apply: boolean;
  /** Per-update progress hook. Called with placeholder path + how many entries were added. */
  onUpdate?: (placeholderPath: string, added: number) => void;
}

/**
 * Resolve every component-template recipe's `placeholders` declarations
 * against the tenant and append the recipe's rendering itemId to each
 * matching `Allowed Controls` field. Returns a summary so callers can
 * surface the resolver's reach in their command output.
 *
 * Failure modes (each surfaced in the result, none fatal):
 *   - Rendering item missing on tenant → recipe handle in
 *     `unresolvedRecipeHandles`; that recipe's placeholders are skipped.
 *   - Placeholder key never matched → key in `unmatchedPlaceholderKeys`;
 *     other matches still apply.
 */
export const applyPlaceholderAllowControls = async (
  options: PlaceholderAllowOptions,
): Promise<PlaceholderAllowResult> => {
  const { client, recipes, renderingsRoot, placeholderSettingsRoots, apply, onUpdate } =
    options;

  // Build the section handle → name map so we can resolve each
  // component's `section.handle` to a name for the rendering path.
  const sectionsByHandle = new Map<string, string>();
  for (const recipe of recipes) {
    if (recipe.kind === "component-section") {
      sectionsByHandle.set(recipe.handle, recipe.name);
    }
  }

  // Collect: placeholderKey → Set<renderingItemId>
  const keyToRenderings = new Map<string, Set<string>>();
  const unresolvedRecipeHandles: string[] = [];
  for (const recipe of recipes) {
    if (recipe.kind !== "component-template") continue;
    // `placedIn` is the placement allow-list — placeholder keys this
    // rendering can be placed into. Distinct from `placeholders`, which
    // is for slots this component DEFINES (handled elsewhere).
    const keys = recipe.placedIn ?? [];
    if (keys.length === 0) continue;
    const sectionName = recipe.section
      ? sectionsByHandle.get(recipe.section.handle)
      : undefined;
    const renderingItemId = await resolveRenderingItemId(
      client,
      renderingsRoot,
      recipe,
      sectionName,
    );
    if (!renderingItemId) {
      unresolvedRecipeHandles.push(recipe.handle);
      continue;
    }
    for (const key of keys) {
      let bucket = keyToRenderings.get(key);
      if (!bucket) {
        bucket = new Set();
        keyToRenderings.set(key, bucket);
      }
      bucket.add(renderingItemId);
    }
  }
  if (keyToRenderings.size === 0) {
    return {
      patched: 0,
      totalAdded: 0,
      unresolvedRecipeHandles,
      unmatchedPlaceholderKeys: [],
    };
  }

  if (placeholderSettingsRoots.length === 0) {
    // Recipes asked for placeholder registration but no roots are
    // configured — surface that as "every requested key unmatched"
    // so the caller's summary makes the gap visible.
    return {
      patched: 0,
      totalAdded: 0,
      unresolvedRecipeHandles,
      unmatchedPlaceholderKeys: Array.from(keyToRenderings.keys()),
    };
  }

  const placeholders = await collectPlaceholders(client, placeholderSettingsRoots);

  const matchedKeys = new Set<string>();
  let patched = 0;
  let totalAdded = 0;
  for (const { item, placeholderKey } of placeholders) {
    const renderings = keyToRenderings.get(placeholderKey);
    if (!renderings) continue;
    matchedKeys.add(placeholderKey);
    const existing = findAllowedControlsValue(item);
    const merged = mergeAllowedControls(existing, Array.from(renderings));
    if (merged.added === 0 && merged.value === existing) continue;
    if (apply) {
      await client.updateItem({
        itemId: item.itemId,
        fields: [
          {
            fieldId: PLACEHOLDER_FIELDS.ALLOWED_CONTROLS,
            fieldName: "Allowed Controls",
            value: { kind: "string", value: merged.value },
          },
        ],
      });
    }
    onUpdate?.(item.path, merged.added);
    patched += 1;
    totalAdded += merged.added;
  }

  const unmatchedPlaceholderKeys: string[] = [];
  for (const key of keyToRenderings.keys()) {
    if (!matchedKeys.has(key)) unmatchedPlaceholderKeys.push(key);
  }

  return { patched, totalAdded, unresolvedRecipeHandles, unmatchedPlaceholderKeys };
};

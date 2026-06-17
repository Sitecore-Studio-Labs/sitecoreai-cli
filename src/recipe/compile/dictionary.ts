import { createScaiError } from "@/shared/errors";
import { trimEndChar } from "@/shared/strings";
import { dictionaryFolderId, dictionaryPhraseId } from "../items/guids";
import {
  type CreateItemOp,
  type Operation,
  type OperationIr,
  OperationIrSchema,
  type SetFieldOp,
} from "../ir/operations";
import { defaultPolicyForRecipe } from "../runtime/policy";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VERSION,
  DICTIONARY_ENTRY_FIELDS,
  DICTIONARY_TEMPLATE_PATHS,
  SYSTEM_FIELDS,
} from "../ir/sitecore-templates";
import { type DictionaryRecipe, DictionaryRecipeSchema, type Recipe } from "../schema/recipe";
import { joinPath, versionedField, type CompileContext } from "./shared";

/**
 * Compile a `DictionaryRecipe` to an Operation IR.
 *
 * Lands ONE Dictionary Folder item at
 * `<sitePath>/Dictionary/<recipe.name>/` plus ONE Dictionary Entry
 * child per `phrases[*]` key. Each Entry carries:
 *
 *   - The `Key` field — equals the phrase key (stable identifier
 *     consuming components reference). Shared field.
 *   - The `Phrase` field — versioned: one item version per locale
 *     present on the phrase (`primaryLocale` from `defaultValue`,
 *     plus every locale in `phrases[*].translations`).
 *   - A `__Help text` (description) shared field — optional, sourced
 *     from `phrases[*].description`. Translator-facing context only.
 *
 * **Host-site resolution.** `recipe.site` is a HandleString pointing
 * at a `SiteRecipe`. The compile context's `sitesByHandle` map
 * resolves that handle to the host SiteRecipe; the dictionary's
 * content-tree path is composed from the host site's resolved
 * `<collectionPath>/<siteName>` shape (same logic
 * `compileSiteRecipe`'s `resolveSiteContentTreePath` uses). Standalone
 * callers without `sitesByHandle` get an INPUT_INVALID error pointing
 * at the missing wiring.
 *
 * **Why `Dictionary Folder` + `Dictionary Entry` templates use
 * `ref-path` `templateOf`.** Sub-milestone A's introspection focused
 * on Module / SiteTemplate GUIDs; the Dictionary template GUIDs were
 * NOT captured. Using path-based template refs keeps the compile
 * honest (no guessed GUIDs) and shifts verification to first-push
 * integration time — the executor resolves the path once via
 * `getItemsByPaths` and substitutes the actual GUID before issuing
 * CreateItem.
 *
 * **Phrase-key stability contract.** The recipe's `phrases` key (and
 * the Entry item's `Key` field) is the stable identifier. Renaming a
 * key breaks every consuming component (registry-side `TextSource`
 * refs + Sitecore field values that pinned the key). Add new keys
 * freely; never repurpose an existing one for a different meaning.
 */
export function compileDictionaryRecipe(
  input: DictionaryRecipe,
  context: CompileContext
): OperationIr {
  const recipe = DictionaryRecipeSchema.parse(input);

  const sitePath = resolveHostSitePath(recipe, context);
  if (!sitePath) {
    throw createScaiError(
      `compileDictionaryRecipe requires the host SiteRecipe '${recipe.site}' to be in the recipe set (or to be pre-seeded via context.sitesByHandle / context.crossRecipeSitePaths). Dictionary '${recipe.handle}' has no resolvable content-tree path.`,
      "INPUT_INVALID",
      {
        hint:
          "Add the SiteRecipe with handle '" +
          recipe.site +
          "' to the same `compileRecipeSet` call, or set `context.crossRecipeSitePaths` so the dictionary can compose `<sitePath>/Dictionary/<recipe.name>`.",
      }
    );
  }

  const policy = defaultPolicyForRecipe(recipe.kind);
  const operations: Operation[] = [];

  // Folder identity is site-scoped on the recipe.site handle so two
  // DictionaryRecipes targeting two different sites can share the
  // same recipe.name (the host-site qualifier disambiguates).
  const folderRefKey = dictionaryFolderId(recipe.site, recipe.name);
  const dictionaryRootPath = joinPath(sitePath, "Dictionary");
  const folderPath = joinPath(dictionaryRootPath, recipe.name);

  // Dictionary Folder item itself. parent: ref-path the `<site>/Dictionary`
  // bucket — Sitecore's standard convention. SXA's site scaffolding
  // creates the `Dictionary` folder during `CreateSiteFromTemplate`,
  // so by the time this op runs the bucket exists. If it doesn't (an
  // edge case where someone manually created a site outside Sites
  // API), the apply errors with a clear "parent not found" — that's
  // an operator misconfiguration, not a recipe bug.
  operations.push({
    op: "CreateItem",
    policy,
    label: `dictionary-folder:${recipe.handle}`,
    id: folderRefKey,
    path: folderPath,
    parent: { kind: "ref-path", value: dictionaryRootPath },
    templateOf: { kind: "ref-path", value: DICTIONARY_TEMPLATE_PATHS.FOLDER },
    name: recipe.name,
    fields: [
      versionedField(SYSTEM_FIELDS.DISPLAY_NAME, {
        kind: "string",
        value: recipe.displayName,
      }),
    ],
  } satisfies CreateItemOp);

  const primaryLocale = recipe.primaryLocale ?? DEFAULT_LANGUAGE;

  // Sort phrase keys for deterministic op ordering — re-pushes against
  // an unchanged recipe produce identical IRs (golden tests, planner
  // no-ops, diff stability).
  const phraseKeys = Object.keys(recipe.phrases).sort();
  for (const phraseKey of phraseKeys) {
    const phrase = recipe.phrases[phraseKey];
    const entryRefKey = dictionaryPhraseId(recipe.site, phraseKey);
    const entryPath = joinPath(folderPath, phraseKey);

    operations.push({
      op: "CreateItem",
      policy,
      label: `dictionary-entry:${recipe.handle}/${phraseKey}`,
      id: entryRefKey,
      path: entryPath,
      parent: { kind: "ref-recipe", refKey: folderRefKey },
      templateOf: { kind: "ref-path", value: DICTIONARY_TEMPLATE_PATHS.ENTRY },
      name: phraseKey,
      fields: [
        // Stable identifier — shared across all language versions.
        // `fieldName: "Key"` provides name-based fallback resolution
        // for the (likely placeholder) GUID — see DICTIONARY_ENTRY_FIELDS.
        {
          fieldId: DICTIONARY_ENTRY_FIELDS.KEY,
          fieldName: "Key",
          value: { kind: "string", value: phraseKey },
        },
        // Primary-locale Phrase version — populated from defaultValue.
        // Per-locale translations land as separate SetField ops below
        // so the version + language axes are explicit.
        {
          fieldId: DICTIONARY_ENTRY_FIELDS.PHRASE,
          fieldName: "Phrase",
          language: primaryLocale,
          version: DEFAULT_VERSION,
          value: { kind: "string", value: phrase.defaultValue },
        },
      ],
    } satisfies CreateItemOp);

    // Per-locale translation versions — sorted for deterministic order.
    if (phrase.translations) {
      for (const locale of Object.keys(phrase.translations).sort()) {
        // Skip if a translator happened to key the primary locale on
        // the translations map — `defaultValue` already covers it via
        // the CreateItem above, and a duplicate SetField at the same
        // (item, field, language, version) triple would no-op anyway.
        if (locale === primaryLocale) continue;
        operations.push({
          op: "SetField",
          policy,
          label: `dictionary-entry-translation:${recipe.handle}/${phraseKey}:${locale}`,
          itemRefKey: entryRefKey,
          fieldId: DICTIONARY_ENTRY_FIELDS.PHRASE,
          fieldName: "Phrase",
          language: locale,
          version: DEFAULT_VERSION,
          value: { kind: "string", value: phrase.translations[locale] },
        } satisfies SetFieldOp);
      }
    }

    // Optional translator-facing description — landed as a shared
    // `__Help text` field write so it surfaces in Sitecore's Content
    // Editor "Help" tooltip + any translation tooling that reads it.
    if (phrase.description) {
      operations.push({
        op: "SetField",
        policy,
        label: `dictionary-entry-description:${recipe.handle}/${phraseKey}`,
        itemRefKey: entryRefKey,
        fieldId: SYSTEM_FIELDS.HELP_TEXT,
        value: { kind: "string", value: phrase.description },
      } satisfies SetFieldOp);
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Resolve a `DictionaryRecipe`'s host-site content-tree path. Two
 * resolution paths:
 *
 *   1. `context.crossRecipeSitePaths[recipe.site]` — pre-seeded by
 *      `compileRecipeSet` from every `SiteRecipe`'s resolved
 *      `<collectionPath>/<siteName>` shape. Preferred for the
 *      common multi-recipe compile.
 *   2. `context.sitesByHandle.get(recipe.site)` — when only the
 *      recipe set is available, derive the path the same way
 *      `compileSiteRecipe`'s `resolveSiteContentTreePath` does
 *      (collectionPath override → collectionName-derived default).
 *
 * Returns `undefined` when neither resolves; the caller throws an
 * INPUT_INVALID with a hint.
 */
const resolveHostSitePath = (
  recipe: DictionaryRecipe,
  context: CompileContext
): string | undefined => {
  const pre = context.crossRecipeSitePaths?.[recipe.site];
  if (pre) return trimEndChar(pre, "/");
  const host = context.sitesByHandle?.get(recipe.site);
  if (!host) return undefined;
  return deriveSitePath(host);
};

const deriveSitePath = (site: Extract<Recipe, { kind: "site" }>): string | undefined => {
  if (site.collectionPath) {
    const trimmed = site.collectionPath.replace(/\/+$/, "");
    return `${trimmed}/${site.name}`;
  }
  if (site.collectionName) {
    return `/sitecore/content/${site.collectionName}/${site.name}`;
  }
  return undefined;
};

import { createScaiError } from "@/shared/errors";
import { trimEndChar } from "@/shared/strings";
import { dictionaryFolderId, dictionaryPhraseId } from "../items/guids";
import {
  type AddItemVersionOp,
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
 *     plus every locale in `phrases[*].translations`). When
 *     `context.availableLanguages` is set (Sites API `listLanguages`),
 *     translation locales are filtered to the environment's languages —
 *     the dictionary installs exactly the brand's languages and never
 *     adds a version in a locale the tenant doesn't have. The primary
 *     locale is always emitted.
 *   - A `__Help text` (description) shared field — optional, sourced
 *     from `phrases[*].description`. Translator-facing context only.
 *
 * **Host-site resolution.** By default a dictionary has NO `site` and
 * installs into the deploy's TARGET site — the compiler composes
 * `/sitecore/content/<context.sitePathSegment>` (the
 * `<siteCollection>/<site>` from the active env profile), the same
 * location pages and enums install into. No in-set `SiteRecipe` is
 * required. When `recipe.site` IS set (the shared-site override), it
 * points at a `SiteRecipe`; the compile context's `crossRecipeSitePaths`
 * / `sitesByHandle` resolves that handle to the host site's
 * `<collectionPath>/<siteName>` shape (same logic
 * `compileSiteRecipe`'s `resolveSiteContentTreePath` uses). Either way,
 * an unresolvable target yields an INPUT_INVALID with a targeted hint.
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
      recipe.site
        ? `compileDictionaryRecipe: the host SiteRecipe '${recipe.site}' declared on dictionary '${recipe.handle}' is not in the recipe set (and no matching context.crossRecipeSitePaths entry was pre-seeded), so it has no resolvable content-tree path.`
        : `compileDictionaryRecipe: dictionary '${recipe.handle}' has no host site. It installs into the deploy's target site, but no site path is configured.`,
      "INPUT_INVALID",
      {
        hint: recipe.site
          ? `Add the SiteRecipe with handle '${recipe.site}' to the same push/compile, or drop the \`site\` field so the dictionary installs into the deploy's target site.`
          : "Set `site` and `siteCollection` on the active envProfile in sitecoreai.cli.json — scai lands the dictionary at `/sitecore/content/<siteCollection>/<site>/Dictionary/<name>`, the same target every page/enum install uses.",
      }
    );
  }

  // GUID-seed handle for site-scoped refKeys. When the dictionary pins
  // an explicit host site, seed off that handle; otherwise seed off the
  // deploy's target site name (falling back to the `default` sentinel,
  // mirroring `resolveSeedSite`) so identity stays stable across
  // re-pushes of the same install.
  const siteSeed = recipe.site ?? context.site ?? "default";

  const policy = defaultPolicyForRecipe(recipe.kind);
  const operations: Operation[] = [];

  // Folder identity is site-scoped on the `siteSeed` handle so two
  // DictionaryRecipes targeting two different sites can share the
  // same recipe.name (the host-site qualifier disambiguates).
  const folderRefKey = dictionaryFolderId(siteSeed, recipe.name);
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

  // When the push resolved the environment's languages (Sites API
  // `listLanguages`), restrict translation locales to that set so a
  // dictionary installs exactly the brand's languages — and never emits
  // an AddItemVersion for a language the tenant doesn't have (which the
  // Authoring API rejects). Case-insensitive; the primary locale is
  // always emitted regardless. Unset ⇒ emit every authored translation.
  const availableLocales = context.availableLanguages
    ? new Set(context.availableLanguages.map((l) => l.toLowerCase()))
    : undefined;

  // Sort phrase keys for deterministic op ordering — re-pushes against
  // an unchanged recipe produce identical IRs (golden tests, planner
  // no-ops, diff stability).
  const phraseKeys = Object.keys(recipe.phrases).sort();
  for (const phraseKey of phraseKeys) {
    const phrase = recipe.phrases[phraseKey];
    const entryRefKey = dictionaryPhraseId(siteSeed, phraseKey);
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
        // Skip locales the target environment doesn't have — aligns the
        // installed dictionary to the brand's languages (Sites API).
        if (availableLocales && !availableLocales.has(locale.toLowerCase())) continue;
        // `CreateItem` only materialises the primary-locale version; a
        // SetField against a language that has no version yet fails with
        // "item ... does not contain version #1 in '<locale>'". Ensure
        // the locale's version exists first (mirrors content-item /
        // page multi-language emission). The executor creates the
        // language version as part of adding version 1.
        operations.push({
          op: "AddItemVersion",
          policy,
          label: `dictionary-entry-version:${recipe.handle}/${phraseKey}:${locale}`,
          itemRefKey: entryRefKey,
          language: locale,
          version: DEFAULT_VERSION,
        } satisfies AddItemVersionOp);
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
 * Resolve a `DictionaryRecipe`'s host-site content-tree path.
 *
 * The common case is a dictionary with NO `site` — it installs into the
 * deploy's TARGET site, exactly like pages and enums: compose
 * `/sitecore/content/<context.sitePathSegment>` (the
 * `<siteCollection>/<site>` derived from the active env profile). No
 * in-set `SiteRecipe` is required.
 *
 * When the dictionary DOES pin an explicit `site` handle (the
 * shared-site override), resolve it against the in-set sites:
 *
 *   1. `context.crossRecipeSitePaths[recipe.site]` — pre-seeded by
 *      `compileRecipeSet` from every `SiteRecipe`'s resolved
 *      `<collectionPath>/<siteName>` shape.
 *   2. `context.sitesByHandle.get(recipe.site)` — when only the
 *      recipe set is available, derive the path the same way
 *      `compileSiteRecipe`'s `resolveSiteContentTreePath` does
 *      (collectionPath override → collectionName-derived default).
 *
 * Returns `undefined` when nothing resolves; the caller throws an
 * INPUT_INVALID with a targeted hint.
 */
const resolveHostSitePath = (
  recipe: DictionaryRecipe,
  context: CompileContext
): string | undefined => {
  if (recipe.site) {
    const pre = context.crossRecipeSitePaths?.[recipe.site];
    if (pre) return trimEndChar(pre, "/");
    const host = context.sitesByHandle?.get(recipe.site);
    return host ? deriveSitePath(host) : undefined;
  }
  // No host override → land under the deploy's target site, mirroring
  // the `{site}` substitution pages use (`page.ts` `resolvePagePath`).
  if (context.sitePathSegment) {
    return `/sitecore/content/${trimEndChar(context.sitePathSegment, "/")}`;
  }
  return undefined;
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

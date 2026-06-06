import { createScaiError } from "@/shared/errors";
import { dictionaryPhraseId, siteId, templateId } from "../items/guids";
import {
  type CreateSiteFromTemplateOp,
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
} from "../ir/sitecore-templates";
import { type SiteRecipe, SiteRecipeSchema } from "../schema/recipe";
import { siteOf, type CompileContext } from "./shared";

/**
 * Compile a `SiteRecipe` to an Operation IR.
 *
 * Emits a single `CreateSiteFromTemplate` op that the executor
 * dispatches through the Sites API. The
 * `SiteTemplateRecipe` it references is identified via deterministic
 * `templateId(siteTemplate)`; the executor resolves that refKey to
 * the SiteTemplate's actual Sitecore itemId via cross-recipe ref
 * pre-seeding (push.ts walks every recipe's `CreateItem` ops and
 * seeds `crossRecipeRefs[refKey] = path`, then the executor's
 * `seedCrossRecipeRefs` calls `getItem({path})` once per push to
 * populate `capturedItemIds`).
 *
 * **Validates** (compile-time, not zod-level):
 *   - Exactly one of `collectionId` / `collectionName` is present.
 *
 * **Override emission (Milestone E v2):**
 *   - Dictionary overrides emit one `SetField` op per phrase, targeting
 *     `<collectionPath>/<siteName>/Dictionary/<phrase>`. Each op carries a
 *     `latePath` so the executor's pre-switch lookup seeds the captured
 *     itemId after `CreateSiteFromTemplate` materialises the site's
 *     content tree (SXA's Site Wizard creates the Dictionary folder +
 *     phrase items mid-push).
 *   - Path composition needs the collection's content-tree path. The
 *     compiler resolves it in this priority:
 *       1. `recipe.collectionPath` (operator-supplied — explicit truth)
 *       2. `/sitecore/content/<collectionName>` when only collectionName
 *          is set (SXA default; new collections land at this path)
 *     For `collectionId` callers without `collectionPath`, the compiler
 *     CAN'T derive the path (would need a Sites API lookup at compile
 *     time, which the compiler doesn't do). Override emission is
 *     skipped silently — the site still gets created; operators add
 *     `collectionPath` when they want overrides applied.
 *
 * **Still deferred (E v3+):**
 *   - Taxonomy overrides as a mix of SetField (existing tags) and
 *     CreateItem (new tags). The SXA taxonomy convention is still under
 *     sandbox investigation; defer until verified.
 */
export function compileSiteRecipe(input: SiteRecipe, context: CompileContext): OperationIr {
  const recipe = SiteRecipeSchema.parse(input);

  const hasCollectionId = recipe.collectionId !== undefined;
  const hasCollectionName = recipe.collectionName !== undefined;
  if (hasCollectionId === hasCollectionName) {
    throw createScaiError(
      `SiteRecipe '${recipe.handle}' must specify exactly one of collectionId / collectionName, not ${hasCollectionId ? "both" : "neither"}.`,
      "INPUT_INVALID"
    );
  }

  const policy = defaultPolicyForRecipe(recipe.kind);
  const siteRefKey = siteId(recipe.handle);
  const templateRefKey = templateId(siteOf(context), recipe.siteTemplate);

  const operations: Operation[] = [
    {
      op: "CreateSiteFromTemplate",
      policy,
      label: `site:${recipe.handle}`,
      siteRefKey,
      siteName: recipe.name,
      ...(recipe.displayName !== undefined && { displayName: recipe.displayName }),
      ...(recipe.description !== undefined && { description: recipe.description }),
      language: recipe.language,
      ...(recipe.languages !== undefined && { additionalLanguages: recipe.languages }),
      ...(recipe.siteGrouping?.hostName !== undefined && {
        hostName: recipe.siteGrouping.hostName,
      }),
      templateRefKey,
      ...(recipe.collectionId !== undefined && { collectionId: recipe.collectionId }),
      ...(recipe.collectionName !== undefined && { collectionName: recipe.collectionName }),
      ...(recipe.collectionDisplayName !== undefined && {
        collectionDisplayName: recipe.collectionDisplayName,
      }),
      ...(recipe.collectionDescription !== undefined && {
        collectionDescription: recipe.collectionDescription,
      }),
    } satisfies CreateSiteFromTemplateOp,
  ];

  // Resolve the site's content-tree path for late-path composition on
  // dictionary override ops. See docstring for resolution priority.
  //
  // The override value can be either a flat `string` (overrides the
  // primary locale) or a `Record<locale, string>` (per-locale overrides
  // for one or more languages). Flat-string overrides emit ONE SetField
  // against the default-language version; per-locale overrides emit ONE
  // SetField per locale, each targeting the matching item version on
  // the existing Dictionary Entry. Either way the targeted item is the
  // same `<site>/Dictionary/<phrase>` Sitecore item — versions differ.
  const sitePath = resolveSiteContentTreePath(recipe);
  if (sitePath && recipe.dictionaryOverrides) {
    for (const [phrase, raw] of Object.entries(recipe.dictionaryOverrides)) {
      const latePath = `${sitePath}/Dictionary/${phrase}`;
      const itemRefKey = dictionaryPhraseId(recipe.handle, phrase);
      if (typeof raw === "string") {
        operations.push({
          op: "SetField",
          policy,
          label: `dictionary-override:${recipe.handle}/${phrase}`,
          itemRefKey,
          fieldId: DICTIONARY_ENTRY_FIELDS.PHRASE,
          language: DEFAULT_LANGUAGE,
          version: DEFAULT_VERSION,
          value: { kind: "string", value: raw },
          latePath,
        } satisfies SetFieldOp);
      } else {
        // Per-locale overrides — sort locales for deterministic op
        // ordering (debugging, golden tests, IR diffs).
        for (const locale of Object.keys(raw).sort()) {
          operations.push({
            op: "SetField",
            policy,
            label: `dictionary-override:${recipe.handle}/${phrase}:${locale}`,
            itemRefKey,
            fieldId: DICTIONARY_ENTRY_FIELDS.PHRASE,
            language: locale,
            version: DEFAULT_VERSION,
            value: { kind: "string", value: raw[locale] },
            latePath,
          } satisfies SetFieldOp);
        }
      }
    }
  }

  return OperationIrSchema.parse({
    schemaVersion: "1",
    recipeHandle: recipe.handle,
    operations,
  });
}

/**
 * Resolve the Sitecore content-tree path of a SiteRecipe's site item.
 * Returns `undefined` when no path can be derived — the caller should
 * skip override emission rather than guess.
 *
 *   1. operator-supplied `recipe.collectionPath` (always wins)
 *   2. `/sitecore/content/<collectionName>` when only collectionName is set
 *   3. `undefined` for collectionId-only without collectionPath
 *
 * The trailing `/` is trimmed defensively from operator input.
 */
const resolveSiteContentTreePath = (recipe: SiteRecipe): string | undefined => {
  if (recipe.collectionPath) {
    const trimmed = recipe.collectionPath.replace(/\/+$/, "");
    return `${trimmed}/${recipe.name}`;
  }
  if (recipe.collectionName) {
    return `/sitecore/content/${recipe.collectionName}/${recipe.name}`;
  }
  return undefined;
};

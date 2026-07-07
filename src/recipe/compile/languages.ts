/**
 * Pure-logic inventory of the locale codes a recipe authors content for.
 *
 * Consumed by `recipe list --json` so a batch driver (the orchestrator's
 * batched `recipe_sync` workflow) can scope its localize passes to exactly
 * the authored languages (`--languages fr-FR,de,…`) instead of pushing
 * unscoped — on tenants with many registered locales, an unscoped push
 * fans base-language expansion across every registered regional variant,
 * which dwarfs the authored surface.
 *
 * Codes are returned VERBATIM as authored: a bare base language (`de`)
 * stays `de` — `--languages` treats a base-language entry as matching
 * every registered regional variant (see `languageScopeMatches` in
 * tasks/push.ts), so pass-through preserves the expansion semantics.
 *
 * Inventory sources (duck-typed over the parsed `Recipe` union so any
 * kind carrying one of these shapes contributes):
 *   - `language` / `languages`               — SiteRecipe declarations
 *   - `translations` record keys             — content-item / page simple mode
 *   - `versions` record keys                 — content-item / page story mode
 *   - `phrases[*].translations` keys         — DictionaryRecipe entries
 *   - `primaryLocale`                        — DictionaryRecipe
 *   - `fields[]` / `params[]` locale-map defaults (`default` /
 *     `sitecore.defaultValue`)               — template kinds
 */
import type { Recipe } from "../schema/recipe";

/** A `default` / `sitecore.defaultValue` — string or locale map. */
type MaybeLocalizedDefault = string | Record<string, string> | undefined;

type FieldLike = {
  default?: MaybeLocalizedDefault;
  sitecore?: { defaultValue?: MaybeLocalizedDefault };
};

const addLocaleMapKeys = (value: MaybeLocalizedDefault, into: Set<string>): void => {
  if (value === undefined || typeof value === "string") return;
  for (const key of Object.keys(value)) into.add(key);
};

const addFieldDefaults = (fields: unknown, into: Set<string>): void => {
  if (!Array.isArray(fields)) return;
  for (const field of fields as FieldLike[]) {
    addLocaleMapKeys(field.default, into);
    addLocaleMapKeys(field.sitecore?.defaultValue, into);
  }
};

const addRecordKeys = (record: unknown, into: Set<string>): void => {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return;
  for (const key of Object.keys(record)) into.add(key);
};

export const collectRecipeLanguages = (recipe: Recipe): readonly string[] => {
  const languages = new Set<string>();
  const r = recipe as Record<string, unknown>;

  if (typeof r.language === "string") languages.add(r.language);
  if (Array.isArray(r.languages)) {
    for (const code of r.languages) if (typeof code === "string") languages.add(code);
  }
  if (typeof r.primaryLocale === "string") languages.add(r.primaryLocale);

  // Simple-mode translations and story-mode versions are both records
  // keyed by ISO language code.
  addRecordKeys(r.translations, languages);
  addRecordKeys(r.versions, languages);

  // Dictionary phrases: each entry's `translations` record is keyed by
  // locale code.
  if (typeof r.phrases === "object" && r.phrases !== null && !Array.isArray(r.phrases)) {
    for (const phrase of Object.values(r.phrases as Record<string, unknown>)) {
      if (typeof phrase === "object" && phrase !== null) {
        addRecordKeys((phrase as { translations?: unknown }).translations, languages);
      }
    }
  }

  // Template kinds: locale-map field/param defaults. Content-item
  // `fields` is a RECORD of values (primary language only) — the
  // Array.isArray guard inside addFieldDefaults skips it.
  addFieldDefaults(r.fields, languages);
  addFieldDefaults(r.params, languages);

  return [...languages].sort((a, b) => a.localeCompare(b));
};

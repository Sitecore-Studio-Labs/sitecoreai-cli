import type { EnvironmentConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { getAccessToken } from "../api/auth";
import { createSitesApiClient, type SitesApiClient } from "../api/sites-client";
import { appendSiteLanguages, ensureEnvironmentLanguages } from "../runtime/execute";
import type { Recipe } from "../schema/recipe";

/**
 * Environment-language resolution for the compiler's `availableLanguages`
 * input.
 *
 * `availableLanguages` is a COMPILE-time input: dictionary translations and
 * `__Standard Values` locale-map defaults are EMITTED (or skipped) based on
 * it, so `recipe push` and `recipe compile` MUST resolve it identically —
 * otherwise a precompiled artifact (`push --from-compiled`) would carry a
 * different localized surface than a per-invocation compiling push. This
 * module is the single source of that resolution, shared by both tasks.
 */

/**
 * Case-insensitive `--languages` scope match: a scope entry matches its
 * exact code (`fr-FR`) and, for bare base-language entries, every regional
 * variant (`fr` matches `fr-FR` / `fr-CA`) — mirroring the compiler's own
 * base-language expansion for `__Standard Values` locale maps.
 */
export const languageScopeMatches = (scope: readonly string[], code: string): boolean => {
  const lower = code.toLowerCase();
  const base = lower.split(/[-_]/)[0];
  return scope.some((entry) => {
    const entryLower = entry.toLowerCase();
    return entryLower === lower || entryLower === base;
  });
};

/** True when a value is a locale map (`{ en, de, … }`), not a plain string. */
const isLocaleMap = (value: unknown): boolean =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * True when a component-/content-template recipe authors any per-locale
 * `__Standard Values` default — a field or param whose `default` (or
 * `sitecore.defaultValue`) is a `{ en, de, … }` locale map rather than a
 * plain string.
 *
 * Such a recipe needs the environment's registered languages resolved for
 * the SAME reason a dictionary does: the compiler fans a bare base-language
 * key (`ar`) out to the tenant's registered regional variants (`ar-AE`,
 * `ar-SA`) only when `availableLanguages` is known. Without it, the
 * standalone-compile branch emits each key verbatim — so `ar` lands on the
 * bare `ar` version, a language the site never renders, instead of the
 * regional `ar-AE` it actually uses. Gating language resolution on
 * dictionaries alone left a component-only push (no dictionary in the set)
 * writing localized SV to the wrong language.
 */
export const recipeHasLocaleMapDefaults = (recipe: Recipe): boolean => {
  if (recipe.kind !== "component-template" && recipe.kind !== "content-template") {
    return false;
  }
  const entries = [
    ...((recipe as { fields?: unknown[] }).fields ?? []),
    ...((recipe as { params?: unknown[] }).params ?? []),
  ];
  return entries.some((entry) => {
    const e = entry as { default?: unknown; sitecore?: { defaultValue?: unknown } };
    return isLocaleMap(e.default) || isLocaleMap(e.sitecore?.defaultValue);
  });
};

/**
 * Resolve the target environment's languages (Sites API `listLanguages`)
 * so `compileDictionaryRecipe` can align a dictionary's translation
 * locales to the brand's languages — the same language source the
 * brand-kit Glossary reads.
 *
 * Only queried when the set actually carries a `dictionary` recipe or a
 * locale-map default (a component/page-only push pays no token mint).
 * Best-effort: an auth or network failure returns `undefined`, so the
 * compiler falls back to emitting every authored translation rather than
 * aborting. Returns the union of each language's `iso` and
 * `regionalIsoCode` (e.g. `["en", "fr", "pt", "pt-BR"]`), which the
 * compiler matches case-insensitively against phrase-translation locales.
 */
const resolveEnvironmentLanguages = async (
  recipes: readonly Recipe[],
  environment: EnvironmentConfiguration
): Promise<string[] | undefined> => {
  const needsLanguages = recipes.some(
    (r) => r.kind === "dictionary" || recipeHasLocaleMapDefaults(r)
  );
  if (!needsLanguages) return undefined;
  const accessToken = await getAccessToken(environment);
  if (!accessToken) return undefined;
  try {
    const languages = await createSitesApiClient({ accessToken }).listLanguages();
    const codes = new Set<string>();
    for (const lang of languages) {
      if (lang.iso) codes.add(lang.iso);
      if (lang.regionalIsoCode) codes.add(lang.regionalIsoCode);
    }
    return codes.size > 0 ? [...codes] : undefined;
  } catch {
    // Non-fatal: without the list the compiler emits all authored
    // translations (pre-alignment behaviour). The push proceeds.
    return undefined;
  }
};

/**
 * Resolve the languages a push/compile localizes to, under an optional
 * `--languages` scope.
 *
 * Localization scopes to the languages ALREADY INSTALLED on the environment
 * (`resolveEnvironmentLanguages` → `listLanguages`). A recipe that declares
 * more locales than the environment has does NOT auto-provision + write them:
 * a declared-but-unregistered locale's Standard Values / dictionary phrases
 * are dropped rather than the CLI silently creating the language and localizing
 * into it. Provisioning a genuinely-new language is the operator's step (or
 * happens via `createSite` for a fresh site). This keeps a base-language
 * default (`ar`) from fanning out across every regional variant the CLI would
 * otherwise register — the localize targets exactly what the environment
 * supports (e.g. 5 installed locales, not 25 auto-created ones).
 *
 * `--languages` narrows further: the returned availableLanguages is filtered
 * to the scope, and `--languages en` is the "content now, locales later"
 * install shape. Scope unset = every installed language.
 *
 * `--provision-languages` inverts the drop for the scoped set: the scope
 * is ensured onto the environment FIRST (idempotent registration +
 * fallback wiring via `ensureEnvironmentLanguages`), so the resolution
 * below sees the scoped locales as installed instead of dropping them.
 * When the profile names a `site` that already exists, the registered
 * scope is ALSO appended to that site's own language list
 * (`supportedLanguages`, the property Pages offers locales from):
 * environment registration alone never surfaces a locale on a site, and
 * a pages-only push carries no Site recipe, so the executor's
 * CreateSiteFromTemplate ensure — which handles this for site pushes —
 * never runs. Without the append here, an install into an existing site
 * registered brand languages org-wide but Pages never offered them.
 * Install pipelines opt in when the scope comes from a trusted source
 * (the brand's language list); a missing Sites API credential fails loud
 * — silently skipping the provision would reintroduce the silent narrow
 * the flag exists to prevent.
 */
/**
 * Append the provisioned `--languages` scope to the profile's target SITE
 * language list. No-op when the profile has no `site`, or the site doesn't
 * exist yet (a fresh-site install's `createSite` declares its languages
 * itself), or every scoped code is already on the site's list. Additive
 * only, and gated (inside `appendSiteLanguages`) to codes the environment
 * ensure actually registered — a catalog-rejected bare base code never
 * lands on a site list either. Exact-name site match, same as the
 * executor's CreateSiteFromTemplate idempotency lookup.
 */
const appendScopeToProfileSite = async (
  sitesClient: SitesApiClient,
  siteName: string | undefined,
  scope: string[],
  envPresent: Set<string>
): Promise<void> => {
  const trimmed = siteName?.trim();
  if (!trimmed) return;
  const sites = await sitesClient.listSites();
  const existing = sites.find((s) => s.name === trimmed);
  if (!existing?.id) return;
  const onSite = new Set((existing.supportedLanguages ?? []).map((code) => code.toLowerCase()));
  const missing = scope.filter((code) => !onSite.has(code.toLowerCase()));
  if (missing.length === 0) return;
  await appendSiteLanguages(sitesClient, { siteId: existing.id, missing }, envPresent);
};

export const resolveScopedLanguages = async (
  recipes: readonly Recipe[],
  environment: EnvironmentConfiguration,
  languagesOption: readonly string[] | undefined,
  provisionLanguages?: boolean
): Promise<string[] | undefined> => {
  const languageScope = languagesOption
    ?.map((code) => code.trim())
    .filter((code) => code.length > 0);
  if (provisionLanguages && (!languageScope || languageScope.length === 0)) {
    throw createScaiError(
      "--provision-languages requires a --languages scope — there is nothing to provision without one.",
      "INPUT_INVALID",
      { hint: "Pass the locale list to provision, e.g. --languages en,da,ar-AE." }
    );
  }
  if (provisionLanguages && languageScope && languageScope.length > 0) {
    const accessToken = await getAccessToken(environment);
    if (!accessToken) {
      throw createScaiError(
        "--provision-languages could not mint a Sites API access token for the target environment.",
        "AUTH_REQUIRED",
        {
          hint: "Run `scai auth login` (or configure client credentials) for this environment, or drop --provision-languages to fall back to the environment's already-registered languages.",
        }
      );
    }
    const sitesClient = createSitesApiClient({ accessToken });
    const envPresent = await ensureEnvironmentLanguages(sitesClient, [...languageScope]);
    await appendScopeToProfileSite(sitesClient, environment.site, [...languageScope], envPresent);
  }
  const resolved = await resolveEnvironmentLanguages(recipes, environment);
  if (!languageScope || languageScope.length === 0) return resolved;
  return (resolved ?? languageScope).filter((code) => languageScopeMatches(languageScope, code));
};

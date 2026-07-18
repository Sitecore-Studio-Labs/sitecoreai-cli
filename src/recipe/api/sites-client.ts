import { listCollections, type SiteCollection } from "../../sites/api/collections";
import { getJobStatus, type Job } from "../../sites/api/jobs";
import {
  addLanguage,
  listLanguages,
  listSupportedLanguages,
  parseLanguageCode,
  updateLanguage,
  type EditLanguageInput,
  type Language,
  type SupportedLanguage,
} from "../../sites/api/languages";
import {
  createSite,
  deleteSite,
  listSites,
  listSiteTemplates,
  retrieveSite,
  updateSite,
  type JobResponse,
  type NewSiteInput,
  type Site,
  type SiteTemplate,
  type UpdateSiteInput,
} from "../../sites/api/sites";
import type { SitesApiClientOptions as RawSitesApiClientOptions } from "../../sites/api/types";

/**
 * Sites API client surface for recipe execution.
 *
 * The recipe planner and executor depend only on this interface — they
 * don't reach into `src/sites/api/*` directly. Production runs use
 * `createSitesApiClient(options)`, which adapts the function-style
 * Sites API surface into the interface; tests inject a mock — same
 * seam either way (parallel to how `AuthoringApiClient` works).
 *
 * Surface is the recipe-required subset:
 *   - `createSite` for `CreateSiteFromTemplate` ops
 *   - `getJobStatus` for awaiting async createSite completion
 *   - `listSites` for idempotency check (does this siteName exist?)
 *   - `listSiteTemplates` for diagnostics (which templates are usable?)
 *   - `listCollections` for resolving `collectionId`
 *   - `listLanguages` + `addLanguage` for ensuring required language(s)
 *     are present before site creation
 *
 * Additional Sites API operations (favourites, editor profiles, hosts,
 * aggregation) live in `src/sites/api/*` and are not part of this
 * recipe-execution surface — they belong to the broader CLI subcommand
 * tree, not the push pipeline.
 */
export interface SitesApiClient {
  createSite(input: NewSiteInput): Promise<JobResponse>;
  /**
   * Delete a site permanently. Async — returns a job handle the caller
   * polls via `getJobStatus`. Exposed so integration-test cleanup can
   * remove RUN_ID-namespaced sites without reaching past the typed
   * client interface.
   */
  deleteSite(siteId: string): Promise<JobResponse>;
  /**
   * Retrieve a single site by ID (`GET /api/v1/sites/{siteId}`). The push
   * pipeline reads the site fresh right before a language-list PATCH so
   * the merge base is the authoritative detail view, not a possibly
   * stale/partial `listSites` row.
   */
  retrieveSite(siteId: string): Promise<Site>;
  /**
   * PATCH mutable site properties. The push pipeline uses this to keep
   * the SITE's language list (`supportedLanguages`) in step with the
   * recipe's declared languages — environment registration alone doesn't
   * surface a locale on the site, so Pages won't offer it there.
   */
  updateSite(siteId: string, patch: Partial<UpdateSiteInput>): Promise<Site>;
  getJobStatus(jobHandle: string): Promise<Job>;
  listSites(): Promise<Site[]>;
  listSiteTemplates(): Promise<SiteTemplate[]>;
  listCollections(): Promise<SiteCollection[]>;
  listLanguages(): Promise<Language[]>;
  /**
   * The languages SitecoreAI *supports* — the catalog you can add from
   * (`GET /api/v1/languages/supported`). The provisioning ensure gates
   * `addLanguage` on it: the Sites API rejects codes outside the
   * catalog (e.g. bare base codes like `de` — only `de-DE` etc. are
   * registrable), and attempting one aborts the push.
   */
  listSupportedLanguages(): Promise<SupportedLanguage[]>;
  /**
   * Add a language to the environment by ISO code (e.g. `"en"`, `"da"`,
   * `"fr-CA"`). The Sites API distinguishes language code from
   * regional code; the recipe push pipeline only needs to declare the
   * language code. If the language is already present, the API
   * surfaces a 409-style error which the executor treats as success.
   */
  addLanguage(languageCode: string): Promise<Language>;
  /**
   * Update an environment language's metadata by its (regional) ISO
   * code. The push pipeline uses this to wire `fallbackLanguageIso`
   * on provisioned languages so Sitecore's language-fallback chain
   * matches the authored base-locale model.
   */
  updateLanguage(isoCode: string, input: EditLanguageInput): Promise<void>;
}

/**
 * Regional + iso codes currently on the environment, lowercased for
 * membership checks. Shared by the executor's language ensure and the
 * planner's existing-site language diff (the planner can't import from
 * `runtime/execute` — that would be an import cycle).
 */
export const presentLanguageCodes = (languages: Language[]): Set<string> => {
  const set = new Set<string>();
  for (const lang of languages) {
    if (lang.iso) set.add(lang.iso.toLowerCase());
    if (lang.regionalIsoCode) set.add(lang.regionalIsoCode.toLowerCase());
  }
  return set;
};

/**
 * The environment's SITE-WRITABLE language codes — the full regional
 * identities a site's `supportedLanguages` may carry, lowercased.
 *
 * Distinct from {@link presentLanguageCodes} on purpose: that set is
 * iso-inclusive (it adds a language's bare `iso` AND its `regionalIsoCode`),
 * so a registered `de-DE` pollutes it with a bare `de`. A bare base like
 * `de` is a valid localize FALLBACK target but is NOT a registrable site
 * language — the Sites API rejects it on a `supportedLanguages` PATCH
 * ("The provided language 'de' with region code '' is not supported").
 * This set carries each language's `regionalIsoCode` (its real, region-
 * qualified identity — `de-DE`, and `en`/`da` for standalones), falling
 * back to `iso` only when no regional code exists, so a bare base derived
 * purely from a regional's iso never appears.
 */
export const presentSiteLanguageCodes = (languages: Language[]): Set<string> => {
  const set = new Set<string>();
  for (const lang of languages) {
    if (lang.regionalIsoCode) set.add(lang.regionalIsoCode.toLowerCase());
    else if (lang.iso) set.add(lang.iso.toLowerCase());
  }
  return set;
};

/**
 * Adapter: build a `SitesApiClient` over the function-style Sites API
 * surface. The `options` arg carries the OAuth-resolved auth header and
 * base URL; the underlying `sitesRequest` re-uses these per call.
 */
export const createSitesApiClient = (options: RawSitesApiClientOptions): SitesApiClient => ({
  createSite: (input) => createSite(options, input),
  // `force: true` lets cleanup remove sites the createSite job already
  // published to Edge — otherwise the Sites API refuses to delete and
  // leaves orphans on the tenant. Integration-test teardowns always
  // want this; the recipe push path doesn't dispatch deleteSite at all.
  deleteSite: (siteId) => deleteSite(options, siteId, { force: true }),
  retrieveSite: (siteId) => retrieveSite(options, siteId),
  updateSite: (siteId, patch) => updateSite(options, siteId, patch),
  getJobStatus: (jobHandle) => getJobStatus(options, jobHandle),
  listSites: () => listSites(options),
  listSiteTemplates: () => listSiteTemplates(options),
  listCollections: () => listCollections(options),
  listLanguages: () => listLanguages(options),
  listSupportedLanguages: () => listSupportedLanguages(options),
  addLanguage: (languageCode) => addLanguage(options, parseLanguageCode(languageCode)),
  updateLanguage: (isoCode, input) => updateLanguage(options, isoCode, input),
});

// Language-code helpers re-exported for the executor's fallback wiring —
// recipe runtime code consumes the Sites API through this seam only.
export { fallbackLanguageIsoFor, parseLanguageCode } from "../../sites/api/languages";
export type {
  EditLanguageInput,
  Job,
  JobResponse,
  Language,
  NewSiteInput,
  Site,
  SiteCollection,
  SiteTemplate,
  SupportedLanguage,
  UpdateSiteInput,
};

import { sitesRequest } from "./request";
import type { components } from "./schema";
import type { SitesApiClientOptions } from "./types";

/**
 * Languages resource group — environment-level language management.
 *
 * Languages are **environment-scoped** (not per-site): a language added
 * here becomes available to every site in the environment, and surfaces to
 * higher-level consumers that read the environment's languages (e.g. the
 * Sitecore AI brand-kit Glossary's org locales). `createSite` requires a
 * `language` ISO code that's already been added; the recipe-push pipeline
 * calls `addLanguage` first, then proceeds to site creation.
 *
 * Full CRUD on `/api/v1/languages` (verified against the Sites API OpenAPI
 * schema): list / list-supported / add / update / remove.
 */

export type Language = components["schemas"]["Language"];
export type AddLanguageModel = components["schemas"]["AddLanguageModel"];
export type SupportedLanguage = components["schemas"]["SupportedLanguage"];
export type EditLanguageInput = components["schemas"]["EditLanguageInput"];

/** List languages currently added to the environment. */
export const listLanguages = (options: SitesApiClientOptions): Promise<Language[]> =>
  sitesRequest<Language[]>(options, "/api/v1/languages");

/**
 * List the languages SitecoreAI *supports* — the catalog you can add from,
 * with canonical ISO codes + display names. Use it to resolve or validate a
 * code before `addLanguage` (`GET /api/v1/languages/supported`).
 */
export const listSupportedLanguages = (
  options: SitesApiClientOptions
): Promise<SupportedLanguage[]> =>
  sitesRequest<SupportedLanguage[]>(options, "/api/v1/languages/supported");

/**
 * Split a regional ISO code into the Sites API's `AddLanguageModel` shape.
 *
 * The add endpoint takes a SEPARATE `languageCode` + `regionCode`, not a
 * combined tag: a regional code like `fr-FR` must be sent as
 * `{ languageCode: "fr", regionCode: "FR" }` — posting `languageCode: "fr-FR"`
 * is rejected ("language 'fr-FR' with region code '' is not supported").
 * A bare language (`en`) carries no region. Splits on the first `-`; the
 * remainder (region or script subtag) becomes `regionCode`.
 */
export const parseLanguageCode = (isoCode: string): AddLanguageModel => {
  const trimmed = isoCode.trim();
  const dash = trimmed.indexOf("-");
  if (dash === -1) return { languageCode: trimmed };
  return { languageCode: trimmed.slice(0, dash), regionCode: trimmed.slice(dash + 1) };
};

/**
 * Add a language to the environment so sites can be created with it (and
 * so it surfaces to the environment's language consumers, e.g. the
 * brand-kit Glossary). Pass a raw `AddLanguageModel`; callers holding a
 * regional ISO code should split it first with {@link parseLanguageCode}.
 * If the language is already present, the API surfaces a 409-style error —
 * callers should treat "already added" as success.
 */
export const addLanguage = (
  options: SitesApiClientOptions,
  input: AddLanguageModel
): Promise<Language> =>
  sitesRequest<Language>(options, "/api/v1/languages", {
    method: "POST",
    body: input,
  });

/**
 * Update an existing environment language's metadata (display name,
 * fallback language, etc.) by its regional ISO code. Returns void — the
 * API answers 204 No Content. `PATCH /api/v1/languages/{isoCode}`.
 */
export const updateLanguage = (
  options: SitesApiClientOptions,
  isoCode: string,
  input: EditLanguageInput
): Promise<void> =>
  sitesRequest<void>(options, `/api/v1/languages/${encodeURIComponent(isoCode)}`, {
    method: "PATCH",
    body: input,
  });

/**
 * Remove a language from the environment by its regional ISO code.
 * Returns the API's boolean result. `DELETE /api/v1/languages/{isoCode}`.
 */
export const removeLanguage = (options: SitesApiClientOptions, isoCode: string): Promise<boolean> =>
  sitesRequest<boolean>(options, `/api/v1/languages/${encodeURIComponent(isoCode)}`, {
    method: "DELETE",
  });

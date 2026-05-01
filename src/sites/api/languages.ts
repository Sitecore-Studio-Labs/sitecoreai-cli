import { sitesRequest } from "./request";
import type { components } from "./schema";
import type { SitesApiClientOptions } from "./types";

/**
 * Languages resource group — recipe-required subset.
 *
 * `createSite` requires a `language` ISO code that's been added to
 * the environment. If a recipe specifies a language not yet present,
 * the recipe-push pipeline calls `addLanguage` first, then proceeds
 * to site creation.
 */

export type Language = components["schemas"]["Language"];
export type AddLanguageModel = components["schemas"]["AddLanguageModel"];

/** List languages currently added to the environment. */
export const listLanguages = (options: SitesApiClientOptions): Promise<Language[]> =>
  sitesRequest<Language[]>(options, "/api/v1/languages");

/**
 * Add a language to the environment so sites can be created with it.
 * If the language is already present, this is a no-op (the API
 * surfaces a 409-style error in that case; callers should treat
 * "already added" as success).
 */
export const addLanguage = (
  options: SitesApiClientOptions,
  input: AddLanguageModel
): Promise<Language> =>
  sitesRequest<Language>(options, "/api/v1/languages", {
    method: "POST",
    body: input,
  });

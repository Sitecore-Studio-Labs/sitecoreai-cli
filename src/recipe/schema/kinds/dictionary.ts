/**
 * `DictionaryRecipe` — the locale-aware phrase library kind.
 *
 * Split out of `kinds/site.ts` when this kind graduated to the stable
 * `./recipe` entry. It used to share that file with `SiteRecipe` and
 * `SiteTemplateRecipe`, which stayed unstable — so one file held schemas
 * on both sides of the stability boundary and a careless refactor could
 * cross the line invisibly. The schemas never shared internals
 * (`SiteTemplateTaxonomyEntry` belongs to SiteTemplate, `SiteGrouping` to
 * Site), so file layout now matches the stability boundary.
 */

import { z } from "zod";
import { HANDLE_PATTERN } from "../shared";

/**
 * One phrase in a `DictionaryRecipe`. The primary-locale value is
 * always required; additional locales land as translations keyed by
 * ISO code (e.g. `"en"`, `"fr-CA"`). When a site renders in a locale
 * that has no entry on the phrase, the primary-locale `defaultValue`
 * is the fallback.
 *
 * Mirrors the registry's `DictionaryPhrase`. MUST stay in sync.
 */
export const DictionaryPhraseSchema = z.object({
  /**
   * Value in the dictionary's primary locale. Always populated. Becomes
   * the default version of the Sitecore Dictionary Entry item's `Phrase`
   * field.
   */
  defaultValue: z.string(),
  /**
   * Per-locale translations. Each key is an ISO locale code (≥ 2 chars,
   * e.g. `en`, `fr-CA`); each value is that locale's version of the
   * phrase. Compiles to one item version per locale on the Sitecore
   * Dictionary Entry.
   */
  translations: z.record(z.string().min(2), z.string()).optional(),
  /**
   * Optional translator-facing note — context, tone hints, where the
   * phrase appears. Never rendered. Stored on the Dictionary Entry
   * item as a help-text / description field for translation tooling.
   */
  description: z.string().optional(),
});

export type DictionaryPhrase = z.infer<typeof DictionaryPhraseSchema>;

/**
 * A reusable, locale-aware phrase library — UI labels, form copy, CTA
 * strings — that one or more `SiteTemplateRecipe`s pull in via their
 * `dictionaries: HandleString[]` ref list.
 *
 * **Where the phrases land in Sitecore.** Each `DictionaryRecipe` is
 * scoped to a single `site` via the `site: HandleString` ref. At
 * install time the compiler materialises a Dictionary Folder named
 * after this recipe under `<site>/Dictionary/<recipe.name>/`, with
 * one Dictionary Entry item per `phrases` key. Each entry carries
 * one Sitecore item version per locale present in
 * `phrases[*].translations`, plus the primary-locale version from
 * `defaultValue`.
 *
 * **How sharing works.** Point the `site` ref at a `SiteRecipe` whose
 * `siteRole: "shared"` and the dictionary becomes the shared phrase
 * library every sibling site in the same collection inherits via
 * SXA's resolution chain. Point it at a regular `SiteRecipe` and the
 * dictionary is private to that one site. There's no extra wiring —
 * the inheritance behaviour comes from the site's role, not the
 * dictionary itself.
 *
 * **Composition.** `SiteTemplateRecipe` references dictionaries by
 * handle (`dictionaries: HandleString[]`); multiple templates can
 * reference the same `DictionaryRecipe`. Brand-specific dictionaries
 * layer on top of base ones by handle order (last-wins for duplicate
 * phrase keys). Per-site authoring tweaks live on
 * `SiteRecipe.dictionaryOverrides`.
 *
 * **Phrase-key contract.** Keys are stable identifiers (e.g.
 * `cta-learn-more`, `form-submit-label`). Renaming a key breaks every
 * consuming component. Add new keys freely; never repurpose an
 * existing one for a different meaning.
 *
 * Mirrors the registry's `DictionaryRecipe`. MUST stay in sync.
 */
export const DictionaryRecipeSchema = z.object({
  kind: z.literal("dictionary"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. core-ui-labels@1",
  }),
  /** Sitecore item name for the Dictionary Folder this recipe materialises. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * Optional host-site override. Omit it for the common case: the
   * dictionary lands under the deploy's TARGET site (the single site
   * the push targets, resolved from `context.sitePathSegment` — the
   * same `<siteCollection>/<site>` every page/enum install uses). This
   * gives dictionaries parity with pages, components, and enums, which
   * never carry a `site` handle and just install into the current site.
   *
   * Set it ONLY to host the phrases on a DIFFERENT in-set site than the
   * deploy target — e.g. a shareable phrase library pinned to a
   * `SiteRecipe` with `siteRole: "shared"` so sibling sites inherit it
   * via SXA's resolution chain. When set, the handle must resolve to a
   * `SiteRecipe` in the set (cross-recipe validation enforces this);
   * when omitted, no in-set `SiteRecipe` is required at all.
   */
  site: z
    .string()
    .regex(HANDLE_PATTERN, {
      message: "site must reference a SiteRecipe by handle, e.g. showcase-shared@1",
    })
    .optional(),
  /**
   * Primary locale these phrases are authored in (e.g. `"en"`,
   * `"en-US"`). Falls back to the host site's primary `language` when
   * omitted. Drives the default Sitecore item version for each entry.
   */
  primaryLocale: z.string().min(2).optional(),
  /**
   * Phrase library keyed by phrase key. Phrase keys are stable
   * identifiers (e.g. `cta-learn-more`, `form-submit-label`) — never
   * change them after publishing or every consuming component breaks.
   */
  phrases: z.record(z.string().min(1), DictionaryPhraseSchema).default({}),
});

export type DictionaryRecipe = z.input<typeof DictionaryRecipeSchema>;

import { z } from "zod";
import { HANDLE_PATTERN } from "../shared";

/**
 * Default taxonomy bucket on a `SiteTemplateRecipe`. Each bucket has a
 * root folder name (e.g. "Content Types") and a list of tag names that
 * become the default children. Sites can override the tag list
 * per-root via `SiteRecipe.taxonomyOverrides`.
 */
export const SiteTemplateTaxonomyEntrySchema = z.object({
  root: z.string().min(1),
  /** Default tag names under this root. Empty list means "create the root, no tags". */
  defaultTags: z.array(z.string().min(1)).default([]),
});

export type SiteTemplateTaxonomyEntry = z.infer<typeof SiteTemplateTaxonomyEntrySchema>;

/**
 * A `SiteTemplateRecipe` defines a reusable brand/site shape — page
 * templates, designs, partials (transitively), insert-options matrix,
 * templates-to-designs mapping, dictionary structure, and taxonomy
 * structure. The Sitecore SXA "site template" the registry's catalog
 * ships as a single artifact.
 *
 * Many `SiteRecipe`s can reference one `SiteTemplateRecipe`. A
 * customer with three brands has three Sites instancing one Template;
 * that's the multi-brand demo pattern this kind enables.
 *
 * Identity: `templateId(handle)` derives the GUID — site templates
 * are regular Sitecore template items under `/sitecore/templates/Project/<Module>`,
 * not Sites-API-managed instances. Compile path goes through
 * Authoring GraphQL, not the Sites API.
 *
 * Cross-recipe handle resolution: `pageTemplates` and
 * `insertOptionsMatrix.*` resolve to `PageTemplateRecipe` handles;
 * `pageDesigns` and `templatesToDesigns.*` values resolve to
 * `PageDesignRecipe` handles. The cross-recipe validator
 * (`validateRecipeSet`) catches missing handles before push.
 */
export const SiteTemplateRecipeSchema = z.object({
  kind: z.literal("site-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. ccl-brand-template@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  /**
   * Page-template handles this brand offers (resolve to
   * `PageTemplateRecipe`). The site's content tree allows pages
   * conforming to any of these.
   */
  pageTemplates: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  /**
   * Insert-options matrix — keyed by parent page-template handle,
   * value is the list of child page-template handles allowed under it.
   * Drives Sitecore's "Insert Options" UI for content authors.
   * Empty / omitted means no constraints (any page template can have
   * any other page template as a child).
   */
  insertOptionsMatrix: z
    .record(z.string().regex(HANDLE_PATTERN), z.array(z.string().regex(HANDLE_PATTERN)))
    .optional(),
  /**
   * Page-design handles this brand offers (resolve to
   * `PageDesignRecipe`). Authors pick from these when creating a page
   * unless `templatesToDesigns` provides a default for the page's
   * template.
   */
  pageDesigns: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  /**
   * Default templates-to-designs mapping — keyed by page-template
   * handle, value is the default page-design handle. Sites can
   * override per-template at the SXA Page Designs root level
   * (which scai's `compileRecipeSet` aggregates from
   * `PageDesignRecipe.appliesTo`).
   */
  templatesToDesigns: z
    .record(z.string().regex(HANDLE_PATTERN), z.string().regex(HANDLE_PATTERN))
    .optional(),
  /**
   * `DictionaryRecipe` handles whose phrases this template includes.
   * The dictionaries are NOT authored inline on the template — they
   * live as standalone `DictionaryRecipe`s pointing at a host
   * `SiteRecipe` via their `site` ref. The template just declares
   * which dictionaries every instance should pick up at install time.
   *
   * Order matters for duplicate phrase keys: later handles win
   * (last-wins, mirrors CSS cascade intuition).
   *
   * Replaces the pre-2026-06-06 inline `dictionary: Array<{phrase,
   * defaultValue}>` shape — that couldn't express per-locale
   * translations and tied phrase authoring to template authoring.
   * Compile emits NO ops for this field on the SiteTemplate side; the
   * phrases land via the dictionaries' own compile path. Cross-recipe
   * validation verifies every handle resolves to a `DictionaryRecipe`.
   *
   * Mirrors the registry's `SiteTemplateRecipe.dictionaries`. MUST stay
   * in sync.
   */
  dictionaries: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  /**
   * Default taxonomy structure. Sites can override tag lists per-root.
   */
  taxonomy: z.array(SiteTemplateTaxonomyEntrySchema).optional(),
  /**
   * Picker tile thumbnail — the small image Sitecore AI renders next
   * to the template's name in the "Create a site" UI. Discriminated
   * union over two authoring modes (locked 2026-06-06, renamed
   * 2026-06-06 after sub-milestone A's U3 finding):
   *
   *   - `kind: "external-url"` — author hosts the source bytes
   *     externally (CDN, S3, GitHub raw); the compiler fetches the
   *     bytes at compile time and uploads them to Sitecore's media
   *     library.
   *   - `kind: "asset"` — `path` is a registry-relative reference
   *     (e.g. `./thumbnail.png` sibling of this recipe). The compiler
   *     reads the file locally and uploads it to Sitecore's media
   *     library.
   *
   * **Both modes terminate in a media-library upload + a media-XML
   * write to the standard Sitecore `__Thumbnail` field** (GUID
   * `c7c26117-dbb1-42b2-ab5e-f7223845cca3`, encoding
   * `<image mediaid="{GUID}" />`). The difference is only the source
   * of the bytes: remote-URL fetch vs. local-path read. The
   * discriminator was renamed from `"url"` to `"external-url"` to
   * signal to authors that the URL is a source of bytes, not the
   * literal field value — writing a raw URL to `__Thumbnail` would
   * silently no-op (U3 finding in
   * `docs/plans/site-template-modules-and-picker.investigation.json`).
   *
   * **scai gap:** the field is dropped entirely at install today.
   * Compile-side wiring (media-upload IR op + SetField on
   * `__Thumbnail`) is sub-milestone C/D, gated on A's findings.
   */
  thumbnail: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("external-url"),
        url: z.string().min(1),
        alt: z.string().optional(),
      }),
      z.object({
        kind: z.literal("asset"),
        path: z.string().min(1),
        alt: z.string().optional(),
      }),
    ])
    .optional(),
  /**
   * Detail-panel content summary — what the picker shows under the
   * hero image when a tile is selected.
   *
   * Encoded as an array of `{ name, content }` pairs — the Sites API
   * picker decodes this to `StringStringKeyValuePair[]` where `name`
   * becomes the section heading (e.g. "Pages", "Components",
   * "Integrations") and `content` becomes the body text under it.
   *
   * Sub-milestone A's U4 finding
   * (`docs/plans/site-template-modules-and-picker.investigation.json`)
   * established the source field is the SXA `Content` field (GUID
   * `da855368-…`, Multi-Line Text); the on-disk encoding is a
   * JSON-serialized array stored as a string. Production examples
   * (Empty Site, Solterra and Co, SYNC, Alaris) all carry the
   * `Array<{name, content}>` shape. The schema was originally
   * `z.string()` (sub-milestone C land); changed to an array of pairs
   * on sub-milestone D after A's evidence landed.
   */
  contents: z
    .array(
      z.object({
        name: z.string().min(1),
        content: z.string().min(1),
      })
    )
    .optional(),
});

export type SiteTemplateRecipe = z.input<typeof SiteTemplateRecipeSchema>;

/**
 * Site grouping — hostname + language binding. The Sitecore Sites API
 * `NewSiteInput.hostName` field receives `hostName`; multi-host
 * setups are configured via separate Site Hosts after creation
 * (Sites API has its own hosts surface for that, not modelled here).
 */
export const SiteGroupingSchema = z.object({
  /**
   * Hostname this site responds to (e.g. `solterra.example.com`).
   * Optional — Sites API defaults to `*` (matches any host) when
   * omitted. Tenants with one site per environment can leave this
   * blank; multi-brand tenants set it explicitly.
   */
  hostName: z.string().min(1).optional(),
  /**
   * Language ISO code for this grouping. Defaults to the site's
   * primary `language` if not set; provided here for forward-compat
   * with multi-language groupings (e.g. one site responds to
   * `en.example.com` and `de.example.com`).
   */
  language: z.string().min(2).optional(),
  /**
   * Optional target host for hostname rewrites — used when the site
   * lives behind a CDN/proxy that maps a public hostname to an
   * internal one. SXA's `targetHostName` field; rarely set.
   */
  targetHostName: z.string().min(1).optional(),
});

export type SiteGrouping = z.infer<typeof SiteGroupingSchema>;

/**
 * A `SiteRecipe` instances a `SiteTemplateRecipe` at a specific path
 * with a specific hostname and language. Customers with multiple
 * brands ship multiple SiteRecipes pointing at the same template;
 * each gets its own hostname, content tree, taxonomy values, and
 * dictionary overrides.
 *
 * Identity: `siteId(handle)` derives a stable refKey for IR purposes.
 * The actual Sitecore site itemId is server-assigned by the Sites API
 * `createSite` mutation (which runs as a job — callers poll
 * `getJobStatus` until the site is materialised).
 *
 * Compile path: `SiteRecipe` execution goes through the Sites API
 * (`src/sites/api/`), not Authoring GraphQL. The compiler emits a
 * `CreateSiteFromTemplate` IR op that the executor dispatches to
 * Sites API; site-grouping fields, dictionary overrides, and
 * taxonomy overrides land via subsequent ops on the resulting site.
 *
 * Cross-recipe handle resolution: `siteTemplate` resolves to a
 * `SiteTemplateRecipe`; `initialHome` (when present) resolves to a
 * `PageRecipe`.
 */
export const SiteRecipeSchema = z.object({
  kind: z.literal("site"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. solterra-co@1",
  }),
  /**
   * Sitecore site item Name (becomes the `siteName` on Sites API
   * `NewSiteInput`). Distinct from `handle` — handle is the recipe
   * identity, name is what Sitecore stores.
   */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * The `SiteTemplateRecipe` this site instances. Compiler resolves
   * to the template's Sitecore itemId (which Sites API
   * `NewSiteInput.templateId` requires) via `templateId(handle)` +
   * captured-itemId map at execute time.
   */
  siteTemplate: z.string().regex(HANDLE_PATTERN, {
    message:
      "siteTemplate must reference a SiteTemplateRecipe by handle, e.g. ccl-brand-template@1",
  }),
  /**
   * Primary language ISO code (e.g. `en`, `da`, `fr-CA`). Must be
   * available on the environment — recipe push adds it via
   * Sites API `addLanguage` if not already present.
   */
  language: z.string().min(2),
  /**
   * Additional supported languages on this site. Each must be
   * available on the environment (recipe push adds missing ones).
   */
  languages: z.array(z.string().min(2)).optional(),
  /**
   * Existing site collection ID to place the site in. Mutually
   * exclusive with `collectionName` (cross-field constraint enforced
   * by the compiler, not Zod — the discriminated union can't carry
   * refinements). Look up via `listCollections`.
   */
  collectionId: z.string().min(1).optional(),
  /**
   * Name of a NEW collection to create alongside the site. Mutually
   * exclusive with `collectionId`. Exactly one of these must be
   * provided — compiler validates.
   */
  collectionName: z.string().min(1).optional(),
  /** Display name for the new collection (only when `collectionName` is set). */
  collectionDisplayName: z.string().min(1).optional(),
  /** Description for the new collection (only when `collectionName` is set). */
  collectionDescription: z.string().optional(),
  /**
   * Sitecore content-tree path of the collection, used to compose
   * dictionary / taxonomy override target paths
   * (`<collectionPath>/<siteName>/Dictionary/<phrase>` etc.). Optional —
   * when unset, the compiler derives a path from `collectionName`
   * (`/sitecore/content/<collectionName>`) per the SXA default
   * convention. **Required** when `collectionId` is used AND the recipe
   * declares any dictionary or taxonomy overrides — there's no way to
   * resolve `collectionId` to a content-tree path at compile time.
   * Without it, the compiler skips override emission entirely (push
   * still creates the site, but the overrides don't apply).
   *
   * Operator-supplied. The compiler trims a trailing `/` defensively
   * but otherwise treats this as the truth.
   */
  collectionPath: z.string().min(1).optional(),
  /**
   * Site grouping — hostname binding. Sites API uses
   * `NewSiteInput.hostName` for the primary host; multi-host setups
   * use the separate Site Hosts surface.
   */
  siteGrouping: SiteGroupingSchema.optional(),
  /**
   * Optional site role. The SXA convention for sharing content
   * (dictionary phrases, datasources, media) across sibling sites in a
   * collection is to give one site the role `shared` — it lands at
   * `<collection>/Shared` and sibling sites automatically inherit its
   * content via SXA's resolution chain.
   *
   *   - omitted / `"regular"` — a normal site under the collection
   *   - `"shared"` — the collection's shared content host. The compiler
   *     uses the SXA "Create shared site" template path and lands the
   *     site at `<collection>/Shared`. At most ONE shared site is
   *     allowed per collection — cross-recipe validation enforces this.
   *
   * `DictionaryRecipe`s pointing at this site via their `site` ref
   * become the shareable phrase library every sibling site picks up.
   *
   * Mirrors the registry's `SiteRecipe.siteRole`. MUST stay in sync.
   */
  siteRole: z.enum(["regular", "shared"]).optional(),
  /**
   * Per-phrase overrides for dictionary values declared on the
   * dictionaries the site's template references. Keys are phrase keys;
   * values are either a flat string (overrides the primary-locale
   * value) or a per-locale map (override specific locales while
   * leaving others on the dictionary's default). Phrases not in this
   * map use the dictionary's authored values verbatim.
   *
   * Locale keys must be ≥ 2 chars (ISO codes like `en`, `fr-CA`).
   *
   * Mirrors the registry's `SiteRecipe.dictionaryOverrides`. MUST stay
   * in sync.
   */
  dictionaryOverrides: z
    .record(z.string().min(1), z.union([z.string(), z.record(z.string().min(2), z.string())]))
    .optional(),
  /**
   * Per-root override for taxonomy default tags. Keys are taxonomy
   * root names declared on the template; values replace the
   * template's default tag list for that root.
   */
  taxonomyOverrides: z.record(z.string().min(1), z.array(z.string().min(1))).optional(),
  /**
   * Optional initial home page — a `PageRecipe` handle. Cross-recipe
   * validation resolves it to a `page` recipe in the set.
   */
  initialHome: z.string().regex(HANDLE_PATTERN).optional(),
});

export type SiteRecipe = z.input<typeof SiteRecipeSchema>;

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
   * The site whose `/Dictionary/` subtree this recipe lands under. For
   * a shareable phrase library, point at a `SiteRecipe` with
   * `siteRole: "shared"` — sibling sites in the collection inherit the
   * phrases via SXA's resolution chain. For a site-private dictionary,
   * point at a regular site. Cross-recipe validation enforces that the
   * handle resolves to a `SiteRecipe` in the set.
   */
  site: z.string().regex(HANDLE_PATTERN, {
    message: "site must reference a SiteRecipe by handle, e.g. showcase-shared@1",
  }),
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

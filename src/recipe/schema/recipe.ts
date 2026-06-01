import { z } from "zod";
import { FieldShapeSchema, SitecoreFieldTypeSchema } from "./field-types";

/**
 * Multi-segment folder path accepted by `location.folder` /
 * `placeholder.folder`. Two wire shapes:
 *
 *   Array form (canonical):    `["Theme", "Color"]`
 *   Slash-string form (legacy): `"Theme/Color"`
 *
 * Both normalize to `string[]` after parsing. The registry moved its
 * recipe schema to array form because the slash-string was implicit
 * and fragile to author through Agent Studio (no IDE help for the
 * segments inside the string); scai accepts both so old recipes keep
 * working and new ones use the explicit shape. Empty segments
 * (`""` / `"a//b"`) after split + trim are filtered out so callers
 * don't have to remember to clean them.
 *
 * Downstream consumers (compile/enumeration, compile/placeholder,
 * read-current) all see `string[]` and don't need to split anything
 * themselves.
 */
const FolderPath = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .transform((value) => {
    const segments = (Array.isArray(value) ? value : value.split("/")).map((s) => s.trim());
    return segments.filter((s) => s.length > 0);
  })
  .pipe(z.array(z.string().min(1)).min(1));

/**
 * Recipe author surface — what users hand-author for one Sitecore template.
 *
 * Two recipe kinds:
 *
 *   ComponentTemplateRecipe — Has a rendering. Becomes a placeable component
 *                             on Sitecore pages. Owns its datasource template
 *                             AND its rendering item.
 *   ContentTemplateRecipe   — Fields only, no rendering. A data shape
 *                             referenced by other recipes (Treelist source,
 *                             child-item pattern, etc.). Not placeable on a
 *                             page directly.
 *
 * Component recipes have three peer buckets reflecting the Sitecore mechanism
 * each piece of state uses:
 *
 *   fields    Datasource fields — per-content, reusable across placements.
 *   variants  SXA Rendering Variants — items under <Rendering>/Variants,
 *             selected per-placement via the FieldNames parameter. Maps
 *             to a CVA component's `variant` axis.
 *   params    Plain Rendering Parameters — key/value on the placement,
 *             not shared. Maps to orthogonal CVA modifiers (size, color).
 *
 * Both kinds may declare `insertOptions: string[]` — recipe handles whose
 * templates are allowed as direct children of this datasource item (the
 * child-item pattern, e.g. accordion → accordion-items).
 *
 * **This schema must stay in sync with the registry's working copy at
 * `<registry>/src/lib/registry/sitecore-recipes.ts`.** Once scai exposes a
 * typed recipe export, the registry imports from scai and the duplication
 * goes away.
 *
 * The `handle` is load-bearing forever — a uuidv5 derives every item GUID
 * from it (see `guids.ts`), so renaming a handle creates a *different*
 * template.
 */

const HANDLE_PATTERN = /^[a-z][a-z0-9-]*@[0-9]+$/;

/**
 * The picker-scope source ("Sitecore's Source field") expressed as a
 * discriminated union over the three real modes:
 *
 *   - `filter` — composable structured fields. `types` is a picker
 *     filter restricting which recipe-defined templates appear; `query`
 *     is a Sitecore Query; `scope` is a fixed content-tree path. They
 *     combine, e.g. `scope + types` → `DataSource=<path>&IncludeTemplatesForSelection=...`.
 *   - `raw` — verbatim Source string, the escape hatch. Use when the
 *     structured surface doesn't fit (e.g. a bare path Treelist source
 *     like `/sitecore/content/Tags`).
 *   - `plugin` — Sitecore Marketplace plugin slug. Paired with
 *     `sitecore.type: "Plugin"`. The compiler emits the slug verbatim
 *     into the field's `Source`; the Marketplace shell looks it up
 *     against its installed-plugins catalog to mount the iframe.
 *
 * Previously the four fields were peers on `SitecoreFieldAugment` with
 * a `.refine` enforcing the mutex; the union makes the constraint
 * structural so JSON Schema's `oneOf` expresses it natively and Agent
 * Studio can't emit an invalid combination. See
 * `docs/recipe-schema-audit.md` (A1).
 */
export const SitecoreFieldSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("filter"),
    types: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Picker filter: restrict to items conforming to one of these recipe handles. Compiler resolves each handle to its deterministic template GUID and emits `IncludeTemplatesForSelection={GUID},{GUID}`."
      ),
    query: z
      .string()
      .optional()
      .describe(
        "Where to look: a Sitecore Query (e.g. `$site/*[@@name='Data']`). Standalone becomes `query:<query>`; combined with `types` becomes `DataSource=query:<query>&IncludeTemplatesForSelection=...`."
      ),
    scope: z
      .string()
      .optional()
      .describe(
        "Where to look: a fixed Sitecore content-tree path. Emitted as `DataSource=<path>`, alone or combined with `types`."
      ),
  }),
  z.object({
    kind: z.literal("raw"),
    value: z
      .string()
      .min(1)
      .describe(
        "Verbatim Sitecore Source string. Escape hatch for Source shapes that don't fit the `filter` mode (e.g. a bare path Treelist source like `/sitecore/content/Tags`)."
      ),
  }),
  z.object({
    kind: z.literal("plugin"),
    id: z
      .string()
      .min(1)
      .describe(
        "Stable logical key identifying the marketplace plugin (e.g. `sai/matrix-editor`). Recipe-side handle; the orchestrator's recipe-sync resolver maps it to a per-org `app_id` UUID and substitutes that into `defaultAppId` before scai consumes the recipe. scai's compiler emits the substituted UUID — not this key — into the Sitecore field's `Source`."
      ),
    defaultAppId: z
      .string()
      .min(1)
      .max(256)
      .describe(
        "UUID of the recipe author's published marketplace app (the value Sitecore returns via the Marketplace SDK's `application.context.id`). Used by the resolver unless the org has a per-org override in `internal.marketplace_plugin_overrides`."
      ),
  }),
]);

export type SitecoreFieldSource = z.infer<typeof SitecoreFieldSourceSchema>;

/**
 * Sitecore-side override on a field or param. Defaults apply when
 * omitted.
 *
 * `source` carries the picker-scope shape as a discriminated union
 * (`filter` | `raw` | `plugin`) — see `SitecoreFieldSourceSchema`.
 * Internal scai code converts to a flat `SourceFields` bag via
 * `augmentSourceToFields()` before passing to `renderSourceFields()`.
 */
/**
 * Defensive guard: pre-A1 recipes carried `sourceTypes` / `sourceQuery` /
 * `sourceScope` / `sourceRaw` as peer optional fields on the augment.
 * After A1 the picker scope lives inside a discriminated `source`
 * union. Without this guard Zod's default `.strip()` would silently
 * drop the legacy keys and produce a parsed augment with no `source`
 * — losing author intent quietly. Reject explicitly with a migration
 * pointer instead.
 */
const LEGACY_SOURCE_KEYS = ["sourceTypes", "sourceQuery", "sourceScope", "sourceRaw"] as const;

export const SitecoreFieldAugmentSchema = z
  .object({
    /** Override the default shape→Sitecore type mapping. */
    type: SitecoreFieldTypeSchema.optional(),
    /**
     * Picker scope — discriminated union of two modes: `filter`
     * (composable `types` / `query` / `scope`) or `raw` (verbatim
     * Source string). See `SitecoreFieldSourceSchema`.
     */
    source: SitecoreFieldSourceSchema.optional(),
    /** Author-facing hint surfaced in the CMS. */
    hint: z.string().optional(),
    /** Required marker (translates to a Sitecore validation rule). */
    required: z.boolean().optional(),
    /** Default value via the template's __Standard Values item. */
    defaultValue: z.string().optional(),
    /**
     * For enum-shaped fields: handle of an `EnumerationRecipe` whose
     * value items back this field's dropdown. When set, the compiler:
     *   - emits `Type: Droplink` and `Source: <enum's content path>`
     *     so the editor enumerates the shared enum's child items;
     *   - resolves the field's `default` against that enum's value
     *     items (so `default: "primary"` becomes a GUID reference to
     *     the corresponding value item).
     *
     * Inline enums (no `enumHandle`) get value items emitted as
     * children of the field-definition itself, scoped to the field.
     * Use `enumHandle` for shared enums (color schemes, size scales,
     * spacing scales) so adding/renaming a value updates every
     * referencing field on the next push.
     */
    enumHandle: z.string().regex(HANDLE_PATTERN).optional(),
    /** Ordinal within the section/params block; auto-assigned 100/200/… if omitted. */
    sortOrder: z.number().int().optional(),
    /**
     * Section name to group this field under (only meaningful for `fields`,
     * not `params`/`variants`). Defaults to "Content".
     */
    section: z.string().optional(),
    /**
     * Sitecore field storage axis — how a value is scoped on items
     * conforming to the template:
     *  - `versioned` (default) — a value per language *and* per numbered
     *    version.
     *  - `unversioned` — a value per language, shared across numbered
     *    versions.
     *  - `shared` — a single value for the whole item, every language and
     *    version.
     * Omit for the Sitecore default (`versioned`). Determines whether
     * per-language / per-version content is meaningful for this field.
     */
    storage: z.enum(["versioned", "unversioned", "shared"]).optional(),
  })
  .passthrough()
  .superRefine((augment, ctx) => {
    // Pre-A1 recipes carried sourceTypes/sourceQuery/sourceScope/sourceRaw
    // as peer fields; the new shape is `source: { kind, ... }`. Without
    // `.passthrough()` Zod's default `.strip()` would drop those keys
    // before the refine runs; with passthrough they survive to here and
    // we reject loudly with a migration pointer.
    const legacyPresent = LEGACY_SOURCE_KEYS.filter(
      (key) => (augment as Record<string, unknown>)[key] !== undefined
    );
    if (legacyPresent.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [legacyPresent[0]],
        message: `Legacy source field(s) [${legacyPresent.join(", ")}] are no longer accepted on \`sitecore\`. Move them into the new \`source\` discriminated union: \`source: { kind: "filter", types/query/scope }\` or \`source: { kind: "raw", value }\`. See docs/recipe-schema-audit.md (A1).`,
      });
    }
  });

export type SitecoreFieldAugment = z.infer<typeof SitecoreFieldAugmentSchema>;

export const FieldDefinitionSchema = z.object({
  name: z.string().min(1),
  shape: FieldShapeSchema,
  /** Required when `shape === "enum"` — the enumerated values. */
  values: z.array(z.string()).optional(),
  /** For `shape === "reference"`: false = single (Droplink), true = multi (Treelist). */
  multiple: z.boolean().optional(),
  /** Default value at the abstract layer (also passable via `sitecore.defaultValue`). */
  default: z.string().optional(),
  sitecore: SitecoreFieldAugmentSchema.optional(),
});

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const DesignParameterSchema = z.object({
  name: z.string().min(1),
  shape: FieldShapeSchema,
  values: z.array(z.string()).optional(),
  default: z.string().optional(),
  sitecore: SitecoreFieldAugmentSchema.optional(),
});

export type DesignParameter = z.infer<typeof DesignParameterSchema>;

/**
 * Phase 1 = Variants Lite: bare Variant item per `name`, no internal
 * structure. Phase 2+ may add per-variant template-card bindings for full
 * SXA NVELOPe authoring.
 *
 * `name` MUST be PascalCase. The Sitecore Content SDK looks up variants
 * at render time via case-sensitive `component[name]` indexing on the
 * component module's named exports, and React convention requires
 * exported component identifiers to be PascalCase. Using lowercase or
 * kebab-case here makes the SDK's variant lookup return `undefined` —
 * Pages then renders the missing-component fallback.
 *
 * The `Default` variant is special-cased by the SDK
 * (`DEFAULT_EXPORT_NAME = "Default"`): when `params.FieldNames` matches
 * that, the SDK falls through to `component.default || component.Default
 * || component`, so any of those export shapes work for the default
 * variant. All OTHER variant names require an exact-match named export
 * in the component file (e.g. `name: "FullWidth"` → `export function
 * FullWidth(...)`).
 */
const VARIANT_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
export const RenderingVariantDefinitionSchema = z.object({
  name: z.string().regex(VARIANT_NAME_PATTERN, {
    message:
      "Variant `name` must be PascalCase (e.g. `Default`, `FullWidth`) — the Content SDK uses it as a case-sensitive key into the component module's named exports.",
  }),
});

export type RenderingVariantDefinition = z.infer<typeof RenderingVariantDefinitionSchema>;

/**
 * An inline placeholder slot a container component EXPOSES for child
 * renderings to drop into. The hybrid placeholder model's component-owned
 * half: a Section / Grid / Tabs component declares the slots it owns
 * here; site-level chrome slots (`/header`, `/footer`) that belong to no
 * single component are authored as a standalone `PlaceholderRecipe`
 * instead.
 *
 * Both forms compile to the same artifact — one Sitecore Placeholder
 * Settings item per unique `key` — emitted by the cross-recipe
 * `buildPlaceholderSettingsAggregate` (see `compile.ts`). Identity is the
 * `key`, so an inline slot and a `PlaceholderRecipe` MUST NOT name the
 * same key; `validateRecipeSet` flags the collision.
 */
export const PlaceholderDefinitionSchema = z.object({
  /**
   * Sitecore Placeholder Key — the string layout XML references in its
   * `placeh` attribute (e.g. `headless-main`, `grid-content`). For a
   * `dynamic` placeholder this is the static PREFIX; SXA appends the
   * `-{uid}-{index}` suffix at render time.
   */
  key: z.string().min(1),
  /** Author-facing label on the Placeholder Settings item. Defaults to `key`. */
  displayName: z.string().min(1).optional(),
  /**
   * Optional grouping folder path under the placeholder settings root —
   * the Placeholder Settings item lands at
   * `<placeholderSettingsRoot>/<folder>/<name>`. Multi-segment paths
   * (`"Partial Design/Header"`) split on `/`; each segment is
   * materialised once as a `CreateOnly` folder conforming to the SXA
   * `Placeholder Settings Folder` template, so it inherits the right
   * Insert Options. Recipes naming the same folder share it. Omit → the
   * item lands flat at the root.
   */
  folder: FolderPath.optional(),
  /**
   * SXA dynamic placeholder. When true the host rendering must also set
   * `dynamicPlaceholders: true` so SXA generates per-instance keys; the
   * Placeholder Settings item is still keyed by the static prefix here.
   */
  dynamic: z.boolean().optional(),
  /**
   * Restriction: only renderings of these `ComponentTemplateRecipe`
   * handles may be dropped into this slot. Compiles to the slot's
   * `Allowed Controls` whitelist, unioned with any component that names
   * this `key` in its `placedIn`. Empty/omitted = no slot-side
   * restriction (the union is then driven entirely by `placedIn`).
   */
  allowedComponents: z.array(z.string().regex(HANDLE_PATTERN)).optional(),
  /**
   * Alias of `allowedComponents`. The registry-side recipe schema
   * names this field `allowedRenderingHandles` (the handles ARE
   * rendering handles, so the name is more descriptive); scai's
   * canonical name stayed `allowedComponents` for historical
   * reasons. Accept both at the schema layer so recipes authored
   * against either name compile — the compiler normalises them via
   * `resolveAllowedHandles` below.
   */
  allowedRenderingHandles: z.array(z.string().regex(HANDLE_PATTERN)).optional(),
});

export type PlaceholderDefinition = z.infer<typeof PlaceholderDefinitionSchema>;

/**
 * Normalise the two-name surface (`allowedComponents` /
 * `allowedRenderingHandles`) into a single ordered list. Either may be
 * set; if both are set their union is returned (de-duped, source
 * order). Use everywhere the compiler reads the slot-side allowed
 * list so the rename stays a no-op for downstream code.
 */
export const resolveAllowedHandles = (slot: PlaceholderDefinition): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const handle of [
    ...(slot.allowedComponents ?? []),
    ...(slot.allowedRenderingHandles ?? []),
  ]) {
    if (seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
};

/**
 * A standalone placeholder — the hybrid model's site-chrome half. Slots
 * like `/header`, `/footer`, `/main`, or a page-design CTA band belong to
 * no single component; they're authored as their own recipe so partials
 * and page designs have a typed, validated target to place renderings
 * into.
 *
 * Compiles (via `buildPlaceholderSettingsAggregate`) to one Sitecore
 * Placeholder Settings item under the tenant's `placeholderSettingsRoot`,
 * carrying the `Placeholder Key` and an `Allowed Controls` whitelist =
 * `allowedComponents` ∪ every component whose `placedIn` names this
 * `key`.
 *
 * Identity: `placeholderSettingsId(site, key)` — keyed by `key`, not
 * `handle`. The `handle` is the authoring-surface identity used for
 * cross-recipe references and validation messages.
 */
export const PlaceholderRecipeSchema = z.object({
  kind: z.literal("placeholder"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. site-header-slot@1",
  }),
  /**
   * Sitecore Placeholder Key — the string layout XML references. For a
   * `dynamic` placeholder this is the static prefix. Load-bearing: the
   * emitted item's GUID derives from `key`, so renaming it creates a
   * different placeholder.
   */
  key: z.string().min(1),
  /** Sitecore item name under the Placeholder Settings root. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  /**
   * Optional grouping folder path under the placeholder settings root —
   * the item lands at `<placeholderSettingsRoot>/<folder>/<name>`.
   * Multi-segment (`"Partial Design/Header"`) splits on `/`; each
   * segment is a `CreateOnly` folder conforming to the SXA `Placeholder
   * Settings Folder` template (inheriting its Insert Options). Recipes
   * naming the same folder share it. Omit → flat at the root.
   */
  folder: FolderPath.optional(),
  /** SXA dynamic placeholder — see `PlaceholderDefinitionSchema.dynamic`. */
  dynamic: z.boolean().default(false),
  /**
   * `ComponentTemplateRecipe` handles whose renderings may be dropped
   * here. Unioned with any component naming this `key` in `placedIn` to
   * form the `Allowed Controls` whitelist.
   */
  allowedComponents: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
});

export type PlaceholderRecipe = z.infer<typeof PlaceholderRecipeSchema>;

/**
 * One entry in the modern semantic-scope datasource locations list.
 *
 * Each entry compiles to a single Sitecore Source segment; the compiler
 * pipe-joins entries into the rendering's `Datasource Location` field so
 * one rendering can offer authors per-page auto-creation AND a shared
 * site-level pool of datasources to pick from.
 *
 *   - `page` → relative `./Data` (no subfolder) or `./Data/<subfolder>`.
 *     SXA materialises the `Data` and `<subfolder>` items lazily on first
 *     datasource creation; no extra CreateItem op is emitted.
 *   - `site` → absolute `<contentItemsRoot>` (no subfolder) or
 *     `<contentItemsRoot>/<subfolder>`. With `subfolder` the compiler
 *     emits a `CreateOnly` `CreateItem` for the data folder so the
 *     shared pool exists before any rendering tries to read from it.
 */
export const RenderingDatasourceLocationSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("page"),
    /** Optional `Data` subfolder; absent = `./Data`. */
    subfolder: z.string().min(1).optional(),
    /**
     * Optional per-location insert-option scoping. When set, the
     * subfolder's Insert Options field is constrained to the listed
     * handles instead of inheriting the rendering's full datasource
     * template set. Lets one rendering with multiple subfolders give
     * each subfolder its own allow-list (e.g. avatar-block's
     * page-Avatars accepts `avatar-block@1`, site-Authors accepts
     * `author@1`).
     */
    allowedTemplates: z
      .array(z.object({ handle: z.string().regex(HANDLE_PATTERN) }))
      .min(1)
      .optional(),
  }),
  z.object({
    scope: z.literal("site"),
    /**
     * Optional subfolder under `<contentItemsRoot>`. When present the
     * compiler emits a `CreateOnly` folder item so the shared pool is
     * materialised once per recipe-set.
     */
    subfolder: z.string().min(1).optional(),
    allowedTemplates: z
      .array(z.object({ handle: z.string().regex(HANDLE_PATTERN) }))
      .min(1)
      .optional(),
  }),
]);

export type RenderingDatasourceLocation = z.infer<typeof RenderingDatasourceLocationSchema>;

/**
 * Top-level datasource block on `ComponentTemplateRecipe`. Captures
 * everything the rendering needs to know about its datasource:
 *
 *   - **template**: optional reference to a single
 *     `ContentTemplateRecipe`. Shortcut for the common single-template
 *     case; equivalent to `templates: [{handle}]` with one entry. When
 *     unset (and `templates` is unset, and the recipe has no inline
 *     `fields:`), the rendering has no Datasource Template at all.
 *   - **templates**: multiple compatible datasource templates — the
 *     "compatible-datasources" pattern. The compiler pipe-joins each
 *     template's GUID into the rendering's `Datasource Template`
 *     shared field, so the Pages picker surfaces items conforming to
 *     *any* of the listed templates. Mutually exclusive with `template`.
 *   - **autoCreate**: toggles `IsAutoDatasourceRendering=true` in the
 *     rendering's `OtherProperties` URL-encoded blob. Default true.
 *     With `templates`, default to `false` at the recipe level — the
 *     compiler can't pick one template unambiguously, so the dropping
 *     author should be prompted to choose via the datasource picker.
 *   - **openPropertiesAfterAdd**: opens the rendering parameters
 *     dialog right after the rendering is dropped on a page. Default
 *     false.
 *   - **locations**: semantic page/site scope entries — each compiles
 *     to one Sitecore Source segment (a relative `./Data/...` path or
 *     an absolute `<contentItemsRoot>/...` path).
 *   - **query**: raw Sitecore Source segments — included verbatim.
 *     Use `"query:$site/*[@@name='Data']/CustomPath"`-style entries for
 *     authors who need a Source shape that doesn't fit the semantic
 *     `locations` model.
 *
 * The compiler pipe-joins `locations` (resolved to paths) and `query`
 * (verbatim) into the rendering's `Datasource Location` field.
 */
export const RecipeDatasourceSchema = z
  .object({
    /**
     * Reference to a single `ContentTemplateRecipe`. Shortcut for the
     * common case; equivalent to `templates: [{handle}]` with one
     * entry. Mutually exclusive with `templates`.
     */
    template: z
      .object({
        handle: z.string().regex(HANDLE_PATTERN, {
          message: "datasource.template.handle must match `<kebab-name>@<major>`",
        }),
      })
      .optional(),
    /**
     * Multiple compatible datasource templates. Each resolves to its
     * deterministic template GUID; the compiler pipe-joins them into
     * the rendering's `Datasource Template` shared field. Pair with a
     * React-side adapter that normalises whichever field shape the
     * layout service delivers. Mutually exclusive with `template`.
     */
    templates: z
      .array(
        z.object({
          handle: z.string().regex(HANDLE_PATTERN, {
            message: "datasource.templates[].handle must match `<kebab-name>@<major>`",
          }),
        })
      )
      .min(1)
      .optional(),
    /** Sets `IsAutoDatasourceRendering` in `OtherProperties`. Default true. */
    autoCreate: z.boolean().default(true),
    /** Open the properties dialog after add. Default false. */
    openPropertiesAfterAdd: z.boolean().default(false),
    /**
     * Semantic-scope locations that compile to a path-style Sitecore
     * Source segment each. Empty when only `query` entries are needed.
     */
    locations: z.array(RenderingDatasourceLocationSchema).default([]),
    /**
     * Raw Sitecore Source segments — included verbatim in the joined
     * `Datasource Location` field. Each entry should be a complete
     * segment (e.g. `"query:$site/*[@@name='Data']/Custom"` or
     * `"fast:/sitecore/content/...//*[@@templatename='Foo']"`). Empty
     * when only `locations` entries are needed.
     */
    query: z.array(z.string().min(1)).default([]),
  })
  .refine((ds) => !(ds.template !== undefined && ds.templates !== undefined), {
    message:
      "Set either `datasource.template` (single) or `datasource.templates` (multi), not both — the compiler ignores `template` when `templates` is set, which silently drops author intent. Pick one form per recipe.",
    path: ["templates"],
  });

export type RecipeDatasource = z.infer<typeof RecipeDatasourceSchema>;

/**
 * Container for a related set of components in the Sitecore tree.
 * Owns the SIX organisational items that previously emitted implicitly
 * from `ComponentTemplateRecipe.section: string`:
 *
 *   1. Templates section folder        — `<componentsRoot>/<name>/`
 *   2. Component Folders bucket        — `<componentsRoot>/<name>/Component Folders/`
 *   3. Presentation Parameters bucket  — `<componentsRoot>/<name>/Presentation Parameters/`
 *   4. Renderings-tree section folder  — `<renderingsRoot>/<name>/`
 *   5. Headless Variants section       — `<headlessVariantsRoot>/<name>/`
 *   6. Available Renderings section    — `<availableRenderingsRoot>/<name>` (built by
 *                                        the cross-recipe aggregator from every
 *                                        `ComponentTemplateRecipe` referencing this
 *                                        section by handle)
 *
 * `ComponentTemplateRecipe.section` references this recipe by handle
 * (`section: { handle: "ui-section@1" }`); the compiler errors at
 * INPUT_INVALID time if a component points at a section handle no
 * `ComponentSectionRecipe` in the set defines.
 */
export const ComponentSectionRecipeSchema = z.object({
  kind: z.literal("component-section"),
  schemaVersion: z.literal("1"),
  /** Stable identifier of the form `<kebab-name>@<major>`, e.g. `ui-section@1`. */
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. ui-section@1",
  }),
  /** Folder name in the Sitecore tree (e.g. `"ui"`). */
  name: z.string().min(1),
  /** Author-facing label (defaults to `name`). */
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  /** Defaults to `office/16x16/folder.png`. */
  icon: z.string().optional(),
  /**
   * Sort order across sections. Optional. Default = alphabetic by
   * `name` (a–z). When `sortOrder` is set on any section in the set,
   * sections with explicit values sort numerically first; ties and
   * unset entries fall through to alphabetic by name.
   */
  sortOrder: z.number().int().optional(),
});

export type ComponentSectionRecipe = z.infer<typeof ComponentSectionRecipeSchema>;

export const ComponentTemplateRecipeSchema = z
  .object({
    kind: z.literal("component-template"),
    schemaVersion: z.literal("1"),
    /** Stable identifier of the form `<kebab-name>@<major>`, e.g. `cta-button@1`. */
    handle: z.string().regex(HANDLE_PATTERN, {
      message: "handle must match `<kebab-name>@<major>`, e.g. cta-button@1",
    }),
    /** Matches the React export name and the consumer's component-map.ts key. */
    name: z.string().min(1),
    /** Author-facing label surfaced in the CMS tree and Pages experience. */
    displayName: z.string().min(1),
    description: z.string().optional(),
    /** Defaults to "Office/32x32/document.png" if omitted. */
    icon: z.string().optional(),
    /**
     * Reference to a `ComponentSectionRecipe` whose section folders this
     * component lives under. The referenced recipe owns the templates
     * section folder, Component Folders bucket, Presentation Parameters
     * bucket, renderings-tree section folder, Headless Variants section,
     * and Available Renderings section item.
     *
     * Compile errors INPUT_INVALID if `section.handle` doesn't resolve to
     * a `ComponentSectionRecipe` in the same recipe set.
     *
     * Optional: omit for the flat layout (component + rendering land
     * directly at `<templatesRoot>` / `<renderingsRoot>` with no section
     * scaffolding). Registry-driven recipes inject this from
     * `meta.tax.subgroup` at registry build time.
     */
    section: z
      .object({
        handle: z.string().regex(HANDLE_PATTERN, {
          message: "section.handle must match `<kebab-name>@<major>`",
        }),
      })
      .optional(),
    fields: z.array(FieldDefinitionSchema).default([]),
    /**
     * Recipe handles whose templates are allowed as direct children of this
     * datasource item. Maps to the datasource standard-values item's
     * `Insert Options` field. Used for the **child-item pattern** — e.g.
     * an accordion whose accordion-items live as Sitecore children of its
     * own datasource rather than being referenced via a Treelist.
     *
     * Both reference patterns can coexist on the same recipe: declare a
     * Treelist field with `template:<handle>` source AND list the same
     * handle in `insertOptions`. Tenants pick which authoring flow they
     * prefer; the React component handles either resolution path.
     */
    insertOptions: z.array(z.string()).optional(),
    /**
     * Datasource configuration — the rendering's data shape, picker
     * locations, auto-create behaviour, and dialog UX. See
     * `RecipeDatasourceSchema` for the full surface. Optional: omit
     * for a rendering with no author-pickable datasource (e.g. a
     * static component).
     */
    datasource: RecipeDatasourceSchema.optional(),
    /**
     * Reference to a separate `DesignParametersTemplateRecipe`. When present,
     * the rendering's Parameters Template field points at this template
     * and the compiler does NOT synthesise an anonymous parameters
     * template from inline `params:`.
     *
     * When this is absent and `params:` is non-empty, the compiler
     * synthesises a section-local Parameters template at
     * `Components/<section>/Presentation Parameters/<Component> Parameters`.
     */
    parameters: z
      .object({
        handle: z.string().regex(HANDLE_PATTERN, {
          message: "parameters.handle must match `<kebab-name>@<major>`",
        }),
      })
      .optional(),
    /**
     * Children declaration — when present, the compiler emits a
     * Component Folder template at
     * `Components/<section>/Component Folders/<Component> Folder`. The
     * folder template's `__Standard Values` carries an Insert Options
     * field referencing the listed allowed handles, so author-side
     * "Insert" UX surfaces the right children under each instance.
     */
    children: z
      .object({
        allowedHandles: z.array(z.string().regex(HANDLE_PATTERN)).min(1),
      })
      .optional(),
    /**
     * `SectionDefinitionRecipe` handles whose `Available Renderings`
     * multi-list field should include this rendering's GUID. Drives the
     * Sitecore Pages "Toolbox" surface — adding to this list registers
     * the rendering with one or more Available Rendering Section
     * Definition items.
     */
    availableIn: z.array(z.string().regex(HANDLE_PATTERN)).optional(),
    variants: z.array(RenderingVariantDefinitionSchema).default([]),
    params: z.array(DesignParameterSchema).default([]),
    /**
     * SXA placeholder keys this rendering can be PLACED INTO — the
     * placement allow-list. Each key contributes this rendering to that
     * placeholder's `Allowed Controls` whitelist; without it the rendering
     * exists in CM but Pages won't offer it in the slot's picker.
     *
     * Resolution is split by whether the key is recipe-defined:
     *   - Keys that match a `PlaceholderRecipe` or an inline
     *     `placeholders` slot in the same set → folded into the
     *     `buildPlaceholderSettingsAggregate` IR write (one-push
     *     convergence on a fresh tenant).
     *   - Keys with no recipe declaration → resolved post-IR by
     *     `applyPlaceholderAllowControls`, which walks the tenant's
     *     existing Placeholder Settings items and patches the match.
     *
     * Example: `["headless-main", "sxa-footer"]`.
     *
     * Distinct from `placeholders` (below), which declares slots THIS
     * component EXPOSES for child renderings.
     */
    placedIn: z.array(z.string().min(1)).default([]),
    /**
     * Container slots — placeholders this component DEFINES for child
     * renderings to drop into. The hybrid placeholder model's
     * component-owned half: only meaningful for container components
     * (a Section / Grid / Tabs wrapper). Each entry compiles to a
     * Sitecore Placeholder Settings item via
     * `buildPlaceholderSettingsAggregate`.
     *
     * Distinct from `placedIn` (above), which lists placeholder keys
     * this rendering can be placed INTO.
     */
    placeholders: z.array(PlaceholderDefinitionSchema).default([]),
    /**
     * First-class option for SXA "renderings with dynamic placeholders".
     * When true, the compiler sets `IsRenderingsWithDynamicPlaceholders=true`
     * in the rendering's `OtherProperties` blob — equivalent to passing
     * `otherProperties: { IsRenderingsWithDynamicPlaceholders: "true" }`
     * but typed and discoverable. Default false.
     */
    dynamicPlaceholders: z.boolean().default(false),
    /**
     * Free-form key/value pairs encoded into the rendering's
     * `OtherProperties` URL-encoded shared field. Common keys are
     * surfaced as dedicated options elsewhere on the recipe
     * (`autoCreate` → `IsAutoDatasourceRendering`, `dynamicPlaceholders`
     * → `IsRenderingsWithDynamicPlaceholders`); use this for anything
     * else that needs to land in OtherProperties without a first-class
     * option.
     *
     * Explicitly-set keys here OVERRIDE the auto-set values from
     * `autoCreate` / `dynamicPlaceholders` — useful for the rare case
     * where you need to force a specific value.
     */
    otherProperties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Free-form key/value pairs encoded into the rendering's `OtherProperties` URL-encoded shared field. Reserved keys `IsAutoDatasourceRendering` and `IsRenderingsWithDynamicPlaceholders` should normally be set via the typed `datasource.autoCreate` and `dynamicPlaceholders` shortcuts — overriding here silently wins and is intended only for the rare escape-hatch case."
      ),
  })
  .refine((recipe) => !(recipe.parameters !== undefined && recipe.params.length > 0), {
    message:
      "Set either `parameters` (external template ref) or inline `params`, not both — the compiler ignores `params` when `parameters` is set, which silently drops author intent. Pick one form per recipe.",
    path: ["params"],
  });

export type ComponentTemplateRecipe = z.infer<typeof ComponentTemplateRecipeSchema>;

/**
 * A content-only template. Has fields but no rendering — exists as a data
 * shape referenced by other recipes via:
 *
 *   - A `reference` field with `sitecore.sourceTypes: ["<handle>"]`
 *     (related-items pattern: items live wherever, picker filters by template)
 *   - `insertOptions: ["<handle>"]` on a parent recipe (child-item pattern:
 *     items live as children of the parent's datasource)
 *
 * Not placeable on a page directly. The compiler emits the template,
 * sections, fields, and standard values — but no rendering item.
 *
 * Examples: accordion-item, tabs-item, faq-item — content shapes that
 * appear as part of a parent component, never standalone.
 */
/**
 * Optional taxonomy metadata, mirroring the registry's `meta.tax.*`
 * namespace. `group` is the only field the compiler currently consumes
 * — it drives `Content Models/<group>/<name>` nesting for content
 * templates. Other fields (`section`, `subgroup`, `tag`) are accepted
 * so registry → recipe pipelines can pass them through without
 * losing data, but they're not load-bearing for compilation.
 */
export const RecipeMetaTaxSchema = z
  .object({
    section: z.string().optional(),
    group: z.string().optional(),
    subgroup: z.string().optional(),
    tag: z.string().optional(),
  })
  .partial()
  .optional();

export const RecipeMetaSchema = z
  .object({
    tax: RecipeMetaTaxSchema,
  })
  .partial()
  .optional();

export type RecipeMeta = z.infer<typeof RecipeMetaSchema>;

export const ContentTemplateRecipeSchema = z.object({
  kind: z.literal("content-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. accordion-item@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * Optional taxonomy metadata. `meta.tax.group` drives Content Models
   * folder nesting: when set, the template lands at
   * `<contentModelsRoot>/<group>/<name>` instead of flat under
   * `<contentModelsRoot>/<name>`. Other taxonomy fields pass through
   * unmodified for downstream consumers.
   */
  meta: RecipeMetaSchema,
  fields: z.array(FieldDefinitionSchema).default([]),
  /**
   * Recipe handles allowed as children of this content template's items.
   * Enables nested child-item patterns (e.g. a section content template
   * that allows item content templates underneath).
   */
  insertOptions: z.array(z.string()).optional(),
  /**
   * Optional `WorkflowRecipe` handle to bind on the template's
   * `__Standard Values` item. When set, the compiler emits a
   * `SetField` writing `__Default workflow` to the workflow's refKey,
   * so new items conforming to this template enter the workflow at
   * its initial state automatically. Equivalent to declaring the same
   * handle in the workflow recipe's `bindings.templates[]` — pick
   * whichever side is more natural to author.
   */
  defaultWorkflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type ContentTemplateRecipe = z.infer<typeof ContentTemplateRecipeSchema>;

/**
 * A standalone Parameters Template — a Sitecore template item that holds
 * rendering-parameter fields, referenced from one or more
 * `ComponentTemplateRecipe.parameters`. Lands at
 * `<componentsRoot>/<section>/Presentation Parameters/<name>`.
 *
 * Authoring shape mirrors a stripped-down ContentTemplateRecipe — the
 * compiler emits a Template + Section + Field children + standard
 * values, parented under the section's "Presentation Parameters"
 * folder. Distinct from inline `params:` (which the compiler hoists
 * into an anonymous parameters template owned by one component);
 * standalone parameters templates are reusable across components.
 *
 * Identity: `designParametersTemplateId(handle)` derives the deterministic GUID.
 * Same identity scheme as the inline-hoisted variant — the seed is the
 * recipe handle, and the namespace is `NAMESPACE_TEMPLATE`. The seed
 * suffix is `::params`, identical between inline and standalone forms,
 * which keeps re-pushes idempotent if a recipe migrates from inline to
 * standalone (the GUID stays the same).
 */
export const DesignParametersTemplateRecipeSchema = z.object({
  kind: z.literal("design-parameters-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. cta-button-params@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /** Defaults to "Office/32x32/document.png" if omitted. */
  icon: z.string().optional(),
  /**
   * Reference to a `ComponentSectionRecipe` whose section folders this
   * parameters template lands under —
   * `Components/<section.name>/Presentation Parameters/<name>`. Required:
   * presentation parameters are organised per-section by convention.
   *
   * Compile errors INPUT_INVALID if `section.handle` doesn't resolve to
   * a `ComponentSectionRecipe` in the same recipe set. Matches the
   * shape used by `ComponentTemplateRecipe.section` — `{ handle }` ref,
   * not a bare section name string.
   */
  section: z.object({
    handle: z.string().regex(HANDLE_PATTERN, {
      message: "section.handle must match `<kebab-name>@<major>`",
    }),
  }),
  params: z.array(DesignParameterSchema).default([]),
});

export type DesignParametersTemplateRecipe = z.infer<typeof DesignParametersTemplateRecipeSchema>;

/**
 * Available Rendering Section Definition — declares an SXA section
 * definition item that the registry uses as the target for
 * `availableIn` bindings. Each section definition holds an `Available
 * Renderings` multi-list field whose pipe-separated GUID list controls
 * which renderings appear in the section's toolbox group.
 *
 * The section definition typically lives in the content tree under
 * `/sitecore/content/<tenant>/<site>/Presentation/Available Renderings/<Section>`,
 * but exact path is recipe-supplied via `sitePath` so the same recipe
 * shape works across SXA Headless and classic SXA layouts.
 *
 * Identity: section definitions are referenced by deterministic GUID
 * via `sectionDefinitionId(handle)`. The compiler currently does not
 * emit CreateItem ops for section definitions (they're assumed to
 * pre-exist on the tenant — they're SXA-shipped scaffolding). The
 * recipe surface accepts them so cross-recipe validation of
 * `availableIn` references can resolve.
 */
export const SectionDefinitionRecipeSchema = z.object({
  kind: z.literal("section-definition"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. showcase-section@1",
  }),
  name: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  /**
   * Sitecore content-tree path of the section definition item
   * (e.g. `/sitecore/content/<tenant>/<site>/Presentation/Available
   * Renderings/<Section>`). The compiler uses this as the lookup target
   * when emitting `AppendToMultiList` ops for the section's
   * `Available Renderings` field — the executor resolves the path to
   * a Sitecore itemId at apply time.
   */
  sitePath: z.string().min(1),
});

export type SectionDefinitionRecipe = z.infer<typeof SectionDefinitionRecipeSchema>;

/**
 * A single field value on a `ContentItemRecipe`. Tagged on `shape` so the
 * Phase 4 compiler can dispatch each value to the right Sitecore wire
 * encoder (image XML, link XML, pipe-separated GUID list, …) without
 * cross-recipe shape lookup at parse time.
 *
 * Shapes mirror `FieldShape` from `field-types.ts`, with `link` split
 * into `link-external` / `link-internal` and `reference` lifted to
 * always-array (`refs: string[]`) — both differences reflect that the
 * value-level form encodes the stored representation, not the abstract
 * field shape on the template.
 *
 * Cross-recipe handle references (`link-internal.ref`, `reference.refs`)
 * resolve via the same `templateId(handle)` / `contentItemId(handle)`
 * derivation the rest of the recipe surface uses.
 */
export const ContentFieldValueSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("text"), value: z.string() }),
  z.object({ shape: z.literal("richText"), value: z.string() }),
  z.object({ shape: z.literal("boolean"), value: z.boolean() }),
  z.object({ shape: z.literal("number"), value: z.number() }),
  z.object({ shape: z.literal("integer"), value: z.number().int() }),
  /** ISO 8601 date (`YYYY-MM-DD`) — compiler converts to Sitecore's wire format. */
  z.object({ shape: z.literal("date"), value: z.string() }),
  /** ISO 8601 datetime (`YYYY-MM-DDTHH:mm:ssZ`). */
  z.object({ shape: z.literal("datetime"), value: z.string() }),
  /** One of the enum's declared values, by name. */
  z.object({ shape: z.literal("enum"), value: z.string() }),
  z.object({
    shape: z.literal("image"),
    /** Sitecore media-library path. Compiler emits the image XML form. */
    mediaPath: z.string().min(1),
    alt: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.object({
    shape: z.literal("link-external"),
    href: z.string().min(1),
    text: z.string().optional(),
    target: z.string().optional(),
    title: z.string().optional(),
  }),
  z.object({
    shape: z.literal("link-internal"),
    /** Recipe handle (page or content item). Compiler resolves to a GUID. */
    ref: z.string().min(1),
    text: z.string().optional(),
    target: z.string().optional(),
  }),
  z.object({
    shape: z.literal("reference"),
    /**
     * One or more recipe handles. Always an array, even for single-ref
     * fields — the value-level shape doesn't depend on whether the
     * template field is `multiple: true`. Compiler emits one GUID
     * (single-ref fields) or pipe-separated GUIDs (Treelist/Multilist).
     */
    refs: z.array(z.string().min(1)),
  }),
]);

export type ContentFieldValue = z.infer<typeof ContentFieldValueSchema>;

/** Per-language field values — a simple-mode translation of a content item. */
export const ContentTranslationSchema = z.object({
  /** Field values for this language, keyed by field name. */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
});

export type ContentTranslation = z.infer<typeof ContentTranslationSchema>;

/**
 * A personalization variant within a numbered version — an
 * audience-conditional alternative. Carries a partial field delta (and an
 * optional layout) against the version's default.
 *
 * The exact XM Cloud personalization wire model is unverified; the compiler
 * mapping for `variants` is deferred — see docs/recipe-sync-architecture.md,
 * "Personalization variants".
 */
export const ContentVariantSchema = z.object({
  /** Audience / variant identifier the personalization rule targets. */
  audience: z.string().min(1),
  /** Field-value delta against the version's default. */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
  /** Optional per-variant layout override. */
  layout: z.lazy(() => LayoutSchema).optional(),
});

export type ContentVariant = z.infer<typeof ContentVariantSchema>;

/**
 * One numbered version of a content item in a single language — the unit a
 * story-seed recipe authors. See docs/recipe-sync-architecture.md,
 * "Content versioning — seeding a story".
 */
export const ContentVersionSchema = z.object({
  /** Sitecore numbered version (1-based). */
  version: z.number().int().positive(),
  /** Field values for this version, keyed by field name. */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
  /**
   * Workflow STATE this version sits in (e.g. "Draft", "Approved") — the
   * item's `__Workflow state`. Distinct from the item-level `workflow`,
   * which names the workflow *definition* the item is attached to.
   */
  workflowState: z.string().min(1).optional(),
  /** ISO 8601 timestamp narrating when this version lands in the story. */
  date: z.string().optional(),
  /**
   * Per-version layout. Writes to the item's `__Final Renderings`
   * (per-version) field — not the shared `__Renderings`.
   */
  layout: z.lazy(() => LayoutSchema).optional(),
  /** Personalization variants for this version. */
  variants: z.array(ContentVariantSchema).optional(),
});

export type ContentVersion = z.infer<typeof ContentVersionSchema>;

/**
 * A concrete content item — one Sitecore item conforming to a content
 * template, populated with the recipe's field values. The Phase 4
 * companion to `ContentTemplateRecipe`: templates declare shape, content
 * items declare instance.
 *
 * Used as the `kind: "shared"` datasource target for `PartialDesignRecipe`
 * and `PageDesignRecipe` placements (e.g. `site-logo-content@1`,
 * `primary-nav-content@1`). The handle is load-bearing — `contentItemId`
 * derives the deterministic Sitecore GUID from it.
 *
 * Field-shape ↔ template-shape validation is deferred to the Phase 4
 * compiler (it requires cross-recipe lookup; Zod can't enforce it alone).
 */
export const ContentItemRecipeSchema = z.object({
  kind: z.literal("content-item"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. site-logo-content@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * Handle of the content (or component) template this item conforms to.
   * Compiler resolves via `templateId(handle)` to set the item's
   * Template-Of GUID.
   */
  templateType: z.string().regex(HANDLE_PATTERN, {
    message: "templateType must match `<kebab-name>@<major>`, e.g. nav-link@1",
  }),
  /**
   * Field values keyed by field name — the primary language, single
   * version. The simple-mode common case; mutually exclusive with
   * `versions` (story mode). The compiler enforces the exclusivity.
   */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
  /**
   * Simple mode — additional languages, one version each, keyed by ISO
   * language code (`fr`, `de`, …). Additive and backward-compatible: omit
   * for a single-language item. Mutually exclusive with `versions`.
   */
  translations: z.record(z.string(), ContentTranslationSchema).optional(),
  /**
   * Story mode — explicit numbered versions for seeding a narrative, keyed
   * by ISO language code, each an ordered list of `ContentVersion`s.
   * Mutually exclusive with `fields` / `translations` — a recipe is simple
   * OR a story. See docs/recipe-sync-architecture.md, "Content versioning".
   */
  versions: z.record(z.string(), z.array(ContentVersionSchema)).optional(),
  /**
   * Item-level `storage: shared` field values — one value for the whole
   * item, no language or version. In story mode these have no version to
   * live under, so they sit here.
   */
  shared: z.record(z.string(), ContentFieldValueSchema).optional(),
  /**
   * Optional `WorkflowRecipe` handle to attach this item to. When set,
   * the compiler emits a `SetField` writing the item's `__Workflow`
   * field to the workflow's refKey. Use this to override the template's
   * `__Default workflow` for a single item, or to put items under a
   * workflow without a template-level default. The item's
   * `__Workflow state` is not written here — Sitecore initialises new
   * items at the workflow's initial state from the workflow definition.
   */
  workflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type ContentItemRecipe = z.infer<typeof ContentItemRecipeSchema>;

/**
 * One rendering placed into a placeholder, with its variant, parameters,
 * and datasource binding. The Phase 4 compiler emits each ComponentPlacement
 * as one `<r>` element in Sitecore's layout XML.
 *
 * The single shape used by anything that holds layout —
 * `PartialDesignRecipe`, `PageDesignRecipe`, and `PageRecipe`. The
 * `componentHandle` resolves to a `ComponentTemplateRecipe`'s rendering
 * GUID via `renderingId(handle)`.
 *
 * `datasourceRef` distinguishes how the rendering gets its content:
 *
 *   shared  — points at a `ContentItemRecipe` by handle (catalog-shipped
 *             reusable content like `site-logo-content@1`).
 *   scoped  — page-local content materialised at `<page>/Data/<slot>`.
 *             Only valid in a `PageRecipe` layout (a page has a content
 *             home to scope under); `PartialDesignRecipe` and
 *             `PageDesignRecipe` reject it — they have no host page.
 *   none    — config-driven rendering with no datasource (rare).
 */
export const ComponentPlacementSchema = z.object({
  /** Handle of a `ComponentTemplateRecipe`. */
  componentHandle: z.string().regex(HANDLE_PATTERN, {
    message: "componentHandle must match `<kebab-name>@<major>`",
  }),
  /** SXA Rendering Variant name. Defaults to the component's first variant. */
  variant: z.string().optional(),
  /** Rendering Parameters (URL-encoded into the placement's params blob). */
  params: z.record(z.string(), z.string()).optional(),
  /** How the rendering's content is bound. Omit for `kind: "none"` semantics. */
  datasourceRef: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("shared"),
        /** Handle of a `ContentItemRecipe`. */
        handle: z.string().regex(HANDLE_PATTERN),
      }),
      z.object({
        kind: z.literal("scoped"),
        /**
         * Page-local datasource name. `compilePageRecipe` materialises
         * a datasource item at `<page>/Data/<slot>` (conforming to the
         * placed component's datasource template) and points the
         * placement's `ds` at it. Must be a valid Sitecore item name.
         * Only valid in a `PageRecipe` layout.
         */
        slot: z.string().min(1),
      }),
      z.object({ kind: z.literal("none") }),
    ])
    .optional(),
});

export type ComponentPlacement = z.infer<typeof ComponentPlacementSchema>;

/**
 * Layout block keyed by placeholder. Each placeholder holds an ordered
 * array of `ComponentPlacement`s — render order is array order.
 */
export const LayoutSchema = z.object({
  placeholders: z.record(z.string(), z.array(ComponentPlacementSchema)).default({}),
});

export type Layout = z.infer<typeof LayoutSchema>;

/**
 * A page template — a Sitecore data template that items in a site's
 * content tree conform to in order to BE authorable pages. The
 * page-level peer of `ComponentTemplateRecipe`: where a component
 * template backs a placeable rendering, a page template backs a
 * navigable page.
 *
 * Unlike `ContentTemplateRecipe` (a plain data shape), a page template
 * inherits the SXA Headless page base set (`SXA_HEADLESS_PAGE_BASE_TEMPLATES`
 * — Base Page + _Navigable + _Taggable + _Designable + _Sitemap) so
 * items conforming to it pick up the layout/presentation fields, the
 * navigation facet, taxonomy tagging, the page-design binding, and
 * sitemap metadata. The compiler also stamps the template's
 * `__Standard Values` `__Renderings` with a JSON-layout shell
 * (`<r><d id="{device}" l="{jsonLayout}" /></r>`), optionally seeded
 * with `layout` placements.
 *
 * Page templates are the resolution target for `PageDesignRecipe.appliesTo`,
 * `SiteTemplateRecipe.pageTemplates`, `insertOptionsMatrix`, and
 * `templatesToDesigns` keys. The default template→design binding is the
 * `TemplatesMapping` aggregate on the Page Designs root (driven by
 * `PageDesignRecipe.appliesTo`); the per-page `Page Design` override
 * field is left unset.
 *
 * Identity: `templateId(site, handle)` — a page template IS a Sitecore
 * template, same GUID family as component/content templates.
 */
export const PageTemplateRecipeSchema = z.object({
  kind: z.literal("page-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. article-page@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /** Defaults to the SXA page icon if omitted. */
  icon: z.string().optional(),
  /**
   * Optional taxonomy metadata. `meta.tax.group` nests the template one
   * folder level deep: when set, the template lands at
   * `<pageTemplatesRoot>/<group>/<name>` (the group folder is emitted
   * once per recipe set as a `CreateOnly` op) instead of flat under
   * `<pageTemplatesRoot>/<name>`. Other taxonomy fields pass through
   * unmodified for downstream consumers.
   */
  meta: RecipeMetaSchema,
  /**
   * Page-specific fields beyond the inherited SXA base — SEO copy,
   * hero overrides, structured metadata. Grouped into sections the
   * same way component/content template fields are.
   */
  fields: z.array(FieldDefinitionSchema).default([]),
  /**
   * Page-template handles allowed as child pages under items of this
   * template — the Sitecore Insert Options surface for content authors.
   * Resolve to other `PageTemplateRecipe` handles.
   */
  insertOptions: z.array(z.string().regex(HANDLE_PATTERN)).optional(),
  /**
   * Optional default presentation baked into the template's
   * `__Standard Values` layout. Most page templates leave this empty —
   * page chrome comes from the page design's partials, and page-local
   * content lands on the page item's own `__Final Renderings`. Set it
   * only for renderings every page of this template should carry
   * regardless of design.
   */
  layout: LayoutSchema.optional(),
  /**
   * Optional `WorkflowRecipe` handle bound on the template's
   * `__Standard Values` `__Default workflow` — new pages of this
   * template enter the workflow automatically. Mirrors
   * `ContentTemplateRecipe.defaultWorkflow`.
   */
  defaultWorkflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type PageTemplateRecipe = z.infer<typeof PageTemplateRecipeSchema>;

/**
 * A page — a concrete, navigable item in the site content tree. The
 * page-level peer of `ContentItemRecipe`: where a content item is a
 * shared datasource shape, a `PageRecipe` is an authorable page.
 *
 * It conforms to a `PageTemplateRecipe` (inheriting the SXA page
 * presentation facets), carries field values for the page's own
 * fields, and may declare a `layout` — written to the page item's
 * `__Final Renderings` (the per-version final layout), distinct from a
 * page design's `__Renderings`.
 *
 * Layout placements bind via `datasourceRef`: `shared` (a
 * `ContentItemRecipe`), `scoped` (a page-local datasource item the
 * compiler materialises at `<page>/Data/<slot>`), or `none`. Pages
 * currently land flat under `pagesRoot` — page-tree nesting (a `parent`
 * page handle) is the one deferred follow-up.
 *
 * Identity: `pageItemId(site, handle)`. `SiteRecipe.initialHome`
 * resolves to a `PageRecipe` handle.
 */
export const PageRecipeSchema = z.object({
  kind: z.literal("page"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. home@1",
  }),
  /** Sitecore item name under the pages root. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /**
   * Handle of the `PageTemplateRecipe` this page conforms to. Compiler
   * resolves via `templateId(handle)` to set the item's Template-Of.
   */
  template: z.string().regex(HANDLE_PATTERN, {
    message: "template must reference a PageTemplateRecipe by handle, e.g. article-page@1",
  }),
  /**
   * Field values keyed by field name on the page template. Same
   * encoding surface as `ContentItemRecipe.fields` (`link-internal`
   * is deferred — use `reference` or `link-external`).
   */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
  /**
   * Optional page-local presentation, written to the page item's
   * `__Final Renderings`. Placements use `datasourceRef` `shared`
   * (a `ContentItemRecipe`), `scoped` (a page-local datasource at
   * `<page>/Data/<slot>`, materialised by the compiler), or `none`.
   */
  layout: LayoutSchema.optional(),
  /**
   * Optional `WorkflowRecipe` handle — sets the page item's
   * `__Workflow` field. Mirrors `ContentItemRecipe.workflow`.
   */
  workflow: z.string().regex(HANDLE_PATTERN).optional(),
});

export type PageRecipe = z.infer<typeof PageRecipeSchema>;

/**
 * A reusable layout chunk — header, footer, sidebar, byline. Lives at
 * `/sitecore/.../Presentation/Partial Designs/<name>` on a tenant. Linked
 * by 1..n `PageDesignRecipe`s. Owns its own placeholders and pre-placed
 * renderings; the compiler emits the same layout XML form pages use.
 *
 * Identity: `partialDesignId(handle)` derives the deterministic GUID from
 * the recipe handle.
 */
export const PartialDesignRecipeSchema = z.object({
  kind: z.literal("partial-design"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. standard-header@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  /** Defaults to the partial-design icon if omitted. */
  icon: z.string().optional(),
  /** Placeholders this partial holds, with their pre-placed renderings. */
  layout: LayoutSchema,
});

export type PartialDesignRecipe = z.infer<typeof PartialDesignRecipeSchema>;

/**
 * Maps page templates to a layout. Lives at
 * `/sitecore/.../Presentation/Page Designs/<name>` on a tenant. Establishes
 * the templates-to-design mapping (the Sitecore SXA Page Designs root
 * field), lists which partial designs wrap content, and optionally adds
 * its own pre-placed renderings.
 *
 * Identity: `pageDesignId(handle)` derives the deterministic GUID from
 * the recipe handle.
 */
export const PageDesignRecipeSchema = z.object({
  kind: z.literal("page-design"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. landing-design@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  /**
   * Page template handles this design applies to. Compiler builds the
   * URL-string templates-to-designs mapping field on the Sitecore Page
   * Designs root from this list, resolved via `templateId(handle)`.
   */
  appliesTo: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  /**
   * Partials linked into this design, in render order. Compiler emits the
   * pipe-separated GUID list on the design's `PartialDesigns` field,
   * resolved via `partialDesignId(handle)`.
   */
  partials: z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  /**
   * Optional own layout — for designs that add page-design-level
   * placements beyond just wrapping partials. Most designs leave this
   * empty because the page itself owns its content placements.
   */
  layout: LayoutSchema.optional(),
});

export type PageDesignRecipe = z.infer<typeof PageDesignRecipeSchema>;

/**
 * Default dictionary entry on a `SiteTemplateRecipe`. Every entry the
 * template declares becomes a Sitecore dictionary phrase with the
 * supplied default value. Sites instancing the template can override
 * the value per-phrase via `SiteRecipe.dictionaryOverrides`; phrases
 * not overridden read the template default.
 */
export const SiteTemplateDictionaryEntrySchema = z.object({
  /** Phrase key — the dictionary item's name. Stable across overrides. */
  phrase: z.string().min(1),
  /** Default value (the translated string for the template's primary language). */
  defaultValue: z.string(),
});

export type SiteTemplateDictionaryEntry = z.infer<typeof SiteTemplateDictionaryEntrySchema>;

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
   * Default dictionary phrases. Sites can override values per-phrase;
   * unoverridden phrases use the template default.
   */
  dictionary: z.array(SiteTemplateDictionaryEntrySchema).optional(),
  /**
   * Default taxonomy structure. Sites can override tag lists per-root.
   */
  taxonomy: z.array(SiteTemplateTaxonomyEntrySchema).optional(),
});

export type SiteTemplateRecipe = z.infer<typeof SiteTemplateRecipeSchema>;

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
   * Per-phrase override for dictionary values declared on the
   * `SiteTemplateRecipe.dictionary`. Keys are phrase names; values
   * replace the template default. Phrases not in this map use the
   * template default.
   */
  dictionaryOverrides: z.record(z.string().min(1), z.string()).optional(),
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

export type SiteRecipe = z.infer<typeof SiteRecipeSchema>;

/**
 * Discriminated union of recipe kinds. Compilers and validators can accept
 * `Recipe` and dispatch on `kind`.
 */
/**
 * One value in an `EnumerationRecipe`. Compiles to a Sitecore item that
 * conforms to the per-site `Enumeration Value` template (NOT the
 * `Enumeration` template — that one is for the per-enum container).
 * `Enumeration Value` carries an `Enumeration` Template Section with a
 * single `Value` Single-Line Text shared field — see
 * `EnumerationRecipeSchema` for the full template structure.
 *
 *   `name`         — Sitecore item name and uuidv5 GUID seed for the
 *                    value item. Load-bearing: renaming `name` creates
 *                    a *different* value item and orphans every
 *                    existing reference. Also written to the `Value`
 *                    shared field on the value item, which is what
 *                    SXA-aware consumers (XM Cloud Pages, JSS variants,
 *                    custom Edge resolvers) read via the canonical
 *                    "picked item's Value field" pattern.
 *   `displayName`  — `__Display name` on the item, defaults to `name`.
 *                    What the editor's Droplink dropdown shows. Use
 *                    this to change the visible label without touching
 *                    `name`.
 */
export const EnumerationValueSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1).optional(),
});

export type EnumerationValue = z.infer<typeof EnumerationValueSchema>;

/**
 * A reusable enumeration — backs Droplink fields whose options are
 * shared across multiple components (color schemes, size scales,
 * spacing scales, etc.). Each value lands as a child item under
 * `<enumerationsRoot>/[<subfolder>/]<EnumName>/<ValueName>`.
 *
 * Reference from any field via `sitecore.enumHandle: "<handle>"`. On
 * re-push, adding a value to the enumeration surfaces it on every
 * referencing field automatically (the Droplink Source resolves by
 * location at editor time, so consumer field-definitions don't need
 * to change).
 *
 * Underlying template structure (emitted once per site by
 * `ensureEnumerationTemplates` — three distinct templates, each with
 * its own role; never collapsed):
 *
 *   Enumerations Folder            (Template — folder layers in the
 *                                   enum content tree: site enumerations
 *                                   root + per-folder grouping items)
 *     └── __Standard Values        Insert Options:
 *                                    Enumeration, Enumerations Folder
 *
 *   Enumeration                    (Template — per-enum CONTAINER items
 *                                   like `Color Scheme`, `Heading Size`)
 *     └── __Standard Values        Insert Options: Enumeration Value
 *
 *   Enumeration Value              (Template — leaf VALUE items like
 *                                   `primary`, `accent`, `lg`)
 *     └── Enumeration              (Template Section)
 *           └── Value               (Single-Line Text, shared)
 *
 * Each value item conforms to `Enumeration Value` and stores its `name`
 * on the `Value` shared field. That payload is what Droplink consumers
 * read via the SXA "picked item's Value field" pattern — without it,
 * components wired against the enum stay empty.
 *
 * The matching consumer-side surface is `Type=Droplink` (the default
 * for `shape: "enum"`). Inline Droplink (`shape: "enum"` with `values`
 * but no `enumHandle`) is unsupported — authors must either point at
 * an EnumerationRecipe via `enumHandle` or override `sitecore.type` to
 * `"droplist"` for an inline pipe-list dropdown.
 */
export const EnumerationRecipeSchema = z.object({
  kind: z.literal("enumeration"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN),
  /** Item name under `<enumerationsRoot>` (e.g. `ColorScheme`). */
  name: z.string().min(1),
  /** Author-facing label (defaults to `name` when omitted). */
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  /**
   * Optional placement of the enum's items in the content tree. Mirrors
   * the `scope` + `folder` shape used by component
   * `rendering.datasource.locations`, but kept SINGULAR (`location`,
   * not `locations`) — an enum's value items live in exactly one place
   * by construction, so multi-location dual identity isn't a thing.
   *
   *   scope: "site"           → under the site's enumerations root.
   *   scope: "siteCollection" → reserved for shared-vocabulary use
   *                             (not yet implemented; throws
   *                             INPUT_INVALID at compile time).
   *   folder                  → optional grouping segment(s) under the
   *                             scope root. Materialised as `CreateOnly`
   *                             items conforming to the per-site
   *                             `Enumerations Folder` template. Multiple
   *                             recipes naming the same folder share it,
   *                             not collide. Multi-segment paths like
   *                             `"Theme/Color"` work too — splits on
   *                             `/`, intermediate segments emit one
   *                             grouping item each.
   *
   * Omit `location` entirely → enum lands flat at the site enumerations
   * root, no grouping folder.
   */
  location: z
    .object({
      scope: z.enum(["site", "siteCollection"]),
      folder: FolderPath.optional(),
    })
    .optional(),
  values: z.array(EnumerationValueSchema).min(1),
  /**
   * Default value for this enumeration. Compiled into the per-enum
   * container item's `Value` shared field so Edge consumers querying
   * the container directly receive a default when the picker hasn't
   * been bound yet (the canonical Sitecore "carry the default on the
   * enumeration item itself" pattern).
   *
   * Must match one of `values[].name`. Validated by
   * `compileEnumerationRecipe` at compile time (cross-field validation
   * can't go on the schema itself — `discriminatedUnion` doesn't accept
   * `ZodEffects` members). Optional — omit to leave the default empty
   * (consumers fall back to component-level defaults).
   */
  default: z.string().min(1).optional(),
});

export type EnumerationRecipe = z.infer<typeof EnumerationRecipeSchema>;

// ─────────────────────────────────────────────────────────────────────
// Workflow + webhook recipes
//
// Full reference (behavior, payload, endpoint contract, auth types,
// failure modes, troubleshooting): docs/recipes/workflow.md
// ─────────────────────────────────────────────────────────────────────

/**
 * Stable, kebab-case key for a workflow state or command. Used as part
 * of the deterministic GUID seed — renaming a key creates a different
 * item (and orphans transitions that pointed at the old key). Format
 * is restricted to lowercase letters, digits, and hyphens so the
 * generated content-tree paths stay URL-safe across all Sitecore
 * tenants without re-quoting.
 */
const WorkflowKeyPattern = /^[a-z][a-z0-9-]*$/;
const WorkflowKey = z.string().regex(WorkflowKeyPattern, {
  message: "key must match `^[a-z][a-z0-9-]*$` (lowercase, kebab)",
});

/** `$ENV:VAR_NAME` reference — secrets never inline in the recipe file. */
const SecretRef = z.string().regex(/^\$ENV:[A-Z_][A-Z0-9_]*$/, {
  message: "use $ENV:NAME for secret values; never inline plaintext credentials",
});

/**
 * Webhook authorization recipe — declares a reusable `Webhook
 * Authorization` item under `/sitecore/system/Settings/Webhooks/Authorizations`.
 * Workflow webhook actions and event handlers reference one of these
 * via `authorizationRef: <handle>`.
 *
 * The authorization templates live under
 * `/sitecore/templates/System/Webhooks/Authorizations/...`. The
 * compiler emits `templateOf: { kind: "ref-path", value: ... }` so the
 * push pipeline resolves the template GUID at apply time — these
 * GUIDs aren't published as a public contract.
 *
 * Secrets are always by `$ENV:VAR_NAME` reference; the apply step
 * resolves the env var at push time. Missing env vars surface as a
 * plan-phase error before any item write.
 */
const WebhookAuthorizationApiKeySchema = z.object({
  type: z.literal("ApiKey"),
  /** Header name to attach (e.g. `X-Api-Key`, `Authorization`). */
  headerName: z.string().min(1),
  /** `$ENV:VAR_NAME` reference to the key/token. */
  key: SecretRef,
});

const WebhookAuthorizationBasicSchema = z.object({
  type: z.literal("Basic"),
  username: z.string().min(1),
  password: SecretRef,
});

const WebhookAuthorizationOAuth2Schema = z.object({
  type: z.literal("OAuth2ClientCredentialsGrant"),
  tokenEndpoint: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: SecretRef,
  scope: z.string().optional(),
  audience: z.string().optional(),
});

export const WebhookAuthorizationRecipeSchema = z.object({
  kind: z.literal("webhook-authorization"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. ci-bearer@1",
  }),
  /** Sitecore item name. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  auth: z.discriminatedUnion("type", [
    WebhookAuthorizationApiKeySchema,
    WebhookAuthorizationBasicSchema,
    WebhookAuthorizationOAuth2Schema,
  ]),
});

export type WebhookAuthorizationRecipe = z.infer<typeof WebhookAuthorizationRecipeSchema>;

/**
 * Either an intra-recipe reference to a `webhook-authorization` recipe
 * (`authorizationRef: <handle>`) or an absolute content-tree path
 * (`authorizationPath: /sitecore/system/Settings/Webhooks/Authorizations/...`)
 * to an existing tenant-side Authorization item. Exactly one of the two
 * (enforced via superRefine on the workflow recipe).
 */
const WebhookActionAuthRefSchema = z.object({
  authorizationRef: z.string().regex(HANDLE_PATTERN).optional(),
  authorizationPath: z.string().startsWith("/sitecore/").optional(),
});

const WebhookActionBaseSchema = WebhookActionAuthRefSchema.extend({
  /**
   * Sitecore item name for the action item. Derived from the action's
   * key within its state/command (e.g. `notify-reviewer`) — must be
   * unique among siblings under that state or command.
   */
  key: WorkflowKey,
  url: z.string().url(),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  serializationType: z.enum(["JSON", "XML"]).default("JSON"),
  enabled: z.boolean().default(true),
});

const WebhookSubmitActionSchema = WebhookActionBaseSchema.extend({
  kind: z.literal("webhook-submit"),
});

const WebhookValidationActionSchema = WebhookActionBaseSchema.extend({
  kind: z.literal("webhook-validation"),
});

const WorkflowActionSchema = z.discriminatedUnion("kind", [
  WebhookSubmitActionSchema,
  WebhookValidationActionSchema,
]);

const AppearanceEvaluatorSchema = z.enum(["default", "lock", "unlock"]);

const WorkflowCommandSchema = z.object({
  key: WorkflowKey,
  name: z.string().min(1),
  displayName: z.string().min(1),
  nextState: WorkflowKey,
  /** Maps to the standard `__Auto Publish` field on a workflow Command. */
  autoPublish: z.boolean().default(false),
  /** Maps to the standard `Suppress comment` field — silences the comment prompt. */
  suppressComment: z.boolean().default(false),
  /** Maps to `Appearance Evaluator Type`. */
  appearanceEvaluator: AppearanceEvaluatorSchema.default("default"),
  /**
   * When true, the compiler emits a `SetField` to restrict the command
   * to administrators (sets the standard `__Security` field with a
   * deny-everyone ACL plus an allow-admin ACL). Suitable for sensitive
   * commands like "Publish to Production" that shouldn't be available
   * to all reviewers.
   */
  secured: z.boolean().default(false),
  /** Validation actions attached to this command (synchronous gates). */
  validations: z.array(WebhookValidationActionSchema).default([]),
});

const WorkflowStateSchema = z.object({
  key: WorkflowKey,
  name: z.string().min(1),
  displayName: z.string().min(1),
  /** Maps to the standard `Final` checkbox on the State item. */
  final: z.boolean().default(false),
  /** Maps to `Preview` — items in this state appear in the preview database. */
  preview: z.boolean().default(false),
  /** Submit or validation actions that fire on entry into this state. */
  actions: z.array(WorkflowActionSchema).default([]),
  commands: z.array(WorkflowCommandSchema).default([]),
});

const WorkflowBindingsSchema = z
  .object({
    /**
     * Templates to bind this workflow to. Each entry is either an
     * intra-recipe content-template handle (resolves via refKey) or an
     * absolute path to a tenant-existing template (resolves via
     * `crossRecipeRefs`). The compiler emits a `SetField` op against
     * each template's `__Standard Values` item setting the
     * `__Default workflow` field.
     */
    templates: z
      .array(
        z.union([z.string().regex(HANDLE_PATTERN), z.string().startsWith("/sitecore/templates/")])
      )
      .default([]),
  })
  .default({ templates: [] });

/**
 * Cross-field validations (`initialState` must match a declared state,
 * `nextState` refs must resolve, at least one final state, action auth
 * is `Ref` XOR `Path`) live in `compileWorkflowRecipe` — not on the
 * schema — because Zod's `discriminatedUnion` rejects `ZodEffects`
 * members and we need this schema in `RecipeSchema`. Same pattern
 * `EnumerationRecipeSchema` uses for its `default ∈ values` check.
 */
export const WorkflowRecipeSchema = z.object({
  kind: z.literal("workflow"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. blog-article-approval@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  /**
   * Optional taxonomy metadata. `meta.tax.group` is the only field
   * the compiler currently consumes — it drives a one-level Workflow
   * Folder under `/sitecore/system/Workflows/<group>/<name>`. Other
   * fields are accepted for registry → recipe pipeline compatibility
   * but aren't load-bearing.
   */
  meta: RecipeMetaSchema,
  /** State key of the workflow's initial state (must match one of `states`). */
  initialState: WorkflowKey,
  states: z.array(WorkflowStateSchema).min(1),
  bindings: WorkflowBindingsSchema,
});

export type WorkflowRecipe = z.infer<typeof WorkflowRecipeSchema>;

export const RecipeSchema = z.discriminatedUnion("kind", [
  ComponentSectionRecipeSchema,
  ComponentTemplateRecipeSchema,
  ContentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  PageTemplateRecipeSchema,
  PageRecipeSchema,
  PlaceholderRecipeSchema,
  DesignParametersTemplateRecipeSchema,
  SectionDefinitionRecipeSchema,
  PartialDesignRecipeSchema,
  PageDesignRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteRecipeSchema,
  EnumerationRecipeSchema,
  WorkflowRecipeSchema,
  WebhookAuthorizationRecipeSchema,
]);

export type Recipe = z.infer<typeof RecipeSchema>;

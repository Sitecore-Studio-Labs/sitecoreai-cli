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
export const FolderPath = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
  .transform((value) => {
    const segments = (Array.isArray(value) ? value : value.split("/")).map((s) => s.trim());
    return segments.filter((s) => s.length > 0);
  })
  .pipe(z.array(z.string().min(1)).min(1));

/**
 * The `handle` is load-bearing forever — a uuidv5 derives every item GUID
 * from it (see `guids.ts`), so renaming a handle creates a *different*
 * template.
 */
export const HANDLE_PATTERN = /^[a-z][a-z0-9-]*@[0-9]+$/;

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
 * Variants-lite shape: bare Variant item per `name`, no internal
 * structure. Could grow per-variant template-card bindings for full
 * SXA NVELOPe authoring as a follow-up.
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
export const VARIANT_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
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

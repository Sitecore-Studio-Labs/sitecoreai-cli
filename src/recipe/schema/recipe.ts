import { z } from "zod";
import { FieldShapeSchema, SitecoreFieldTypeSchema } from "./field-types";

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
 * Sitecore-side override on a field or param. Defaults apply when omitted.
 *
 * The picker-scope concept (Sitecore's `Source` field) is expressed as
 * three composable structured fields rather than a stringly-typed
 * mini-language. They combine: e.g. `sourceScope` + `sourceTypes` becomes
 * `DataSource=<path>&IncludeTemplatesForSelection={GUID},...` on emit.
 *
 *   sourceTypes   — "picker filter": only items of these recipe handles.
 *   sourceQuery   — "where to look": a Sitecore Query (e.g. `$site/...`).
 *   sourceScope   — "where to look": a fixed content-tree path.
 *   sourceRaw     — escape hatch; verbatim Source string (mutually exclusive
 *                   with the structured fields).
 */
export const SitecoreFieldAugmentSchema = z
  .object({
    /** Override the default shape→Sitecore type mapping. */
    type: SitecoreFieldTypeSchema.optional(),
    /**
     * Picker filter: restrict to items conforming to one of these recipe
     * handles. Compiler resolves each handle to its deterministic template
     * GUID and emits `IncludeTemplatesForSelection={GUID},{GUID}`.
     */
    sourceTypes: z.array(z.string()).optional(),
    /**
     * Where to look: a Sitecore Query (e.g. `$site/*[@@name='Data']`).
     * Standalone, becomes the entire Source as `query:<query>` (the
     * shorthand Sitecore evaluates directly for Droplist-style fields).
     * Combined with `sourceTypes`, becomes `DataSource=query:<query>&...`.
     */
    sourceQuery: z.string().optional(),
    /**
     * Where to look: a fixed Sitecore content-tree path. Emitted as
     * `DataSource=<path>`, alone or combined with `sourceTypes`.
     */
    sourceScope: z.string().optional(),
    /**
     * Escape hatch: verbatim Source string. Mutually exclusive with the
     * structured fields above. Use when you need a Source form that
     * doesn't fit the structured surface (e.g. a bare path Treelist
     * source like `/sitecore/content/Tags`).
     */
    sourceRaw: z.string().optional(),
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
  })
  .refine(
    (v) =>
      v.sourceRaw === undefined ||
      (v.sourceTypes === undefined && v.sourceQuery === undefined && v.sourceScope === undefined),
    {
      message: "sourceRaw is mutually exclusive with sourceTypes/sourceQuery/sourceScope",
      path: ["sourceRaw"],
    }
  );

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

export const ParamDefinitionSchema = z.object({
  name: z.string().min(1),
  shape: FieldShapeSchema,
  values: z.array(z.string()).optional(),
  default: z.string().optional(),
  sitecore: SitecoreFieldAugmentSchema.optional(),
});

export type ParamDefinition = z.infer<typeof ParamDefinitionSchema>;

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

export const PlaceholderDefinitionSchema = z.object({
  /** Placeholder key string used in layout XML. */
  key: z.string().min(1),
  /** Optional restriction: only these rendering handles may drop here. */
  allowedRenderingHandles: z.array(z.string()).optional(),
});

export type PlaceholderDefinition = z.infer<typeof PlaceholderDefinitionSchema>;

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
  }),
  z.object({
    scope: z.literal("site"),
    /**
     * Optional subfolder under `<contentItemsRoot>`. When present the
     * compiler emits a `CreateOnly` folder item so the shared pool is
     * materialised once per recipe-set.
     */
    subfolder: z.string().min(1).optional(),
  }),
]);

export type RenderingDatasourceLocation = z.infer<typeof RenderingDatasourceLocationSchema>;

/**
 * Top-level datasource block on `ComponentTemplateRecipe`. Captures
 * everything the rendering needs to know about its datasource:
 *
 *   - **template**: optional reference to a separate
 *     `ContentTemplateRecipe`. When set, the compiler points the
 *     rendering's Datasource Template field at that template (its
 *     fields land under `Content Models/<group>/<name>`). When unset,
 *     the component template itself is the datasource template (legacy
 *     inline-`fields:` pattern).
 *   - **autoCreate**: toggles `IsAutoDatasourceRendering=true` in the
 *     rendering's `OtherProperties` URL-encoded blob. Default true.
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
export const RecipeDatasourceSchema = z.object({
  /** Reference to a separate `ContentTemplateRecipe`. */
  template: z
    .object({
      handle: z.string().regex(HANDLE_PATTERN, {
        message: "datasource.template.handle must match `<kebab-name>@<major>`",
      }),
    })
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

export const ComponentTemplateRecipeSchema = z.object({
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
   * Reference to a separate `ParametersTemplateRecipe`. When present,
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
  params: z.array(ParamDefinitionSchema).default([]),
  /**
   * SXA placeholder keys this rendering can be PLACED INTO — the
   * allow-list. At apply time scai walks the configured Placeholder
   * Settings roots, finds items whose `Placeholder Key` field matches
   * each entry here, and appends this rendering's itemId to their
   * `Allowed Controls` field. Without this, the rendering exists in
   * CM but Pages won't offer it in any placeholder picker.
   *
   * Example: `["headless-main", "headless-main-{*}", "sxa-footer"]`.
   *
   * Distinct from `placeholders` (below), which declares slots THIS
   * component EXPOSES for child renderings.
   */
  placedIn: z.array(z.string().min(1)).default([]),
  /**
   * Container slots — placeholders this component DEFINES for child
   * renderings to drop into. Only meaningful for container components
   * (e.g. a section wrapper that exposes a `headless-main-{*}` slot).
   * Each entry carries the placeholder key + an optional restriction
   * on which rendering handles may be dropped there.
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
  otherProperties: z.record(z.string(), z.string()).optional(),
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
 * Identity: `paramsTemplateId(handle)` derives the deterministic GUID.
 * Same identity scheme as the inline-hoisted variant — the seed is the
 * recipe handle, and the namespace is `NAMESPACE_TEMPLATE`. The seed
 * suffix is `::params`, identical between inline and standalone forms,
 * which keeps re-pushes idempotent if a recipe migrates from inline to
 * standalone (the GUID stays the same).
 */
export const ParametersTemplateRecipeSchema = z.object({
  kind: z.literal("parameters-template"),
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
   * Section name under which this parameters template lands —
   * `Components/<section>/Presentation Parameters/<name>`. Required:
   * presentation parameters are organised per-section by convention.
   */
  section: z.string().min(1),
  params: z.array(ParamDefinitionSchema).default([]),
});

export type ParametersTemplateRecipe = z.infer<typeof ParametersTemplateRecipeSchema>;

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
  /** Field values keyed by field name on the template. */
  fields: z.record(z.string(), ContentFieldValueSchema).default({}),
});

export type ContentItemRecipe = z.infer<typeof ContentItemRecipeSchema>;

/**
 * One rendering placed into a placeholder, with its variant, parameters,
 * and datasource binding. The Phase 4 compiler emits each ComponentPlacement
 * as one `<r>` element in Sitecore's layout XML.
 *
 * The single shape used by anything that holds layout — `PartialDesignRecipe`,
 * `PageDesignRecipe`, and (when Phase 3 lands) `PageRecipe`. The
 * `componentHandle` resolves to a `ComponentTemplateRecipe`'s rendering
 * GUID via `renderingId(handle)`.
 *
 * `datasourceRef` distinguishes how the rendering gets its content:
 *
 *   shared  — points at a `ContentItemRecipe` by handle (catalog-shipped
 *             reusable content like `site-logo-content@1`).
 *   scoped  — page-local content at `<page>/<slot>`. Used by `PageRecipe`;
 *             `PartialDesignRecipe` and `PageDesignRecipe` typically don't
 *             use this kind, but the shared schema accepts it.
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
        /** Slot path within the host item, e.g. `/main/0`. */
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
 * `insertOptionsMatrix.*` resolve to `ContentTemplateRecipe` handles;
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
   * `ContentTemplateRecipe`). The site's content tree allows pages
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
 * `PageRecipe` (Phase 6+ — schema accepts the handle now, executor
 * support lands later).
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
   * Optional initial home page — a `PageRecipe` handle. Phase 6+
   * concern; schema accepts the handle now so SiteRecipes can
   * declare it; the executor will materialise it once page-recipe
   * execution lands.
   */
  initialHome: z.string().regex(HANDLE_PATTERN).optional(),
});

export type SiteRecipe = z.infer<typeof SiteRecipeSchema>;

/**
 * Discriminated union of recipe kinds. Compilers and validators can accept
 * `Recipe` and dispatch on `kind`.
 */
/**
 * One value in an `EnumerationRecipe`. The Sitecore item conforming to
 * this entry has its `__Display name` set to `displayName` (or `name`
 * when omitted) and is the target the editor's Droplink dropdown shows.
 *
 * `name` is load-bearing — uuidv5 derives the value item's GUID from
 * it. Renaming `name` creates a *different* value item; existing
 * datasource items that referenced the old GUID become orphaned. Use
 * `displayName` to change the visible label without touching `name`.
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
      folder: z.string().min(1).optional(),
    })
    .optional(),
  values: z.array(EnumerationValueSchema).min(1),
});

export type EnumerationRecipe = z.infer<typeof EnumerationRecipeSchema>;

export const RecipeSchema = z.discriminatedUnion("kind", [
  ComponentSectionRecipeSchema,
  ComponentTemplateRecipeSchema,
  ContentTemplateRecipeSchema,
  ContentItemRecipeSchema,
  ParametersTemplateRecipeSchema,
  SectionDefinitionRecipeSchema,
  PartialDesignRecipeSchema,
  PageDesignRecipeSchema,
  SiteTemplateRecipeSchema,
  SiteRecipeSchema,
  EnumerationRecipeSchema,
]);

export type Recipe = z.infer<typeof RecipeSchema>;

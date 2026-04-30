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
 */
export const RenderingVariantDefinitionSchema = z.object({
  name: z.string().min(1),
});

export type RenderingVariantDefinition = z.infer<typeof RenderingVariantDefinitionSchema>;

export const PlaceholderDefinitionSchema = z.object({
  /** Placeholder key string used in layout XML. */
  key: z.string().min(1),
  /** Optional restriction: only these rendering handles may drop here. */
  allowedRenderingHandles: z.array(z.string()).optional(),
});

export type PlaceholderDefinition = z.infer<typeof PlaceholderDefinitionSchema>;

export const RenderingDefinitionSchema = z.object({
  /**
   * Where the rendering looks for / creates its datasource:
   *   - `current-item` → ".", the rendering's host item itself
   *   - `query` → `datasourceLocationQuery` is required
   */
  datasourceLocation: z.enum(["current-item", "query"]).default("current-item"),
  /** Sitecore Query string; required when `datasourceLocation === "query"`. */
  datasourceLocationQuery: z.string().optional(),
  /** Restrict where this rendering can be placed (placeholder keys). */
  allowedPlaceholders: z.array(z.string()).optional(),
  /** Open the properties dialog after add (XM Cloud Pages UX). */
  openPropertiesAfterAdd: z.boolean().default(false),
  /**
   * Free-form key/value pairs encoded into the rendering's
   * "OtherProperties" URL-encoded shared field. Common values:
   * `IsAutoDatasourceRendering`, `IsRenderingsWithDynamicPlaceholders`.
   * The compiler defaults `IsAutoDatasourceRendering=true`; recipe values
   * override the default.
   */
  otherProperties: z.record(z.string(), z.string()).optional(),
});

export type RenderingDefinition = z.infer<typeof RenderingDefinitionSchema>;

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
  variants: z.array(RenderingVariantDefinitionSchema).default([]),
  params: z.array(ParamDefinitionSchema).default([]),
  placeholders: z.array(PlaceholderDefinitionSchema).optional(),
  rendering: RenderingDefinitionSchema,
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
export const ContentTemplateRecipeSchema = z.object({
  kind: z.literal("content-template"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. accordion-item@1",
  }),
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
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
 * Discriminated union of recipe kinds. Compilers and validators can accept
 * `Recipe` and dispatch on `kind`.
 */
export const RecipeSchema = z.discriminatedUnion("kind", [
  ComponentTemplateRecipeSchema,
  ContentTemplateRecipeSchema,
]);

export type Recipe = z.infer<typeof RecipeSchema>;

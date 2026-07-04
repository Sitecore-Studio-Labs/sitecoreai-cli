import { z } from "zod";
import {
  DesignParameterSchema,
  FieldDefinitionSchema,
  FolderPath,
  HANDLE_PATTERN,
  MediaLocationSchema,
  PlaceholderDefinitionSchema,
  RecipeDatasourceSchema,
  RenderingVariantDefinitionSchema,
} from "../shared";

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

export type PlaceholderRecipe = z.input<typeof PlaceholderRecipeSchema>;

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
  /**
   * Section ownership: declares whether this section is owned by the
   * recipe set (exclusive) or additive to whatever the tenant already
   * has. Single concern covering BOTH the renderings folder subtree
   * AND the Available Renderings multi-list — both flow through the
   * aggregates ComponentSection drives.
   *
   * - `"additive"` (default): the recipe set adds renderings under
   *   this section; pre-existing tenant entries the recipe set
   *   doesn't list stay put, both as items in the folder AND as
   *   entries in Available Renderings.
   * - `"exclusive"`: the recipe set defines the FULL set for the
   *   section. Items in the renderings folder absent from the recipe
   *   set get pruned (PruneChildren op targeting the folder). The
   *   Available Renderings field is overwritten with exactly the
   *   recipe set's contribution.
   *
   * `pruneMode` is the default `mode` for the compiled PruneChildren
   * op when `mode` is `"exclusive"`. `"warn"` (default) gives a
   * rehearsal: the planner emits the prune list but apply skips
   * actual deletes. `"delete"` lets apply remove (still subject to
   * the operator's `--allow-prune` flag).
   *
   * **Bidirectional sync note**: this field is recipe-author intent,
   * not derivable from tenant state. `readCurrent` (the reverse
   * projection) cannot infer whether the operator wanted exclusive
   * or additive ownership; round-tripped recipes always come back
   * with `ownership` undefined (= additive default). Operators who
   * declared `exclusive` must re-author the field after a roundtrip.
   * Same story for `PruneChildren` ops — they're compile-time
   * artifacts of this declaration, not capturable from tenant state.
   */
  ownership: z
    .object({
      mode: z.enum(["additive", "exclusive"]).default("additive"),
      pruneMode: z.enum(["warn", "delete"]).default("warn"),
    })
    .optional(),
});

export type ComponentSectionRecipe = z.input<typeof ComponentSectionRecipeSchema>;

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
     * Where external-URL image DEFAULTS (Standard Values, e.g.
     * `Avatar: "AI Assistant|https://…"`) land in the media library.
     * Only `scope: "site"` is valid — Standard Values are
     * template-level, not page-bound. Omit for the default
     * `<mediaLibraryRoot>/<recipeName>/` bucket.
     */
    mediaLocation: MediaLocationSchema.optional(),
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

export type ComponentTemplateRecipe = z.input<typeof ComponentTemplateRecipeSchema>;

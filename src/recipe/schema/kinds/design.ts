import { z } from "zod";
import { LayoutSchema } from "../content-values";
import { HANDLE_PATTERN, VARIANT_NAME_PATTERN } from "../shared";

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

export type PartialDesignRecipe = z.input<typeof PartialDesignRecipeSchema>;

/**
 * Brand-scoped sidecar variant for an existing rendering. A standalone
 * recipe that adds ONE new variant to an existing ComponentTemplateRecipe
 * without mutating it — schema-level "the canonical is sacred" enforcement.
 *
 * Compiles to two coordinated writes:
 *
 *   1. `HEADLESS_VARIANTS` per-rendering folder at
 *      `<headlessVariantsRoot>/<targetRendering.name>/` (idempotent
 *      via the executor's CreateOrUpdate semantics).
 *   2. `VARIANT_DEFINITION` item at
 *      `<headlessVariantsRoot>/<targetRendering.name>/<name>`.
 *
 * Pages discovers variants by **folder walk** — there is NO variant-list
 * field on the rendering item. Creating the item IS the registration.
 * Tree MUST be flat (`root/<rendering>/<variant>`) — wrapping in a
 * section-grouping intermediate makes Pages stop at the grouping folder
 * and never see the variants. See [`compile/component-template.ts`'s
 * `emitVariants`](compile/component-template.ts) for the verification
 * trail (live tenant 2026-05-31).
 *
 * `content` is the TSX source for the head-repo sidecar file. scai does
 * NOT consume it during recipe push — the install descriptor / file-drop
 * pipeline that runs alongside scai writes the file to the head repo's
 * `<canonical-dir>/<canonical-prefix>.<kebab(name)>.tsx` path, where
 * the Sitecore Content SDK's component-map generator
 * (`prepareComponentsForMap`) groups it with the canonical under one
 * map entry. Including it in this schema keeps the orchestrator-stored
 * row, the install descriptor, and the scai recipe all using one shape.
 *
 * No affordance to mutate the canonical's body, fields, params, or
 * datasource. Brand fidelity is a presentation concern; data-shape
 * changes belong on the canonical or as a new component.
 */
export const VariantRecipeSchema = z.object({
  kind: z.literal("variant"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN, {
    message: "handle must match `<kebab-name>@<major>`, e.g. hero-allstate-skinny@1",
  }),
  /** Reference to the canonical ComponentTemplateRecipe this variant attaches to. */
  targetRendering: z.object({
    /** Handle of the canonical rendering (e.g. `hero@1`). */
    handle: z.string().regex(HANDLE_PATTERN, {
      message: "targetRendering.handle must match `<kebab-name>@<major>`, e.g. hero@1",
    }),
    /**
     * Rendering's `name` field — the kebab-case Sitecore item name of
     * the canonical rendering (e.g. `hero`). Used to compute the
     * per-rendering Headless Variants folder path on Sitecore. Required
     * because the canonical recipe is typically NOT in this recipe set
     * (it was deployed in a prior install); we cannot look it up via
     * `componentsByHandle`. Convention: matches `handle.split("@")[0]`.
     */
    name: z.string().min(1),
  }),
  /**
   * PascalCase variant name. Same value Sitecore writes to
   * `params.FieldNames` when an author picks this variant; same value
   * the Content SDK uses to look up the named export inside the head
   * repo's sidecar file. The VARIANT_DEFINITION item lands with this
   * name under the per-rendering folder.
   */
  name: z.string().regex(VARIANT_NAME_PATTERN, {
    message:
      "Variant `name` must be PascalCase (e.g. `AllstateSkinny`) — used as both the Sitecore VARIANT_DEFINITION item name and the named export inside the sidecar TSX.",
  }),
  /** Author-facing label. Defaults to `name`. */
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  /**
   * TSX source for the head-repo sidecar file. NOT consumed by scai's
   * compile — read by the install descriptor / file-drop pipeline that
   * writes it to `<canonical-dir>/<canonical-prefix>.<kebab(name)>.tsx`
   * in the head repo. Carried on the recipe so one shape covers the
   * orchestrator DB row, the install descriptor, and this recipe.
   */
  content: z.string().min(1),
});

export type VariantRecipe = z.input<typeof VariantRecipeSchema>;

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

export type PageDesignRecipe = z.input<typeof PageDesignRecipeSchema>;

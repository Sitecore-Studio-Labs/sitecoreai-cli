import { z } from "zod";
import {
  ContentFieldValueSchema,
  ContentTranslationSchema,
  ContentVersionSchema,
} from "../content-values";
import {
  DesignParameterSchema,
  FieldDefinitionSchema,
  HANDLE_PATTERN,
  RecipeMetaSchema,
} from "../shared";

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

export type ContentTemplateRecipe = z.input<typeof ContentTemplateRecipeSchema>;

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

export type DesignParametersTemplateRecipe = z.input<typeof DesignParametersTemplateRecipeSchema>;

/**
 * A concrete content item — one Sitecore item conforming to a content
 * template, populated with the recipe's field values. The instance-side
 * companion to `ContentTemplateRecipe`: templates declare shape, content
 * items declare instance.
 *
 * Used as the `kind: "shared"` datasource target for `PartialDesignRecipe`
 * and `PageDesignRecipe` placements (e.g. `site-logo-content@1`,
 * `primary-nav-content@1`). The handle is load-bearing — `contentItemId`
 * derives the deterministic Sitecore GUID from it.
 *
 * Field-shape ↔ template-shape validation is deferred to the
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

export type ContentItemRecipe = z.input<typeof ContentItemRecipeSchema>;

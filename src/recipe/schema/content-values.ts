import { z } from "zod";
import { HANDLE_PATTERN } from "./shared";

/**
 * A single field value on a `ContentItemRecipe`. Tagged on `shape` so
 * the compiler can dispatch each value to the right Sitecore wire
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
 * One rendering placed into a placeholder, with its variant, parameters,
 * and datasource binding. The compiler emits each ComponentPlacement
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
        /**
         * Field values for the materialised `<page>/Data/<slot>` item,
         * keyed by field name (matching the rendering's
         * `ComponentTemplateRecipe` field names). Accepts both the
         * scai-native discriminated `ContentFieldValue` shape
         * (`{ shape, value, ... }`) and the registry's flat shape —
         * plain strings (text), booleans, numbers, `{ src, alt }` for
         * image fields, `{ href, text }` for link-external fields. The
         * compiler normalises into `ContentFieldValue` and reuses
         * `encodeContentFieldValue` to emit the Sitecore wire form.
         */
        fields: z.record(z.string(), z.unknown()).default({}),
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

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
    /**
     * Sitecore media-library path, or a fully-qualified external image
     * URL. Library paths emit `<image mediapath="…" />` XML. External
     * URLs are materialised as REAL media items at push time — the
     * compiler emits a MediaUpload op (the executor downloads the bytes
     * and uploads them to the media library) plus a `media-xml-ref`
     * field value that resolves to `<image mediaid="{GUID}" />`. That
     * is the only form the Layout Service surfaces as a renderable
     * `src`; bare `src=`/`mediapath=` attributes show a thumbnail in
     * Pages' field editor but never render on the canvas or head apps.
     */
    mediaPath: z.string().min(1),
    alt: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    /**
     * Destination media-library FOLDER for an external-URL image (e.g.
     * `/sitecore/media library/Project/MySite/Avatars`). Only the
     * generated leaf name is appended. Overrides the env profile's
     * `recipeRoots.mediaLibrary` / `--media-library-root` for this one
     * image; ignored for media-library-path values (nothing to upload).
     */
    mediaLibraryFolder: z.string().min(1).optional(),
    /**
     * Semantic image role (`hero`, `avatar`, `product`, …). When a push
     * supplies an image-defaults map (`--image-defaults <file.json>`,
     * role → URL) and this role appears in it, the mapped URL is
     * materialised instead of `mediaPath`. External-URL values only;
     * absent role or no map → `mediaPath` applies unchanged.
     */
    role: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/, "role must be a short kebab-case slug")
      .optional(),
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
 * The datasource binding on a placement — input (authoring) and output
 * (parsed) forms. Hand-declared alongside the recursive
 * `ComponentPlacement` interfaces below: the only input/output
 * difference is the scoped ref's `fields`, which Zod defaults to `{}`.
 */
export type ComponentPlacementDatasourceRefInput =
  | { kind: "shared"; handle: string }
  | { kind: "scoped"; slot: string; fields?: Record<string, unknown> }
  | { kind: "none" };

export type ComponentPlacementDatasourceRef =
  | { kind: "shared"; handle: string }
  | { kind: "scoped"; slot: string; fields: Record<string, unknown> }
  | { kind: "none" };

/**
 * Authoring (input) shape of one placement. Recursive: a placement may
 * host children in its own placeholders (`placement.placeholders` —
 * layout components like `column-splitter@1` expose one slot per
 * column). Keys are the component's LOGICAL placeholder names
 * (`column-1`, `column-2` — the static prefix of a dynamic placeholder,
 * no instance suffix).
 *
 * Only valid in a `PageRecipe` layout. `compilePageRecipe` flattens the
 * tree into SXA dynamic-placeholder wire form: the parent placement gets
 * a page-unique integer `DynamicPlaceholderId` rendering parameter
 * (unless the author set one) and each child lands in the
 * path-qualified key `/<parent-placeholder-path>/<name>-<DynamicPlaceholderId>`
 * — the key shape XM Cloud Pages writes when an author drops a component
 * into a dynamic placeholder, and the shape headless components resolve
 * via `params.DynamicPlaceholderId`. Partial- and page-design layouts
 * reject nesting (no host page). Nesting depth is unbounded.
 *
 * The interfaces are hand-declared (rather than `z.infer`red) so the
 * recursion resolves lazily: an inferred recursive schema type gets
 * INLINED structurally into every consuming schema's emitted `.d.ts`,
 * and downstream `z.output` expansion of page/content-item schemas then
 * exceeds TypeScript's instantiation depth (TS2589) in consumer repos.
 * Named interfaces keep the emitted types small and cacheable.
 */
export interface ComponentPlacementInput {
  /** Handle of a `ComponentTemplateRecipe` (`<kebab-name>@<major>`). */
  componentHandle: string;
  /** SXA Rendering Variant name. Defaults to the component's first variant. */
  variant?: string;
  /** Rendering Parameters (URL-encoded into the placement's params blob). */
  params?: Record<string, string>;
  /** Nested placements, keyed by the component's logical placeholder names. */
  placeholders?: Record<string, ComponentPlacementInput[]>;
  /**
   * How the rendering's content is bound. Omit for `kind: "none"`
   * semantics.
   *
   *   shared  — a `ContentItemRecipe` handle (catalog-shipped reusable
   *             content like `site-logo-content@1`).
   *   scoped  — page-local content materialised at `<page>/Data/<slot>`;
   *             `fields` accepts both the scai-native discriminated
   *             `ContentFieldValue` shape and the registry's flat shape.
   *             Only valid in a `PageRecipe` layout.
   *   none    — config-driven rendering with no datasource (rare).
   */
  datasourceRef?: ComponentPlacementDatasourceRefInput;
}

/** Parsed (output) shape of one placement — scoped `fields` defaulted. */
export interface ComponentPlacement {
  componentHandle: string;
  variant?: string;
  params?: Record<string, string>;
  placeholders?: Record<string, ComponentPlacement[]>;
  datasourceRef?: ComponentPlacementDatasourceRef;
}

/**
 * One rendering placed into a placeholder — see the interface docs
 * above. `z.lazy` + the explicit `z.ZodType` annotation is the
 * recursive-schema pattern: the annotation terminates type inference,
 * and the emitted declaration references the named interfaces instead
 * of inlining a structural tree.
 */
export const ComponentPlacementSchema: z.ZodType<ComponentPlacement, ComponentPlacementInput> =
  z.lazy(() =>
    z.object({
      componentHandle: z.string().regex(HANDLE_PATTERN, {
        message: "componentHandle must match `<kebab-name>@<major>`",
      }),
      variant: z.string().optional(),
      params: z.record(z.string(), z.string()).optional(),
      placeholders: z.record(z.string(), z.array(ComponentPlacementSchema)).optional(),
      datasourceRef: z
        .discriminatedUnion("kind", [
          z.object({
            kind: z.literal("shared"),
            handle: z.string().regex(HANDLE_PATTERN),
          }),
          z.object({
            kind: z.literal("scoped"),
            // Page-local datasource name — must be a valid Sitecore item
            // name; `compilePageRecipe` materialises `<page>/Data/<slot>`.
            slot: z.string().min(1),
            fields: z.record(z.string(), z.unknown()).default({}),
          }),
          z.object({ kind: z.literal("none") }),
        ])
        .optional(),
    })
  );

/**
 * Layout block keyed by placeholder. Each placeholder holds an ordered
 * array of `ComponentPlacement`s — render order is array order.
 */
export const LayoutSchema = z.object({
  placeholders: z.record(z.string(), z.array(ComponentPlacementSchema)).default({}),
});

export type Layout = z.infer<typeof LayoutSchema>;

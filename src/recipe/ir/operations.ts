import { z } from "zod";

/**
 * Operation IR — the only artifact the recipe compiler emits.
 *
 * Each operation carries a deterministic GUID (resolved via uuidv5 from the
 * recipe handle) so re-running the compiler against the same inputs yields
 * the same IR, and re-applying it against a tenant is a no-op once the
 * items exist (the executor reads remote state by GUID, diffs, then mutates).
 *
 * `policy` is the per-operation push policy: `CreateOnly` is how author
 * edits in the CMS are protected; `CreateAndUpdate` is the default for
 * registry-owned templates and renderings.
 */

const GUID = z.string().uuid();
const NON_EMPTY = z.string().min(1);

export const PushPolicySchema = z.enum(["CreateAndUpdate", "CreateOnly", "CreateUpdateAndDelete"]);

export type PushPolicy = z.infer<typeof PushPolicySchema>;

/**
 * Reference encodings the IR must distinguish — Sitecore stores cross-item
 * references in many shapes (see `plans/sitecore-relationships.md`,
 * "Reference encoding patterns"). The executor decides per-field which form
 * to serialize.
 *
 * Two flavors of GUID reference:
 *
 *   - `ref-guid` / `ref-guid-list` — known-at-compile-time GUIDs (Sitecore
 *     built-ins like the Standard Template, Folder, View Rendering). Inline
 *     constants; no runtime resolution needed.
 *   - `ref-recipe` / `ref-recipe-list` — references to items the executor
 *     creates during this push. The Authoring API server-assigns itemIds
 *     on create, so the IR carries a recipe-internal `refKey` (uuidv5
 *     derived from the recipe handle) and the executor substitutes the
 *     captured Sitecore itemId before dispatching the field write.
 */
export const RefValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("string"), value: z.string() }),
  z.object({ kind: z.literal("bool"), value: z.boolean() }),
  z.object({ kind: z.literal("number"), value: z.number() }),
  z.object({ kind: z.literal("ref-guid"), value: GUID }),
  z.object({ kind: z.literal("ref-guid-list"), values: z.array(GUID) }),
  z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
  z.object({
    kind: z.literal("ref-recipe-list"),
    refKeys: z.array(GUID),
    /**
     * When `true`, the resolver silently drops refKeys it can't find
     * in the captured-itemId map instead of throwing. Default false
     * (existing strict behavior — used by per-recipe SetField ops
     * where a missing ref means a real bug). Set true on cross-recipe
     * aggregate ops (e.g. `__available-renderings__`) where some
     * sibling recipe IRs may have aborted and the aggregate should
     * still write whichever items DID get created.
     */
    tolerateMissing: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("ref-path"), value: NON_EMPTY }),
  z.object({ kind: z.literal("query"), value: NON_EMPTY }),
  /**
   * Structured source fields whose `sourceTypes` reference one or more
   * recipe handles. Resolution requires the captured-itemId map; rendered
   * by the executor (via `renderSourceFields`) just before dispatching
   * the field write. Mirrors the `SitecoreFieldAugment` source surface
   * minus `sourceRaw` (raw is always rendered at compile time).
   *
   * `site` is the site name the compiler emitted under — required so the
   * executor can resolve handle refKeys via the (site, handle)-scoped
   * `templateId(site, handle)` derivation. Defaults to `default` when the
   * compiler ran without `context.site`.
   */
  z.object({
    kind: z.literal("ref-source-fields"),
    site: NON_EMPTY,
    sourceTypes: z.array(NON_EMPTY).min(1),
    sourceQuery: z.string().optional(),
    sourceScope: z.string().optional(),
  }),
  z.object({
    kind: z.literal("url-string-map"),
    entries: z.record(z.string(), z.string()),
  }),
]);

export type RefValue = z.infer<typeof RefValueSchema>;

export const FieldValueSchema = z.object({
  fieldId: GUID,
  /**
   * Optional human-readable field name (e.g. "Body"). When present, the
   * authoring client uses this as the mutation's field selector and the
   * planner uses it for diff matching against `RemoteFieldValue.name`.
   *
   * Required for fields on RECIPE-CREATED templates: Sitecore assigns
   * server-side itemIds to Template Field items, so the recipe-derived
   * `fieldId(handle, name)` is just an internal refKey — the tenant has
   * a different GUID for the same field. Sitecore's `FieldValueInput.name`
   * accepts either a name or an ID, but only IDs that exist on the tenant
   * resolve. Field names always resolve against the item's template.
   *
   * Omit for SYSTEM fields (e.g. `__Display Name`, `__Renderings`,
   * `TemplatesMapping`) — those GUIDs are real Sitecore built-ins and
   * resolve directly.
   */
  fieldName: z.string().min(1).optional(),
  /** Omit for shared fields; default `en` for versioned fields. */
  language: z.string().optional(),
  /** Omit for shared fields; default `1` for versioned fields. */
  version: z.number().int().positive().optional(),
  value: RefValueSchema,
});

export type FieldValue = z.infer<typeof FieldValueSchema>;

const BaseOpFields = {
  policy: PushPolicySchema,
  /** Stable, recipe-derived label used in plan/push progress events. */
  label: NON_EMPTY,
} as const;

export const CreateItemOpSchema = z.object({
  op: z.literal("CreateItem"),
  ...BaseOpFields,
  /**
   * Recipe-internal uuidv5. Stable across compiles. Used as the refKey for
   * `ref-recipe` substitutions in subsequent ops. NOT a Sitecore item ID —
   * Sitecore assigns those server-side on `createItem`.
   */
  id: GUID,
  /**
   * Sitecore content-tree path where the item lives (parent + name). The
   * runtime authority for "does this item exist?" — the planner reads
   * by path, the executor creates at this path. Examples:
   *   /sitecore/templates/Project/CtaButton
   *   /sitecore/templates/Project/CtaButton/Content/Link
   */
  path: NON_EMPTY,
  /**
   * Parent ref. `ref-recipe` resolves to the captured Sitecore itemId for
   * a previously-created item in this push; `ref-path` is a Sitecore path
   * (typically the configured templatesRoot for top-level items).
   */
  parent: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
    z.object({ kind: z.literal("ref-path"), value: NON_EMPTY }),
  ]),
  /**
   * Template the new item conforms to. Two shapes:
   *
   *   - **GUID string** — the conventional case: a Sitecore built-in
   *     template ID (see `SITECORE_TEMPLATES`), or a refKey for a
   *     template the same push creates (the planner resolves both
   *     against `capturedItemIds`).
   *   - **`{kind: "ref-path", value}`** — late-resolved against a
   *     content-tree path. Used by recipes that conform new items to
   *     system templates whose GUIDs aren't published as a public
   *     contract (e.g. workflow `Workflow`/`State`/`Command` templates,
   *     webhook authorization templates). The push pipeline pre-seeds
   *     these via the same `crossRecipeRefs` mechanism that resolves
   *     ref-path parents: a single `getItemsByPaths` batch lookup
   *     before planning.
   */
  templateOf: z.union([
    GUID,
    z.object({ kind: z.literal("ref-path"), value: NON_EMPTY }),
  ]),
  name: NON_EMPTY,
  fields: z.array(FieldValueSchema),
});

export const SetFieldOpSchema = z.object({
  op: z.literal("SetField"),
  ...BaseOpFields,
  /** RefKey of the target item — resolves to Sitecore itemId at execute time. */
  itemRefKey: GUID,
  fieldId: GUID,
  /**
   * Optional human-readable field name. See `FieldValueSchema.fieldName`
   * — required for fields on recipe-created templates, omit for system
   * fields whose GUIDs are Sitecore built-ins.
   */
  fieldName: z.string().min(1).optional(),
  language: z.string().optional(),
  version: z.number().int().positive().optional(),
  value: RefValueSchema,
  /**
   * Optional content-tree path for late ref seeding. Used by SiteRecipe
   * dictionary overrides where the target item (`<site>/Dictionary/<phrase>`)
   * is materialised by SXA's Site Wizard during a `CreateSiteFromTemplate`
   * apply, AFTER initial `crossRecipeRefs` seeding. The executor checks
   * if `itemRefKey` is in the captured map; if not AND `latePath` is
   * present, it runs `getItem({ path: latePath })` on demand to seed
   * before planning the SetField.
   *
   * Compiler emits this only when the target item is created indirectly
   * (Sites API / SXA scaffolding); regular SetField ops on items the
   * recipe itself creates leave this undefined.
   */
  latePath: z.string().min(1).optional(),
});

export const SetBaseTemplatesOpSchema = z.object({
  op: z.literal("SetBaseTemplates"),
  ...BaseOpFields,
  /** RefKey of the target item. */
  itemRefKey: GUID,
  baseTemplates: z.array(GUID).min(1),
});

export const SetStandardValuesOpSchema = z.object({
  op: z.literal("SetStandardValues"),
  ...BaseOpFields,
  /** RefKey of the template item. */
  templateRefKey: GUID,
  /** RefKey of the standard-values item. */
  standardValuesRefKey: GUID,
});

/**
 * Site instantiation via Sitecore's Sites API. Unlike CreateItem (which
 * dispatches to Authoring GraphQL), CreateSiteFromTemplate dispatches
 * to the Sites API's `createSite` operation — the only way to spin up
 * a site instance with all the SXA initialization (content tree
 * skeleton, settings, dictionary structure, etc.) that Authoring API
 * `createItem` can't reproduce.
 *
 * Async semantics: the Sites API's `createSite` returns a JobResponse
 * (a job handle); the executor polls until completion, then looks up
 * the created site by name to capture its assigned itemId. The
 * captured itemId becomes the resolution target for subsequent ops
 * keyed on `siteRefKey`.
 *
 * Idempotency: planner checks if a site with this `siteName` already
 * exists in the environment via Sites API `listSites`. If yes →
 * status: skip (mutation: undefined). If no → status: create, mutation
 * dispatches `createSite`. There is no "update site template"
 * operation on the Sites API; mismatched-template sites are reported
 * as planning errors rather than silently re-instantiated.
 */
export const CreateSiteFromTemplateOpSchema = z.object({
  op: z.literal("CreateSiteFromTemplate"),
  ...BaseOpFields,
  /**
   * Recipe-internal uuidv5 for this site (`siteId(handle)`). Subsequent
   * SetField ops on the site's content tree (dictionary overrides,
   * taxonomy overrides) reference items the Sites API materialises
   * under this site; the executor seeds those itemIds via a post-apply
   * re-walk of the cross-recipe ref map.
   */
  siteRefKey: GUID,
  /**
   * The Sitecore site Name (becomes Sites API `NewSiteInput.siteName`).
   * Distinct from the recipe handle.
   */
  siteName: NON_EMPTY,
  displayName: z.string().optional(),
  description: z.string().optional(),
  /** Primary site language ISO code (Sites API `NewSiteInput.language`). */
  language: NON_EMPTY,
  /** Additional supported languages on this site (added via `addLanguage`). */
  additionalLanguages: z.array(z.string().min(2)).optional(),
  /**
   * Optional primary hostname (Sites API `NewSiteInput.hostName`). When
   * unset, the site is created without an explicit primary host (the
   * customer can configure hosts via the Site Hosts surface).
   */
  hostName: z.string().optional(),
  /**
   * RefKey of the `SiteTemplateRecipe` this site instances. Resolves at
   * execute time to the template's Sitecore itemId via the captured
   * map; that itemId becomes Sites API `NewSiteInput.templateId`.
   */
  templateRefKey: GUID,
  /**
   * Existing collection ID. Mutually exclusive with `collectionName` —
   * compiler validates that exactly one is present.
   */
  collectionId: z.string().optional(),
  /**
   * Name of a NEW collection to create alongside the site. Mutually
   * exclusive with `collectionId`.
   */
  collectionName: z.string().optional(),
  collectionDisplayName: z.string().optional(),
  collectionDescription: z.string().optional(),
});

/**
 * Append GUIDs to an existing item's multi-list field without disturbing
 * existing values. Used by registry-driven recipes to register their
 * renderings against pre-existing SXA Available Rendering Section
 * Definition items (`availableIn` on `ComponentTemplateRecipe`).
 *
 * Idempotent under `policy: "merge-unique"` — the executor reads the
 * current field value, parses it as a pipe-separated GUID list,
 * unions the desired values into the existing set, and writes back
 * only if the set changed. Re-pushing a recipe with the same
 * `values` is a no-op once the values are present.
 *
 * Removal is intentionally NOT modelled here — uninstalling a
 * component does not auto-remove it from a section's Available
 * Renderings; that's an explicit operator action with a different
 * policy.
 */
export const AppendToMultiListOpSchema = z.object({
  op: z.literal("AppendToMultiList"),
  ...BaseOpFields,
  /**
   * RefKey of the target item — typically a SectionDefinitionRecipe's
   * `sectionDefinitionId(handle)`. The executor resolves it to a
   * Sitecore itemId via the captured map; cross-recipe pre-seeding
   * (path lookup) populates the map for items the current recipe
   * doesn't itself create.
   */
  itemRefKey: GUID,
  /**
   * Optional content-tree path for late-path seeding — same semantics
   * as `SetFieldOpSchema.latePath`. Section definition items are
   * typically pre-existing tenant scaffolding (not created by the
   * recipe set), so the compiler emits this so the executor can
   * resolve the itemId on demand if it's not in the captured map.
   */
  latePath: z.string().min(1).optional(),
  /**
   * Field GUID — the multi-list field to append into (e.g.
   * Available Renderings). System fields use real Sitecore GUIDs;
   * recipe-defined multi-list fields would carry the recipe-internal
   * refKey (this case isn't used today but is forward-compatible).
   */
  fieldId: GUID,
  /**
   * Optional human-readable field name. See `FieldValueSchema.fieldName`
   * — required for fields on recipe-created templates, omit for
   * system fields whose GUIDs are real Sitecore built-ins.
   */
  fieldName: z.string().min(1).optional(),
  /**
   * GUIDs to append. Same value can be specified twice (the executor
   * de-duplicates after the merge) but compilers should normalise.
   * Each entry is either:
   *   - a real Sitecore GUID (`ref-guid` style — already resolved)
   *   - a recipe-internal refKey (`ref-recipe` style — resolved via
   *     captured map at execute time)
   *
   * The compiler emits a discriminated `RefValue` per entry so the
   * executor can resolve recipe-handle refs (rendering GUIDs derived
   * from `renderingId(handle)`) without compile-time knowledge of
   * the tenant's assigned itemIds.
   */
  values: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ref-guid"), value: GUID }),
        z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
      ])
    )
    .min(1),
  /**
   * Append policy. `merge-unique` is the only supported value today
   * (preserve existing, add missing). The discriminator is reserved so
   * future policies — `replace` (full overwrite) or `replace-prefix`
   * (atomic swap of a recipe-owned subset) — can land without changing
   * the op shape. Existing IRs continue to round-trip unchanged.
   */
  appendPolicy: z.literal("merge-unique"),
});

export const OperationSchema = z.discriminatedUnion("op", [
  CreateItemOpSchema,
  SetFieldOpSchema,
  SetBaseTemplatesOpSchema,
  SetStandardValuesOpSchema,
  CreateSiteFromTemplateOpSchema,
  AppendToMultiListOpSchema,
]);

export type CreateItemOp = z.infer<typeof CreateItemOpSchema>;
export type SetFieldOp = z.infer<typeof SetFieldOpSchema>;
export type SetBaseTemplatesOp = z.infer<typeof SetBaseTemplatesOpSchema>;
export type SetStandardValuesOp = z.infer<typeof SetStandardValuesOpSchema>;
export type CreateSiteFromTemplateOp = z.infer<typeof CreateSiteFromTemplateOpSchema>;
export type AppendToMultiListOp = z.infer<typeof AppendToMultiListOpSchema>;
export type Operation = z.infer<typeof OperationSchema>;

export const OperationIrSchema = z.object({
  schemaVersion: z.literal("1"),
  /** Source recipe handle, e.g. `cta-button@1`. */
  recipeHandle: NON_EMPTY,
  operations: z.array(OperationSchema),
});

export type OperationIr = z.infer<typeof OperationIrSchema>;

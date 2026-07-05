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
  /**
   * Sitecore media-XML reference to a recipe-uploaded media item.
   * The executor renders this as `<image mediaid="{${guid}}" />`
   * (with curly braces around the GUID) where `guid` is the
   * server-assigned media item itemId resolved from `refKey` via
   * the captured-itemId map — populated by `MediaUploadOp`'s apply.
   *
   * Mirrors `ref-recipe` resolution semantics; the wrapper element is
   * the only difference. The `__Thumbnail` field (and any other
   * Thumbnail-typed field) requires this XML shape — a raw GUID
   * silently no-ops on the picker side.
   *
   * Executor wiring lands with sub-milestone E.
   */
  z.object({ kind: z.literal("media-xml-ref"), refKey: GUID }),
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
  templateOf: z.union([GUID, z.object({ kind: z.literal("ref-path"), value: NON_EMPTY })]),
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
  /**
   * Base templates resolved by TENANT PATH at plan/apply time, appended
   * to `baseTemplates`. For each entry the executor runs
   * `getItem({ path })`: found → the live item's id joins the base list;
   * missing → `fallbackTemplates` join instead.
   *
   * Exists for pre-existing tenant scaffolding whose GUID is per-tenant
   * and therefore unknowable at compile time — the canonical case is a
   * page template inheriting the SXA-scaffolded
   * `/sitecore/templates/Project/<collection>/Page` when present,
   * falling back to the raw SXA Foundation page facets when not.
   */
  pathBases: z
    .array(
      z.object({
        path: z.string().min(1),
        fallbackTemplates: z.array(GUID).default([]),
      })
    )
    .optional(),
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
  /**
   * Allowed to be empty: with `appendPolicy: "replace"`, an empty `values`
   * means "clear the multi-list" (the recipe set owns the field and has
   * decided nothing belongs in it). With `merge-unique`, an empty array
   * is a no-op (nothing to merge), which the planner skips. Either way
   * the planner handles the case explicitly — no need for a `min(1)`
   * gate at schema level.
   */
  values: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ref-guid"), value: GUID }),
      z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
    ])
  ),
  /**
   * Append policy.
   *
   * - `merge-unique` (default semantics): preserve existing values, add
   *   missing ones. Safe-by-default — other recipes can also contribute
   *   to the same list without conflict.
   * - `replace`: overwrite the field with exactly `values`. Used by
   *   recipes that declare exclusive ownership of the list (e.g. a
   *   `SectionDefinitionRecipe` with `ownership: { availableRenderings:
   *   "exclusive" }` declaring that the components contributing to its
   *   Available Renderings field in this push set are the full intended
   *   set). On apply, entries not in `values` are removed.
   *   Compiled by `buildSectionDefinitionOwnershipAggregate`.
   *
   * The `replace-prefix` policy (atomic swap of a recipe-owned subset)
   * remains reserved for a future op shape; not implemented today.
   */
  appendPolicy: z.enum(["merge-unique", "replace"]),
});

/**
 * Add a numbered version (or a language version) to an existing item.
 *
 * `CreateItem` makes an item with version 1 in the default language;
 * `SetField` writes a field on an *assumed-existing* `(language, version)`.
 * Neither *creates* a version. Story-seed content recipes — which author
 * en v1/v2/v3, fr v1, … — need this op to materialise the version slots
 * the per-version `SetField` ops then fill.
 *
 * `version` declares intent: "version N should exist in `language`."
 * Sitecore assigns numbered versions sequentially, so the executor
 * reconciles — it adds versions until the item has at least `version` of
 * them in `language`. Idempotent: a no-op when the version already
 * exists, which is what lets a re-push converge cleanly. When `language`
 * has no versions yet, the executor creates that language version too.
 *
 * Emitted in version order by the content-item compiler, between the
 * `CreateItem` op and the per-version `SetField` ops.
 */
export const AddItemVersionOpSchema = z.object({
  op: z.literal("AddItemVersion"),
  ...BaseOpFields,
  /** RefKey of the target item — resolves to a Sitecore itemId at execute time. */
  itemRefKey: GUID,
  /**
   * Language whose version stack this op extends (ISO code, e.g. `en`,
   * `fr`). When the language has no versions yet, the executor creates
   * the language version as part of adding version 1.
   */
  language: z.string().min(1),
  /**
   * The numbered version this op ensures exists (1-based). The executor
   * adds versions until the item has at least this many in `language`.
   */
  version: z.number().int().positive(),
});

/**
 * Prune children of a container item that aren't in `allowedHandles`.
 *
 * The opt-in counterpart to scai's merge-by-default model. Until a recipe
 * declares `ownership.mode: "exclusive"` on a container, this op is
 * never emitted — recipes only ever ADD/UPDATE items, never remove.
 *
 * **Forward-only.** This op is a compile-time artifact of an ownership
 * declaration in a recipe-author's source. `readCurrent` (reverse
 * projection from tenant state) cannot recover it — there's no tenant
 * signal that distinguishes "the recipe owns this folder exclusively"
 * from "the recipe contributes additively." Round-tripped recipes lose
 * the prune op entirely; operators who want exclusive ownership must
 * re-declare it on the ComponentSectionRecipe.
 *
 * Compiled from a recipe-set–level pass that walks every CreateItem op in
 * the IR (intra- and cross-recipe both) and collects those whose `parent`
 * resolves to the owner's itemRefKey. Their refKeys become `allowedHandles`;
 * anything else under the parent at apply time is pruned.
 *
 * Emitted at the very end of the apply order (after all CreateItem and
 * SetField ops in every recipe) so the pruner sees the freshly-created
 * tree, not a half-built one. See `RECIPE_APPLY_RANK` in `compile.ts`.
 *
 * Two consent layers protect this op:
 *  1. `mode: "warn"` (default for newly-authored ownership) — the planner
 *     emits the prune list but the executor skips the actual delete. Lets
 *     authors rehearse before flipping to `"delete"`.
 *  2. CLI `--allow-prune` — even with `mode: "delete"`, the apply throws
 *     `POLICY_DENIED` unless the operator explicitly opted in for THIS push.
 *     Recipe-author intent (mode) and operator intent (--allow-prune) are
 *     independent gates so neither alone can cause silent data loss.
 *
 * Rollback is intentionally lossy — re-created items get new GUIDs, and
 * descendants/fields are restored from a single-level snapshot only.
 */
export const PruneChildrenOpSchema = z
  .object({
    op: z.literal("PruneChildren"),
    ...BaseOpFields,
    /**
     * RefKey of the parent container — resolves to the Sitecore itemId of
     * the item whose children are subject to the prune via `capturedItemIds`.
     */
    parentRefKey: GUID,
    /**
     * Optional content-tree path for late-path seeding — same semantics as
     * `SetFieldOpSchema.latePath` / `AppendToMultiListOpSchema.latePath`.
     * Container items are often pre-existing tenant scaffolding (not created
     * by the recipe set), so the compiler emits this so the executor can
     * resolve the parent itemId on demand if it's not in the captured map.
     */
    latePath: z.string().min(1).optional(),
    /**
     * Children to KEEP. Anything under `parentRefKey` not in this list at
     * apply time is pruned. Each entry is either:
     *   - a real Sitecore GUID (`ref-guid` style — already resolved)
     *   - a recipe-internal refKey (`ref-recipe` style — resolved via the
     *     captured map at execute time)
     *
     * An empty list IS legal, but ONLY when paired with a non-empty
     * `templateFilter` — the combination of "no allowed handles" and
     * "no template scoping" would prune every direct child of `parent`
     * indiscriminately. The schema-level refinement below refuses the
     * unguarded shape so hand-authored ops that forget the filter can't
     * silently nuke a tenant's subtree.
     */
    allowedHandles: z.array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ref-guid"), value: GUID }),
        z.object({ kind: z.literal("ref-recipe"), refKey: GUID }),
      ])
    ),
    /**
     * Optional template-GUID filter. When set (with ≥1 entry), only
     * children whose template matches one of these GUIDs are considered
     * for pruning; children of other templates are ignored. Lets a recipe
     * own one "kind" of child without disturbing co-located items of
     * other shapes (e.g. own the Rendering items in a folder, leave
     * nested sub-folders alone). Required when `allowedHandles` is
     * empty — see the schema refinement.
     */
    templateFilter: z.array(GUID).optional(),
    /**
     * - `"warn"` (default for newly-authored ownership): the planner emits
     *   the would-prune list and the apply log surfaces it, but the executor
     *   skips the actual delete. Rehearsal mode.
     * - `"delete"`: apply actually removes children. Even then the executor
     *   still requires CLI `--allow-prune`; the two layers are independent.
     */
    mode: z.enum(["warn", "delete"]),
  })
  .refine(
    (op) => op.allowedHandles.length > 0 || (op.templateFilter && op.templateFilter.length > 0),
    {
      message:
        "PruneChildren with empty `allowedHandles` requires a non-empty `templateFilter` — the unguarded shape would prune every direct child of the parent indiscriminately. Either list the handles to keep, or scope the prune to specific template GUIDs.",
      path: ["allowedHandles"],
    }
  );

/**
 * Upload a media-library item from an external URL or a local asset path.
 *
 * Used by `SiteTemplateRecipe.thumbnail` and `.image` — sub-milestone A's
 * U3 finding (`docs/plans/site-template-modules-and-picker.investigation.json`)
 * established that the Sites API picker's `thumbnail` field surface
 * (`__Thumbnail`, GUID `c7c26117-…`) accepts Sitecore media-XML only
 * (`<image mediaid="{GUID}" />`); writing a raw URL is silently a
 * no-op. The discriminated source union mirrors the recipe-side
 * `thumbnail` / `image` shape:
 *
 *   - `kind: "external-url"` — author hosts the source bytes
 *     externally (CDN, S3, GitHub raw); the executor fetches the
 *     bytes at apply time and uploads them to Sitecore's media library.
 *   - `kind: "asset"` — `path` is a recipe-file-relative reference
 *     (e.g. `./thumbnail.png`). The executor reads the file locally
 *     and uploads it.
 *
 * The compiler emits one MediaUpload op per thumbnail/image, AND a
 * SetField op against the consuming item (the SiteTemplate) whose
 * value is a `string` reference of the shape `<image mediaid="{${id}}" />`
 * — at apply time the executor substitutes the uploaded media item's
 * server-assigned GUID into the templated string. The `id` field
 * here is the refKey that ties the two ops together.
 *
 * Executor wiring lands with sub-milestone E (live integration test
 * with the orchestrator); this commit only locks the IR shape so the
 * site-template compiler can emit ops.
 */
export const MediaUploadOpSchema = z.object({
  op: z.literal("MediaUpload"),
  ...BaseOpFields,
  /**
   * Recipe-internal uuidv5. Stable across compiles. Used as the refKey
   * for `<image mediaid="{${id}}" />`-shaped SetField value strings
   * the compiler emits alongside this op; the executor substitutes the
   * captured Sitecore media itemId before dispatching the field write.
   */
  id: GUID,
  /**
   * Discriminated byte source — external URL the executor fetches, or
   * a local asset path the executor reads. Both terminate in a media
   * library upload + a `__Thumbnail`-shape SetField write.
   */
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("external-url"), url: NON_EMPTY }),
    z.object({ kind: z.literal("asset"), path: NON_EMPTY }),
  ]),
  /**
   * Optional override for the media library destination path. Default
   * (when unset): `/sitecore/media library/SiteTemplates/<recipeName>/<basename>`
   * where `basename` is the source URL's pathname tail or the asset
   * path's basename. The compiler emits the recipe-name-scoped default
   * for site-template recipes; future callers (page-recipe images,
   * partial-design hero shots) can override per-op.
   */
  destinationPath: z.string().min(1).optional(),
  /** Optional alt text — becomes the media item's `Alt` field. */
  altText: z.string().optional(),
});

export const OperationSchema = z.discriminatedUnion("op", [
  CreateItemOpSchema,
  SetFieldOpSchema,
  SetBaseTemplatesOpSchema,
  SetStandardValuesOpSchema,
  CreateSiteFromTemplateOpSchema,
  AppendToMultiListOpSchema,
  AddItemVersionOpSchema,
  PruneChildrenOpSchema,
  MediaUploadOpSchema,
]);

export type CreateItemOp = z.infer<typeof CreateItemOpSchema>;
export type SetFieldOp = z.infer<typeof SetFieldOpSchema>;
export type SetBaseTemplatesOp = z.infer<typeof SetBaseTemplatesOpSchema>;
export type SetStandardValuesOp = z.infer<typeof SetStandardValuesOpSchema>;
export type CreateSiteFromTemplateOp = z.infer<typeof CreateSiteFromTemplateOpSchema>;
export type AppendToMultiListOp = z.infer<typeof AppendToMultiListOpSchema>;
export type AddItemVersionOp = z.infer<typeof AddItemVersionOpSchema>;
export type PruneChildrenOp = z.infer<typeof PruneChildrenOpSchema>;
export type MediaUploadOp = z.infer<typeof MediaUploadOpSchema>;
export type Operation = z.infer<typeof OperationSchema>;

export const OperationIrSchema = z.object({
  schemaVersion: z.literal("1"),
  /** Source recipe handle, e.g. `cta-button@1`. */
  recipeHandle: NON_EMPTY,
  operations: z.array(OperationSchema),
});

export type OperationIr = z.infer<typeof OperationIrSchema>;

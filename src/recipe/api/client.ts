/**
 * Authoring API client surface for recipe execution.
 *
 * The Sitecore Authoring API server-assigns itemIds on `createItem` —
 * we cannot specify them. The recipe push therefore uses **paths** as
 * the identity hook: each CreateItem op carries a deterministic path
 * (`<templatesRoot>/<recipe.name>/...`) that the planner uses for
 * lookup, and the `createItem` mutation returns the assigned itemId,
 * which the executor caches in a per-run map keyed by recipe-internal
 * uuidv5 refKey for cross-reference resolution.
 *
 * The IR planner and executor depend only on this interface. Production
 * runs use `createAuthoringClient` from `./authoring-client`; tests
 * inject a mock — same seam either way.
 */

import type { FieldValue } from "../ir/operations";

export interface RemoteFieldValue {
  fieldId: string;
  /**
   * Field name as defined on the template (e.g. `Body`, `__Display Name`).
   * Real `getItem` responses always carry this; optional in the type so
   * that test mocks aren't forced to populate it for fieldId-only
   * scenarios. The planner prefers name-based matching when the IR's
   * SetField op carries a `fieldName` (recipe-created fields whose
   * recipe-derived GUID is only an IR-internal refKey).
   */
  name?: string;
  /** Sitecore returns the raw stored value (string), regardless of field type. */
  value: string;
  /**
   * True when `value` is INHERITED from the template's `__Standard Values`
   * rather than set on the item itself (Authoring GraphQL
   * `ItemField.containsStandardValue`). Load-bearing for the `Scai Handle`
   * ownership marker: the marker is a SHARED field, so a recipe that stamps
   * it on a component template's `__Standard Values` makes every datasource
   * item built on that template inherit the component's handle. Ownership
   * must be read from an item's OWN marker, never an inherited one — an
   * inherited marker means "unmarked" for ownership purposes. Optional so
   * test mocks needn't populate it (absent ⇒ treated as own/not-inherited).
   */
  containsStandardValue?: boolean;
  /** Versioned fields carry these; shared fields do not. */
  language?: string;
  version?: number;
}

export interface RemoteItem {
  itemId: string;
  templateId: string;
  parentId: string;
  name: string;
  /** Sitecore content-tree path of the item, e.g. `/sitecore/templates/...`. */
  path: string;
  fields: RemoteFieldValue[];
}

/** Item lookup selector — Sitecore accepts either a path or a GUID id. */
export interface ItemSelector {
  path?: string;
  itemId?: string;
}

export interface CreateItemInput {
  /** Parent path (e.g. `/sitecore/templates/Project`) or parent item GUID. */
  parent: string;
  templateId: string;
  name: string;
  /** Defaults to "master" if unset. */
  database?: string;
  /** Default language for versioned fields; defaults to "en". */
  language?: string;
  fields: FieldValue[];
  /**
   * When true, the implementation does an authoritative
   * parent-children lookup BEFORE issuing the create mutation. If a
   * sibling with `name` already exists, returns its itemId without
   * mutating. Recipe push opts in because the planner reads existence
   * via the path index, which lags writes by seconds-to-minutes — so
   * a rapid second push can plan a create against a path the tenant
   * already has, and Sitecore's create mutation does not always
   * reject the duplicate. Off by default for explicit one-shot
   * createItem calls.
   */
  idempotencyCheck?: boolean;
  /**
   * When true, an adoption taken by the `idempotencyCheck` pre-check or
   * the already-exists fallback ALIGNS the adopted item's template:
   * if the existing same-named child's live template differs from
   * `templateId`, the implementation retemplates it (updateItem with a
   * `templateId`) and then seeds `fields`, instead of returning the
   * item untouched.
   *
   * The recipe planner sets this only for CreateOnly, non-folder-class
   * CreateItem ops whose expected template resolved to a LIVE itemId —
   * i.e. recipe-seeded content/page items with deterministic identity.
   * Without it, adopting a name-twin stranded by an earlier
   * partial/rolled-back install (whose template belongs to a different
   * site's GUID family, or dangles after its template was rolled back)
   * aborts the recipe on the first field write with the baffling
   * "Cannot find a field with the name <X>". Off by default so generic
   * one-shot createItem callers keep the historical adopt-as-is
   * behavior.
   */
  retemplateOnAdopt?: boolean;
}

export interface CreateItemResult {
  /** Sitecore-assigned itemId (UUID without curly braces). */
  itemId: string;
}

export interface UpdateItemInput {
  itemId: string;
  // NOTE: there is deliberately NO `templateId` here. The Authoring
  // GraphQL schema has no template-change surface at all — no
  // `UpdateItemInput.templateId` (fails variable coercion), no
  // changeTemplate mutation, and `__Template` is not a writable field
  // (both confirmed against live tenants, v0.34.1/v0.34.2). Template
  // convergence for adopted name-twins happens in `adoptExistingChild`
  // (adopt same-shape twins as-is; delete + recreate marker-verified
  // childless residue).
  /**
   * Language to write the fields in. The Authoring API applies every
   * `FieldValueInput` at this input-level language — per-field language is
   * not on the wire. Omit for the item's default language.
   */
  language?: string;
  /**
   * Numbered version to write the fields to. Omit for the latest version.
   * A `SetField` targeting a story-seed numbered version carries it here.
   */
  version?: number;
  fields: FieldValue[];
}

export interface MoveItemInput {
  /** Item to move, selected by itemId or content-tree path. */
  selector: ItemSelector;
  /**
   * Destination parent. The moved item lands as a child of this
   * parent, keeping its existing name. Selected by itemId or
   * content-tree path.
   */
  targetParent: ItemSelector;
}

export interface UploadMediaInput {
  /**
   * Media-library-relative path of the destination item — no
   * `/sitecore/media library/` prefix, no file extension on the leaf.
   * Sitecore's `InvalidItemNameChars` setting forbids `.`/`/` in item
   * names; the file extension is stored on the underlying blob, not
   * the item name. Example: `SiteTemplates/MyTemplate/thumbnail`.
   * Intermediate folders are auto-created by Sitecore as Media folder
   * items.
   */
  itemPath: string;
  /** Image bytes to upload — read locally or fetched at apply time. */
  bytes: Uint8Array | Buffer;
  /** Optional MIME type for the multipart POST. Defaults to `image/png`. */
  mimeType?: string;
  /** Optional file name surfaced in the multipart `file` part. */
  fileName?: string;
  /** Optional Alt text applied to the resulting media item. */
  alt?: string;
  /**
   * When true, overwrites an existing media item at the same path. The
   * recipe push always sets this true so re-running over an existing
   * media library item updates it (matches `CreateAndUpdate` policy
   * semantics for SetField writes).
   */
  overwriteExisting?: boolean;
}

export interface UploadMediaResult {
  /** Sitecore-assigned media item GUID (UUID without curly braces). */
  itemId: string;
  /** Absolute content-tree path the media item now lives at. */
  itemPath: string;
  /** Leaf name Sitecore stamped on the item (may differ from input). */
  name: string;
}

export interface AddItemVersionInput {
  /** Sitecore itemId of the target item. */
  itemId: string;
  /** Language whose version stack to extend (ISO code, e.g. `en`, `fr`). */
  language: string;
}

export interface AddItemVersionResult {
  /** The numbered version that now exists — the one just added. */
  version: number;
}

export interface GetItemOptions {
  /** Languages to fetch versioned fields for. Default: `["en"]`. */
  languages?: string[];
  /**
   * Single-language fetch. When set, the GraphQL `where` clause is
   * `{ itemId | path, language }` so the returned `RemoteItem.fields`
   * contains the versioned fields at THIS language's latest version
   * (and `version` is also set), plus the item's shared fields.
   *
   * `language` and `languages` are independent: `language` produces
   * one read; `languages` is the legacy list-based hint (unused by
   * the implementation today). Prefer `language` for per-language
   * snapshot capture in the prune-restore path.
   */
  language?: string;
  /**
   * Single-version fetch. Pairs with `language` to read the fields at a
   * specific numbered version (`where: { itemId|path, language, version }`).
   * Requires `language` to also be set — without a language the version
   * is ambiguous.
   *
   * Used by `planPruneChildren`'s snapshot pass to capture each
   * (language, version) tuple's fields, so the rollback restore path can
   * reconstruct the full version stack via `addItemVersion` +
   * `updateItem` per version.
   */
  version?: number;
}

export interface AuthoringApiClient {
  /**
   * Resolve an item by path or by Sitecore-assigned itemId. Returns
   * `null` when the item does not exist.
   */
  getItem(selector: ItemSelector, options?: GetItemOptions): Promise<RemoteItem | null>;
  /**
   * Resolve many items at once by path. Returns a Map keyed by the SAME
   * string the caller passed in (case-preserved) — value is the
   * `RemoteItem` if found, `null` if the item does not exist on the
   * tenant. Implementations should batch wire calls (e.g. via aliased
   * GraphQL fields) so an N-path request is one or a small number of
   * round trips, not N round trips. Used by the recipe executor's
   * workspace-wide prefetch to populate the path → item snapshot cache
   * before the per-op plan loop.
   */
  getItemsByPaths(paths: readonly string[]): Promise<Map<string, RemoteItem | null>>;
  /** List immediate children of `parent` (selectable by path or itemId). */
  getChildren(parent: ItemSelector, options?: GetItemOptions): Promise<RemoteItem[]>;
  /**
   * Create the item at `input.parent` / `input.name`. The Authoring API
   * assigns the itemId server-side and returns it.
   */
  createItem(input: CreateItemInput): Promise<CreateItemResult>;
  updateItem(input: UpdateItemInput): Promise<void>;
  /** The future `CreateUpdateAndDelete` policy will use this. */
  deleteItem(selector: ItemSelector): Promise<void>;
  /**
   * Move an item to a new parent. Preserves the item's `itemId`, name,
   * and all inbound references — the only thing that changes is the
   * content-tree position. The Authoring GraphQL `moveItem` mutation
   * is the canonical way to relocate items without breaking refs;
   * delete + recreate would assign a new `itemId` and break every
   * link pointing at the old one.
   *
   * Throws `INPUT_INVALID` when either selector resolves to nothing,
   * or `NETWORK` on a server-side refusal (parent doesn't accept the
   * source's template, name collision under the new parent, etc.).
   */
  moveItem(input: MoveItemInput): Promise<void>;
  /**
   * Add a numbered version to `input.itemId` in `input.language`. Sitecore
   * assigns the version number sequentially; the result carries the number
   * of the version just created. When the language has no versions yet,
   * this creates that language version as part of adding version 1.
   *
   * Backs the `AddItemVersion` IR op — story-seed content recipes that
   * author multiple numbered versions of an item.
   */
  addItemVersion(input: AddItemVersionInput): Promise<AddItemVersionResult>;
  /**
   * The numbered versions an item currently has in `language`, ascending —
   * empty when the item has no versions in that language or doesn't exist.
   * The `AddItemVersion` planner reads this to stay idempotent (skip when
   * the target version already exists).
   */
  getItemVersions(selector: ItemSelector, language: string): Promise<number[]>;
  /**
   * One-shot batched per-language read for a single item. Returns each
   * requested language's latest-version `RemoteItem` plus that
   * language's version stack via a single aliased GraphQL query —
   * collapses what would otherwise be L sequential `getItemVersions`
   * calls (plus L `getItem` calls for the latest fields) into one
   * round trip.
   *
   * Used by the prune-rollback snapshot pass: pass 1 calls this to
   * discover which versions exist per language and to capture the
   * latest version's fields in one go. Pass 2 (`getItemAtVersionsBatch`)
   * follows only when historic versions need filling in.
   *
   * Languages absent on the item (no versions in that language) are
   * returned with `item: null` and `versions: []`. The caller can skip
   * those without an extra wire call.
   */
  getItemPerLanguageBatch(
    selector: ItemSelector,
    languages: readonly string[]
  ): Promise<Array<{ language: string; versions: number[]; item: RemoteItem | null }>>;
  /**
   * One-shot batched per-(language, version) read for a single item.
   * One aliased GraphQL query returns the item's fields at each
   * requested (language, version) tuple — used by the prune-rollback
   * snapshot pass to capture historic version fields after pass 1
   * identifies which versions exist.
   *
   * Tuples that don't exist on the item return `null` in their slot;
   * order matches the input.
   */
  getItemAtVersionsBatch(
    selector: ItemSelector,
    requests: ReadonlyArray<{ language: string; version: number }>
  ): Promise<Array<RemoteItem | null>>;
  /**
   * Upload a binary asset to Sitecore's media library and return the
   * resulting item's GUID + content-tree path.
   *
   * Sitecore's Authoring GraphQL splits the upload across two round
   * trips: the `uploadMedia(input)` mutation returns a `presignedUploadUrl`
   * (a per-upload signed handle on the same XM Cloud host); the bytes
   * then POST as `multipart/form-data` (`file` field) to that URL with
   * the Bearer token attached. The POST returns
   * `{Id, Name, ItemPath}` — `Id` is the freshly-assigned media-item
   * GUID, which the caller stamps into `capturedItemIds` so a sibling
   * `SetField` op can resolve a `media-xml-ref` against it.
   *
   * `destinationPath` is media-library-relative (no `/sitecore/media library/`
   * prefix, no file extension on the leaf — Sitecore's `InvalidItemNameChars`
   * setting rejects `.`/`/`/etc. in item names; the file extension
   * lives on the underlying blob, not the item name). Example: pass
   * `SiteTemplates/MyTemplate/thumbnail`. Authoring stamps the leaf
   * item there and returns the absolute `ItemPath` Sitecore actually
   * created it at.
   *
   * Throws on a failed presign mutation, a failed POST (non-2xx), or
   * a missing `Id` in the response body.
   */
  uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult>;
  /**
   * Every language ISO code configured on the tenant (the connection
   * the GraphQL schema exposes as the root `languages { nodes { name } }`
   * query). Used by the prune-rollback snapshot pass as the upper bound
   * for which languages an item COULD have versions in — the planner
   * then probes each via `getItemPerLanguageBatch` and snapshots
   * whichever the item actually has.
   *
   * Item-level language discovery is intentionally NOT in the
   * interface: the XM Cloud Authoring schema doesn't expose
   * `Item.languages` (verified via recon against TestDemo, RegistryCM
   * 2026-06-01), so all auto-discovery has to start from the tenant
   * set. See `scripts/_recon-item-languages.ts` for the schema probe
   * results.
   *
   * Best-effort: returns `["en"]` when the call fails (schema doesn't
   * expose the field, the call errors, or the result is empty). The
   * implementation caches the result for the client's lifetime — the
   * tenant's language set changes rarely enough that a per-push read
   * is the right granularity.
   */
  getTenantLanguages(): Promise<string[]>;
}

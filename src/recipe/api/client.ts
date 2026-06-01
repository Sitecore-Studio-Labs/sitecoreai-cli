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
}

export interface CreateItemResult {
  /** Sitecore-assigned itemId (UUID without curly braces). */
  itemId: string;
}

export interface UpdateItemInput {
  itemId: string;
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
  /** Phase 4 policy `CreateUpdateAndDelete` will use this. */
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

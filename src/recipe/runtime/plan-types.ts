import type { Operation } from "../ir/operations";
import type { MediaFallback } from "../api/ref-encoding";
import type { CreateItemInput, RemoteFieldValue, RemoteItem, UpdateItemInput } from "../api/client";
import type { NewSiteInput, SitesApiClient } from "../api/sites-client";
import type { BaselineIndex } from "./baseline";

export interface FieldDiffEntry {
  fieldId: string;
  before: string | null;
  after: string;
  language?: string;
  version?: number;
  /**
   * Three-way merge classification for this field (only set when a
   * baseline is loaded — see `PlanOptions.baselineIndex`):
   *
   *   - "first-push" — no baseline entry; planner can't classify.
   *   - "recipe-change" — tenant matches baseline; recipe-wins is safe.
   *   - "cms-edit" — tenant differs from baseline, recipe matches baseline;
   *                  author edited via the Sitecore UI after the last push.
   *   - "conflict" — tenant differs from baseline AND recipe differs from
   *                  baseline; both sides moved.
   *
   * `undefined` when the planner ran without a baseline (legacy two-way
   * diff, current default until operators opt in).
   */
  classification?: "first-push" | "recipe-change" | "cms-edit" | "conflict";
}

/**
 * `"conflict"` is the new three-way-merge status: tenant disagrees with
 * recipe AND with baseline (both sides moved since last apply). The
 * `--conflict-policy` flag governs whether conflicts become `error`
 * (default), `update` (recipe-wins clobber), or `skip` (cms-wins preserve).
 */
type ActionStatus = "create" | "update" | "skip" | "error" | "prune" | "conflict";

/**
 * Recursive snapshot of a pruned item, captured at plan time so the
 * rollback module can recreate the subtree via `createItem` +
 * `addItemVersion` + `updateItem` if the surrounding push aborts.
 *
 * Tree shape: `children` is itself `PrunedItemSnapshot[]`, populated by
 * a depth-first walk of `getChildren` in `planPruneChildren`. Restoration
 * is depth-first as well — the parent's freshly-assigned itemId becomes
 * each child's parent on its inverse `createItem` call.
 *
 * Field shape splits shared from versioned:
 *  - `sharedFields` — fields with no `language` and no `version`; apply
 *    to every (language, version) of the item.
 *  - `versions` — one entry per (language, version) the item has at
 *    snapshot time, carrying that version's versioned-field values.
 *
 * Multi-language and multi-version are both captured: planPruneChildren
 * iterates each language in the operator-configured `snapshotLanguages`
 * list, enumerates that language's version stack via `getItemVersions`,
 * then per-version reads the item's fields via
 * `getItem(selector, { language, version })`. The cost scales as
 * O(N_pruned * L_languages * V_versions) getItem calls.
 *
 * Remaining lossy bound: **itemIds change on recreation.** Sitecore
 * assigns itemIds server-side on `createItem` and the Authoring API has
 * no input for preserving the original GUID. Inbound references to the
 * old GUID stay broken. Truly GUID-preserving rollback would need the
 * Content Serialization API, which scai does not adopt.
 */
export interface PrunedItemSnapshot {
  itemId: string;
  path: string;
  templateId: string;
  name: string;
  parentId: string;
  /**
   * Fields with no language/version — apply to every version of the
   * item. Captured once (deduped across the per-version reads).
   */
  sharedFields: RemoteFieldValue[];
  /**
   * Per-(language, version) versioned field snapshots. Ordered by
   * (language order from snapshotLanguages, then version ascending).
   * The first entry's language is used as the inverse `createItem`'s
   * `language` parameter.
   *
   * Versioned fields here include the field's own `language` and
   * `version` so the inverse path can write them via `updateItem`
   * scoped to the matching (language, version).
   */
  versions: Array<{
    language: string;
    version: number;
    fields: RemoteFieldValue[];
  }>;
  /**
   * Depth-first snapshot of this item's descendants. Empty when the
   * item is a leaf at snapshot time. The depth of the snapshot tree
   * matches the depth of the live subtree under the prune target.
   */
  children: PrunedItemSnapshot[];
}

export interface PlannedAction {
  index: number;
  operation: Operation;
  status: ActionStatus;
  reason?: string;
  /**
   * Machine-readable discriminator for `status: "skip"` on value-bearing
   * ops (SetField / SetBaseTemplates / SetStandardValues via
   * `planUpdateOp`). The baseline writer keys off this: only an
   * `"in-sync"` skip proves the tenant holds the desired value, so only
   * that skip may be baselined. `"unresolved"` (target item missing),
   * `"create-only"` (policy preserved a CMS edit), and `"cms-wins"`
   * (conflict resolved in the tenant's favor) all mean the tenant does
   * NOT hold the desired value — baselining those plants a snapshot the
   * tenant never had, which every later push misreads as an author edit.
   * Absent on non-skip actions and on skips from other op kinds.
   */
  skipKind?: "unresolved" | "in-sync" | "create-only" | "cms-wins";
  diff?: FieldDiffEntry[];
  /** Snapshot of the mutation the executor will/would dispatch. */
  mutation?:
    | { kind: "createItem"; input: CreateItemInput }
    | { kind: "updateItem"; input: UpdateItemInput }
    | {
        kind: "createSite";
        input: NewSiteInput;
        /**
         * RefKey of the site item — the executor stores the
         * server-assigned site itemId here in `capturedItemIds` so
         * subsequent SetField ops scoped to the site (dictionary
         * overrides etc.) can resolve.
         */
        siteRefKey: string;
        /**
         * Environment languages to ensure (idempotently add) BEFORE
         * createSite: the site's primary `language` plus any
         * `additionalLanguages`. createSite fails when its `language`
         * isn't already on the environment; adding them also makes them
         * available environment-wide (e.g. to the brand-kit Glossary's
         * org locales).
         */
        languages: string[];
      }
    | {
        /**
         * Existing-site language provisioning: the CreateSiteFromTemplate
         * target already exists but the environment is missing declared
         * languages. The executor runs the same idempotent ensure the
         * create path runs before `createSite` (registration + fallback
         * wiring); registration is additive and environment-wide.
         */
        kind: "ensureLanguages";
        /** Full declared list (primary + additionals) the ensure runs over. */
        languages: string[];
        /** The subset not present at plan time — for display/diagnostics. */
        missing: string[];
        /**
         * Site-level language provisioning: environment registration alone
         * doesn't surface a locale on the site — the site keeps its own
         * language list (`Site.languages`), and Pages only offers locales
         * on that list. When the existing site's list is missing declared
         * languages, the executor PATCHes the site's `supportedLanguages`
         * with the union — gated at apply time to codes actually
         * registered on the environment after the ensure.
         */
        site?: {
          siteId: string;
          siteName: string;
          /**
           * The site's CONFIGURED language list at plan time
           * (`Site.supportedLanguages` — the property the PATCH writes).
           * Display/diagnostics only: the executor re-reads the site
           * before PATCHing and merges into the fresh list.
           */
          currentLanguages: string[];
          /** Declared languages absent from the site's list at plan time. */
          missing: string[];
        };
      }
    | {
        kind: "addItemVersion";
        /** Sitecore itemId of the target item. */
        itemId: string;
        /** Language whose numbered-version stack to extend. */
        language: string;
        /** How many versions to add to reach the op's declared `version`. */
        addCount: number;
      }
    | {
        kind: "mediaUpload";
        /** Resolved media-library-relative path (no `/sitecore/media library/` prefix). */
        itemPath: string;
        /** Source bytes the executor will POST to Sitecore's presigned URL. */
        bytes: Uint8Array;
        /** MIME type for the multipart form. */
        mimeType: string;
        /**
         * File name surfaced in the multipart form `file` part. Its
         * extension is what Sitecore's MediaCreator uses to pick the
         * media item's template (Image / Jpeg / Movie / Pdf / … vs the
         * generic File) — the planner guarantees it carries one.
         */
        fileName?: string;
        /** Optional alt text applied to the resulting media item. */
        altText?: string;
        /**
         * RefKey of the MediaUpload op — the executor stamps the
         * server-assigned media item GUID under this key in
         * `capturedItemIds`, so subsequent SetField ops with a
         * `media-xml-ref` value resolve.
         */
        mediaRefKey: string;
      }
    | {
        kind: "pruneChildren";
        /**
         * Sitecore itemIds the apply phase would delete when `mode` is
         * `"delete"` and the operator passed `--allow-prune`. Always
         * populated (possibly empty in degenerate cases — those should
         * status `skip`, not surface here).
         */
        itemIds: string[];
        /**
         * `"warn"` — apply skips the actual delete and the prune list
         * surfaces in the log for rehearsal. `"delete"` — apply removes
         * the items (gated additionally by `--allow-prune` at the
         * executor layer; the IR-level mode and the CLI flag are
         * independent consent layers).
         */
        mode: "warn" | "delete";
      };
  /**
   * Per-child plan-display data for PruneChildren actions — the path and
   * template of each item the prune would (or did) remove. Used by the
   * `recipe plan` renderer so operators see exactly which items are at
   * risk before they pass `--allow-prune`.
   *
   * Also carries the full pre-delete snapshot used by the rollback
   * module to recreate items via `createItem` + `addItemVersion` +
   * `updateItem` if the surrounding push aborts. Each entry is a
   * recursive tree node (`children` is itself `PrunedItemSnapshot[]`)
   * so a pruned subtree restores depth-first — direct children of the
   * prune target, AND their descendants, are all snapshotted at plan
   * time. Each node captures the full (language, version) field grid
   * for every language in the push's `snapshotLanguages` config (each
   * language → all numbered versions → fields per version).
   *
   * The single remaining lossy bound is bounded by the Authoring API
   * surface scai uses:
   *  - **itemIds are fresh on recreation.** Sitecore assigns itemIds
   *    server-side on `createItem`; the API has no input for preserving
   *    the original GUID. Inbound references (multi-list values, layout
   *    `<r id />` GUIDs, link fields) that pointed at the old GUID stay
   *    broken after restoration. Truly GUID-preserving rollback would
   *    need the Content Serialization API (a separate REST surface
   *    scai does not adopt).
   */
  prunedItems?: PrunedItemSnapshot[];
  /**
   * Per-multi-list plan-display data for AppendToMultiList actions whose
   * `appendPolicy` is `"replace"`. Empty arrays when nothing changed.
   * `merge-unique` ops do not populate this — `diff` already captures
   * the before/after pipe-list.
   */
  replacedListValues?: { added: string[]; removed: string[] };
  /**
   * Pre-mutation remote state captured during plan-time read. `null` means
   * the target item did not exist at plan time. Used by rollback to
   * derive inverse mutations.
   */
  snapshot?: RemoteItem | null;
}

export interface PlanSummary {
  create: number;
  update: number;
  skip: number;
  error: number;
  /**
   * Count of PruneChildren actions that emitted a non-empty delete list.
   * Independent of mode — both `"warn"` (rehearsal) and `"delete"`
   * (executable) contribute, because both surface a prune list the
   * operator must reckon with before the next push.
   */
  prune: number;
  /**
   * Count of actions blocked by three-way merge conflict detection —
   * the recipe would clobber an author edit (and `--conflict-policy`
   * was the default `error`). Non-zero means apply is blocked for at
   * least one op in the recipe; the operator must reconcile or pick a
   * non-default policy. Always 0 when the planner ran without a
   * baseline.
   */
  conflict: number;
}

export interface Plan {
  schemaVersion: "1";
  recipeHandle: string;
  actions: PlannedAction[];
  summary: PlanSummary;
}

export type PlanEvent =
  | { kind: "op-start"; index: number; operation: Operation }
  | { kind: "op-result"; action: PlannedAction }
  | { kind: "op-error"; index: number; operation: Operation; error: string };

export interface PlanOptions {
  emit?: (event: PlanEvent) => void;
  /**
   * Per-run map from recipe-internal refKey (uuidv5) to Sitecore-assigned
   * itemId. The executor passes a shared map and updates it as creates
   * resolve. Plan mode passes a fresh map; refs that don't resolve
   * during plan-mode produce `skip` actions.
   */
  capturedItemIds?: Map<string, string>;
  /**
   * Sites API client — only consulted when an IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets that don't include
   * SiteRecipes don't need a sites client; passing undefined is fine
   * and yields an `error` action only if a site op is encountered.
   */
  sitesClient?: SitesApiClient;
  /**
   * Workspace-wide path → RemoteItem snapshot cache. When provided,
   * `buildAction` consults it before issuing `client.getItem({ path })`
   * for CreateItem ops. Cache hits skip the wire call entirely.
   */
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * Workspace-wide path → itemId cache (shared with the AuthoringApiClient).
   * Threaded so `buildAction` can populate it after a successful read,
   * and so the planner sees same path resolutions a sibling recipe
   * already made earlier in the push.
   */
  pathItemIdCache?: Map<string, string>;
  /**
   * Operator override for which languages prune-rollback snapshots
   * capture per-(language, version) fields in. The first entry is
   * treated as the "default language" used by the rollback path's
   * inverse `createItem`.
   *
   * When **unset (undefined)**, the planner auto-discovers the tenant's
   * configured language set via `client.getTenantLanguages` (queries
   * the GraphQL root `languages { nodes { name } }` connection). The
   * XM Cloud Authoring schema doesn't expose item-level `Item.languages`
   * — the planner enumerates tenant languages and probes each per item
   * via `getItemVersions` to filter out the ones the item isn't
   * authored in. Schema unsupported / network failure → safely falls
   * back to `["en"]` (the client's catch block).
   *
   * When **explicitly set** (even to a single-language array), skips
   * auto-discovery and uses exactly the provided list — gives
   * operators a way to bound snapshot cost on tenants where discovery
   * would return languages they don't care to back up.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Three-way merge baseline — the previous successful push's
   * per-field value hashes. When provided, `computeFieldDrift`
   * classifies each drift entry as `recipe-change`, `cms-edit`, or
   * `conflict` (see `FieldDiffEntry.classification`); ops whose desired
   * field write would clobber a `cms-edit` or `conflict` field route to
   * the new `"conflict"` status instead of `"update"`.
   *
   * Pass `undefined` (the default) or `indexBaseline(null)` for legacy
   * two-way-diff behaviour: every divergence is recipe-wins, no
   * conflict surface.
   */
  baselineIndex?: BaselineIndex;
  /**
   * How `"conflict"` actions resolve when downgraded to a concrete
   * mutation status:
   *
   *   - `"error"` (default) — keep status `"conflict"`. The executor
   *     refuses to apply; the operator must reconcile manually.
   *   - `"recipe-wins"` — downgrade to `"update"`, clobbering the
   *     author's edit. Matches the legacy two-way behaviour.
   *   - `"cms-wins"` — downgrade to `"skip"`, preserving the author's
   *     edit and dropping the recipe-side change for this push.
   *
   * The flag only matters when a baseline is loaded. Without one, every
   * drift surfaces as `"update"` regardless of policy.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
  /**
   * Hotlink fallbacks for failed external-URL media uploads — see
   * `BuildActionOptions.mediaFallbacks`.
   */
  mediaFallbacks?: Map<string, MediaFallback>;
}

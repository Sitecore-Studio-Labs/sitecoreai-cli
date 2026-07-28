import type { RemoteItem } from "../api/client";
import type { MediaFallback } from "../api/ref-encoding";
import type { SitesApiClient } from "../api/sites-client";
import type { Plan, PlanEvent, PlannedAction, PlanSummary } from "./plan";
import type { BaselineIndex } from "./baseline";
import type { RollbackError, RollbackEvent, RollbackResult } from "../rollback/rollback";
import type { RollbackLogger } from "../rollback/rollback-log";

export type ExecutionMode = "plan" | "apply";

export interface ExecutionFailedEvent {
  kind: "failed";
  failedAt: number;
  applied: number;
  rolledBack: number;
  rollbackErrors: RollbackError[];
  /** The planning or apply error that triggered the rollback. */
  error: string;
}

export type ExecutionEvent =
  | PlanEvent
  | RollbackEvent
  | { kind: "apply-start"; action: PlannedAction }
  | { kind: "apply-success"; action: PlannedAction }
  | { kind: "apply-error"; action: PlannedAction; error: string }
  /**
   * Emitted when an apply-time mutation targets a language version stack
   * for a language the environment hasn't registered, and the op is a
   * non-primary-language version write (dictionary translation or a
   * component `__Standard Values` locale-map default). Rather than abort
   * the whole push + roll back, the executor skips just that op — the
   * primary language and every registered locale still install — and
   * surfaces the skip here so operators can see what was left out and
   * why.
   */
  | { kind: "apply-skip"; action: PlannedAction; language: string; error: string }
  /**
   * Emitted on each Sites API job poll while waiting for an async op
   * (createSite, deleteSite). Lets operators and orchestrators see
   * progress on long-running jobs (cold tenants can take >30s) instead
   * of staring at a silent CLI.
   */
  | {
      kind: "site-job-poll";
      jobHandle: string;
      /** Normalized phase string read from `Job.state ?? Job.status`. */
      phase: string;
      /** Milliseconds elapsed since polling began. */
      elapsedMs: number;
    }
  | ExecutionFailedEvent;

export interface ExecutionResult {
  plan: Plan;
  summary: PlanSummary;
  /** True when push aborted before all ops were dispatched. */
  aborted: boolean;
  /** Present only when the apply phase aborted; tracks the rollback outcome. */
  rollback?: RollbackResult;
  /**
   * Per-recipe refKey → server-assigned itemId map at end of execution.
   * Populated by both plan and apply paths (plan-mode only resolves
   * what's already on the tenant). Carried out so the push task can
   * resolve `ref-recipe` field values to concrete GUIDs when writing
   * the three-way merge baseline post-apply.
   */
  capturedItemIds: ReadonlyMap<string, string>;
  /**
   * RefKeys of CreateItem ops whose apply ADOPTED an existing item
   * instead of creating one. Adopt-as-is does not write the create's
   * `fields`, so the push task must NOT baseline those field values —
   * the tenant never received them, and a baseline that claims it did
   * turns every later push into a phantom cms-edit conflict. Empty in
   * plan mode.
   */
  adoptedItemRefKeys: ReadonlySet<string>;
}

export interface ExecuteOptions {
  mode: ExecutionMode;
  emit?: (event: ExecutionEvent) => void;
  /**
   * Cooperative cancellation. When `signal.aborted` becomes true, the
   * executor stops *between* operations, runs the same rollback path
   * as a failed op, and returns an `ExecutionResult` with
   * `aborted: true` and a reason indicating client-initiated cancel.
   * In-flight requests are not interrupted — finishing the current op
   * keeps the rollback inventory accurate.
   */
  signal?: AbortSignal;
  /**
   * Cross-recipe ref pre-seed: `refKey → expectedPath` for items
   * produced by OTHER recipes in the same workspace. The executor
   * walks this map at start, calls `getItem({path})` for each entry,
   * and if found seeds `capturedItemIds` so the planner can resolve
   * `ref-recipe` / `ref-recipe-list` / `ref-source-fields` values
   * pointing at items the current recipe doesn't itself produce
   * (e.g. accordion-block's `insertOptions: ["accordion-item@1"]`).
   *
   * Entries whose path doesn't yet exist on the tenant are silently
   * skipped — those are first-push cross-recipe refs that need the
   * producer recipe to land first. Push a second time once producers
   * land, or order recipes topologically.
   */
  crossRecipeRefs?: ReadonlyMap<string, string>;
  /**
   * Sites API client — required when the IR contains
   * `CreateSiteFromTemplate` ops. Recipe sets without SiteRecipes can
   * pass undefined; site ops without a client produce an `error`
   * action at plan time and don't dispatch.
   */
  sitesClient?: SitesApiClient;
  /**
   * Workspace-wide path → itemId cache. When provided, the executor
   * threads it into the planner so `getItem({ path })` short-circuits
   * to a captured itemId when the path was already resolved (by an
   * earlier recipe's create, by `seedCrossRecipeRefs`, or by a
   * pre-execution prefetch). The same map is shared with the
   * `AuthoringApiClient`'s `pathItemIdCache` (see
   * `createAuthoringClient`) so `ensurePathExists` consults the same
   * resolutions and skips redundant tree walks.
   */
  pathItemIdCache?: Map<string, string>;
  /**
   * Workspace-wide path → RemoteItem snapshot cache. Pre-populated by
   * the workspace prefetch in `push.ts` (a single batched
   * `getItemsByPaths` call covering every CreateItem path across every
   * IR). The planner's per-op `getItem({ path })` reads consult this
   * cache first; on a hit, no wire call. `null` values mean "checked
   * and missing on the tenant" — also a cache hit, just one that
   * indicates a CreateItem is needed.
   */
  pathSnapshotCache?: Map<string, RemoteItem | null>;
  /**
   * On-disk rollback audit log. Threaded through to `rollback()` so each
   * compensating-op outcome is captured, and to `executeIr` so the
   * per-recipe summary line is written when a push aborts. Optional —
   * when absent, the executor still rolls back in-memory but writes
   * nothing to disk.
   */
  rollbackLog?: RollbackLogger;
  /**
   * Operator-level consent to delete items via `PruneChildren` ops with
   * `mode: "delete"`. Independent of the IR-level mode: the recipe
   * author flips mode on the op, and the operator flips this flag on
   * the push command. Both must align before the executor actually
   * deletes; either alone makes it a rehearsal.
   *
   * Default behavior (undefined / false): apply throws `POLICY_DENIED`
   * when it encounters a delete-mode PruneChildren — failing loudly
   * rather than silently degrading to warn. Operators set this flag via
   * the `--allow-prune` CLI option once they've reviewed the prune list
   * a previous `--what-if` run surfaced.
   */
  allowPrune?: boolean;
  /**
   * Operator override for prune-rollback snapshot languages. Forwarded
   * to the planner. When unset, the planner auto-discovers via
   * `client.getTenantLanguages` (XM Cloud Authoring's tenant-level
   * `languages { nodes { name } }` connection — `Item.languages` is
   * not in the schema). Falls back to `["en"]` if the query errors.
   * Set explicitly via `--snapshot-languages` to bound snapshot cost
   * on tenants where discovery would return languages you don't want
   * captured.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Three-way merge baseline + conflict policy. Forwarded to the
   * planner so per-field drift classifies against the last-applied
   * baseline; `conflictPolicy` governs how `cms-edit` / `conflict`
   * drifts resolve. Pass `undefined` for legacy two-way-diff (the
   * default until operators opt in to baseline loading).
   */
  baselineIndex?: BaselineIndex;
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
  /**
   * Apply-time op-error policy (strict vs tolerant recipe push).
   *
   * - `"abort"` (default): the first apply-time op error stops forward
   *   execution, rolls back everything this recipe applied, and returns
   *   `aborted: true`. A missing field or a dead media URL fails the whole
   *   recipe loudly — the strict default that forces content excellence.
   * - `"continue"`: an op error is recorded on the action (`status:
   *   "error"`) and surfaced via `apply-error`, but is NON-fatal — the
   *   executor skips just that op and keeps going, nothing rolls back, and
   *   the recipe finishes with `aborted: false`. Lets a push complete past
   *   external flakiness (media 5xx) or a known generated-content defect.
   *
   * Independent of cancellation and three-way-merge conflicts, which still
   * abort in both modes. Set by the push task from
   * `SITECOREAI_RECIPE_PUSH_MODE` (see `resolveRecipePushMode`).
   */
  onError?: "abort" | "continue";
  /**
   * Shared accumulator of item refKeys CREATED during this push run.
   * The executor adds every applied CreateItem's `op.id`; the planner
   * bypasses baseline classification for update-ops targeting these
   * (a brand-new item has no CMS edits to preserve — see
   * `BuildActionOptions.createdThisRun`). Callers pushing multiple IRs
   * (recipe push) pass ONE set across every `executeIr` call so
   * cross-IR update ops see creations from earlier IRs; defaults to a
   * per-call set for standalone use.
   */
  createdItemRefKeys?: Set<string>;
  /**
   * Apply-time concurrency for `updateItem` and `addItemVersion`
   * mutations. Default 1 — the historical strictly-sequential apply.
   * Values > 1 route those mutations through a flush pool that
   * (a) COALESCES field writes targeting the same (item, language,
   * version) cell into one `updateItem` call — a page's N per-field
   * SetFields become one POST — and (b) runs writes to DISTINCT
   * (item, language) version stacks concurrently, up to this limit;
   * localized content (dictionary translations, `__Standard Values`
   * locale maps) fans its per-locale version adds out in parallel
   * instead of one round-trip at a time. Ordering guarantees
   * preserved: writes to the same (item, language) stack stay in op
   * order, remaining mutation kinds (creates, media, prune, sites)
   * are full pool barriers, and each op's PLAN awaits just the
   * stacks it reads (`settleForPlan`) so drift diffs and version
   * reconciliation never race an in-flight write. On a pooled
   * failure the coalesced call is retried per-op sequentially to
   * isolate the failing op, which then follows the exact
   * sequential-error semantics (language-skip tolerance, else
   * rollback + abort).
   */
  applyConcurrency?: number;
  /**
   * Push-scoped itemId → RemoteItem snapshot cache (keys lowercased).
   * ItemId-selector plan reads (`SetField`/`AddItemVersion`/… targeting a
   * captured refKey) consult it before the wire — without it, every op on
   * an N-op item pays its own `getItem({ itemId })` round trip even
   * though all N reads return identical data (the selector carries no
   * language/version). Write-through keeps it truthful: `createItem`
   * seeds the same synthetic snapshot the path cache gets, and every
   * update-write MERGES its fields in copy-on-write (earlier actions'
   * `snapshot` references must stay frozen — rollback builds inverse ops
   * from them). Merging at enqueue time (not flush) gives plans
   * read-your-writes over in-flight pooled cells, which also dedupes
   * redundant re-writes of values an earlier op in the same push set.
   * Callers pushing multiple IRs pass ONE map so cross-IR ops reuse it.
   */
  idSnapshotCache?: Map<string, RemoteItem>;
  /**
   * Push-scoped itemId → (language → max version) stacks (keys
   * lowercased). `planAddItemVersion` reads through it: on first touch
   * of an item it fetches EVERY language the current IR adds to that
   * item in ONE `getItemPerLanguageBatch` call, instead of one
   * `getItemVersions` round trip per add op — a 9-locale dictionary
   * phrase's version reconciliation costs 1 read, not 9. Each
   * dispatched/enqueued version add bumps its stack to the op's target
   * version. Callers pushing multiple IRs pass ONE map.
   */
  versionStackCache?: Map<string, Map<string, number>>;
  /**
   * Hotlink fallbacks for failed external-URL media uploads. The
   * planner's `planMediaUpload` writes an entry when it can't source an
   * external URL's bytes (fetch error, non-OK status, timeout, guard
   * rejection); every subsequent `media-xml-ref` resolution reads it and
   * degrades the referencing field to the legacy `<image src="…" />`
   * form instead of throwing — so one dead image URL degrades one field
   * rather than aborting + rolling back the whole recipe. Callers
   * pushing multiple IRs pass ONE map so the push task can summarise
   * the degradations; standalone calls default to a per-call map.
   */
  mediaFallbacks?: Map<string, MediaFallback>;
}

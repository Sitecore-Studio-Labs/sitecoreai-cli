/**
 * The `RecipeKind` contract — the seam every declarative surface
 * (brand-kit, component, page, site, brief, campaign) implements so the
 * `sync` engine can pull, diff, and push it.
 *
 * `TRecipe` is the kind's clean, schema'd shape. The SAME type describes
 * desired state (a recipe file) and current state (`readCurrent`), so
 * `diff` always compares like with like.
 *
 * See docs/recipe-sync-architecture.md.
 */
import type { ZodType } from "zod";
import type { Logger } from "@/shared/logger";
import type { BaselineStorage, PullConflictPolicy, PushConflictPolicy } from "./baseline";
import type { RecipeChange, RecipePlan } from "./plan";

/** Identifies one instance of a recipe kind on a remote environment. */
export interface KindRef {
  /** The recipe kind, e.g. `brand-kit`. */
  kind: string;
  /**
   * Kind-specific identifier of the instance (a kit id, a site name,
   * a brief's marked display name…). Used by each kind's
   * `readCurrent` to locate the resource on the tenant.
   */
  id: string;
  /**
   * Optional URL-safe key used as the third path segment when reading
   * / writing baselines (e.g. `<config>/<env>/<baselineKey>`). Falls
   * back to `id` when absent.
   *
   * Decoupled from `id` because the lookup identifier and the baseline
   * key serve different audiences: `id` may contain display-name
   * punctuation (`&`, `?`, colons, spaces) that breaks URL paths, while
   * `baselineKey` is a stable kebab handle. The campaign + brief sync
   * commands set this from `recipe.handle` when present.
   */
  baselineKey?: string;
}

/** Ambient context handed to a kind's operations. */
export interface SyncContext {
  /** Environment profile the operation runs against. */
  environmentName: string;
  /** Base directory for resolving `sitecoreai.cli.json`. Defaults to cwd. */
  configPath?: string;
  /**
   * Optional progress sink. The CLI passes a `Logger`; surfaces like the
   * MCP server omit it (their progress goes through their own channel).
   */
  logger?: Logger;
  /** Cancellation — kinds making HTTP calls should forward this. */
  signal?: AbortSignal;
  /**
   * Skip every code path that triggers a Sitecore AI enrichment
   * pipeline run. Set by the operator via `--no-enrich` on a push
   * command (or by an orchestrator-driven flow that knows the kit is
   * already structured).
   *
   * Effect on the `brand-kit` kind:
   *  - the kitChange path becomes an error (the kit doesn't exist yet
   *    so PATCHes can't land) instead of seeding;
   *  - the self-heal-on-existing-bare-kit path is skipped;
   *  - the field-PATCH loop still runs, with operator-authored values
   *    landing on whatever sections happen to already exist.
   *
   * Other kinds may ignore this flag — it's a brand-kit-specific
   * trade-off today, but lives on the shared context so the engine
   * can route the same intent through any future kind that has
   * comparable side effects.
   */
  skipEnrichment?: boolean;
  /**
   * Operator consent to delete items via `PruneChildren` ops with
   * `mode: "delete"` — same shape as `--allow-prune` on `scai recipe
   * push`. Without it, the `recipe` kind's `apply` throws
   * `POLICY_DENIED` on any delete-mode prune in the compiled IR set.
   *
   * Only consumed by the `recipe` kind today; other kinds ignore.
   */
  allowPrune?: boolean;
  /**
   * Operator override for prune-rollback snapshot languages. Mirrors
   * the `--snapshot-languages` shape on `scai recipe push`. Forwarded
   * to `executeIr` so the snapshot pass captures the operator-named
   * languages instead of auto-discovering. Undefined → auto-discover
   * via the Authoring API's tenant `languages` query.
   *
   * Only consumed by the `recipe` kind today; other kinds ignore.
   */
  snapshotLanguages?: readonly string[];
  /**
   * Pluggable per-kind baseline backing store. When present, kinds that
   * opt into three-way merge classification call
   * `baselineStorage.load(kind, env, handle)` during `plan()` and
   * `baselineStorage.write(...)` from `apply()` after a successful
   * write. Forwarded through by the engine when callers set it on
   * `PushOptions` / `PullOptions`. Kinds without baseline support
   * ignore.
   *
   * The content-recipe runtime carries its own file-backed storage
   * separately (see `src/recipe/runtime/baseline.ts`) — this seam is
   * for new kinds (brief, campaign, …) and remote (orchestrator-
   * backed) impls that share one store across many kinds.
   */
  baselineStorage?: BaselineStorage;
  /**
   * Conflict policy in effect for a `push` (set by the engine from
   * `PushOptions.conflictPolicy`). Kinds that classify per-field
   * consult this to downgrade `conflict` / `cms-edit` actions to the
   * chosen resolution. Default behaviour when unset is the kind's
   * choice — content recipes default to `"error"`; brief / campaign
   * kinds default to `"cms-wins"`.
   */
  pushConflictPolicy?: PushConflictPolicy;
  /** Conflict policy in effect for a `pull` (set by the engine). */
  pullConflictPolicy?: PullConflictPolicy;
}

/** Outcome of applying a plan. */
export interface ApplyResult {
  /** Changes that were written to the remote. */
  applied: RecipeChange[];
  /** Changes deliberately not written (e.g. filtered deletes). */
  skipped: RecipeChange[];
}

/** One declarative surface the `sync` engine can operate on. */
export interface RecipeKind<TRecipe> {
  /** Stable kind name. Used by the registry, CLI, and MCP. */
  readonly name: string;
  /**
   * Validates a recipe. Also feeds the CLI (file validation) and the MCP
   * tool input schema — the schema is the single source of truth.
   */
  readonly schema: ZodType<TRecipe>;
  /**
   * Capture live remote state as a recipe. Resolves `null` when the
   * instance does not exist yet (a `push` would then create it).
   */
  readCurrent(ref: KindRef, ctx: SyncContext): Promise<TRecipe | null>;
  /**
   * Compute the plan to converge `ref` onto `desired`.
   *
   * May do I/O. Simple kinds implement this as `readCurrent` followed by
   * a pure diff; the recipe (Sitecore-item) kind reads remote state
   * per-operation while planning, so `plan` cannot be a pure function.
   */
  plan(desired: TRecipe, ref: KindRef, ctx: SyncContext): Promise<RecipePlan>;
  /**
   * Apply a plan to the remote. Must be idempotent: re-running after a
   * successful apply produces an all-`noop` plan. The engine has already
   * gated on write consent before calling this.
   */
  apply(plan: RecipePlan, ref: KindRef, ctx: SyncContext): Promise<ApplyResult>;
  /**
   * Enumerate every instance of this kind on the remote, as `KindRef`s.
   *
   * Optional. Kinds backed by a remote collection (brand kits, brief
   * types) implement it so the cross-domain `scai sync` aggregate can
   * pull them all. File-authored kinds (the Sitecore-item recipe) have
   * nothing to enumerate and omit it — the aggregate skips them.
   */
  list?(ctx: SyncContext): Promise<KindRef[]>;
}

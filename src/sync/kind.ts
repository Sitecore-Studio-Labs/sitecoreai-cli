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
import type { RecipeChange, RecipePlan } from "./plan";

/** Identifies one instance of a recipe kind on a remote environment. */
export interface KindRef {
  /** The recipe kind, e.g. `brand-kit`. */
  kind: string;
  /** Kind-specific identifier of the instance (a kit id, a site name…). */
  id: string;
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
}

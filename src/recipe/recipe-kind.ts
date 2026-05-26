/**
 * The `recipe` recipe kind — adapts the existing Sitecore-item recipe
 * compiler onto the kind-agnostic `sync` engine.
 *
 * Unlike the simple kinds (brand-kit, brief-type, campaign), the
 * Sitecore-item kind cannot diff with a pure helper: its planner reads
 * remote state per-operation, because later ops resolve cross-references
 * from earlier ops' server-assigned itemIds. `plan` therefore drives the
 * real compile → executeIr(plan) flow and stashes the compiled
 * `OperationIr[]` in `RecipePlan.payload` so `apply` can re-run them in
 * apply mode without recompiling.
 *
 * `TRecipe` is `Recipe[]` — the recipe SET. The compiler is set-oriented
 * (cross-recipe references and the aggregate `TemplatesMapping` IR need
 * the whole set), so a single recipe file isn't a meaningful unit here.
 *
 * `readCurrent` (live items → recipe) delegates to `read-current.ts` — the
 * reverse-projection that walks the items a compiler would have produced and
 * reconstructs four recipe kinds (component-section, component-template,
 * content-template, enumeration). That projection is lossy by design; see
 * its module JSDoc for the per-kind fidelity notes.
 *
 * See docs/recipe-sync-architecture.md.
 */
import { z } from "zod";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import type {
  ApplyResult,
  KindRef,
  RecipeChange,
  RecipeKind,
  RecipePlan,
  SyncContext,
} from "@/sync";
import { createAuthoringClient } from "./api/authoring-client";
import type { AuthoringApiClient } from "./api/client";
import { compileRecipeSet, type CompileContext } from "./compile";
import { executeIr, type ExecutionResult } from "./runtime/execute";
import type { OperationIr } from "./ir/operations";
import { injectHandleMarker } from "./items/marker";
import type { PlannedAction } from "./runtime/plan";
import { readCurrentRecipes, type ReadCurrentRoots } from "./items/read-current";
import { type Recipe, RecipeSchema } from "./schema/recipe";

/**
 * Shape of `RecipePlan.payload` for the `recipe` kind: the compiled IRs
 * `plan` produced, carried forward so `apply` re-executes them in apply
 * mode rather than recompiling the recipe set.
 */
interface RecipeKindPayload {
  irs: OperationIr[];
}

/**
 * Resolve the environment, the compile-time content-tree roots, and an
 * `AuthoringApiClient` from a `SyncContext`. Bridges the engine's
 * `SyncContext` ({@link SyncContext.environmentName} / `configPath`) onto
 * `resolveEnvironment` the same way `runRecipePush` resolves a tenant.
 */
const resolveContext = (
  ctx: SyncContext
): {
  client: AuthoringApiClient;
  context: CompileContext;
  envName: string;
} => {
  const { envName, environment, timeoutMs } = resolveEnvironment({
    config: ctx.configPath,
    environmentName: ctx.environmentName,
  });
  const client = createAuthoringClient({ environment, request: { timeoutMs } });
  // The compiler's roots come straight off the env profile — the same
  // fields `runRecipePush` reads (it additionally honors per-invocation
  // CLI flag overrides, which the sync engine does not expose). Per-recipe
  // compile fns throw `INPUT_INVALID` with their own clear hints when a
  // recipe in the set needs a root the profile leaves unset.
  const context: CompileContext = {
    templatesRoot: environment.templatesRoot ?? "",
    renderingsRoot: environment.renderingsRoot ?? "",
    componentsRoot: environment.componentsRoot,
    contentModelsRoot: environment.contentModelsRoot,
    partialDesignsRoot: environment.partialDesignsRoot,
    pageDesignsRoot: environment.pageDesignsRoot,
    contentItemsRoot: environment.contentItemsRoot,
    headlessVariantsRoot: environment.headlessVariantsRoot,
    availableRenderingsRoot: environment.availableRenderingsRoot,
    enumerationsRoot: environment.enumerationsRoot,
    pageTemplatesRoot: environment.pageTemplatesRoot,
    placeholderSettingsRoot: environment.placeholderSettingsRoot,
    pagesRoot: environment.pagesRoot,
  };
  return { client, context, envName };
};

/**
 * Map one `PlannedAction` (the recipe executor's per-op outcome) onto a
 * `RecipeChange` (the sync engine's element-level change):
 *
 *   create → create   update → update   skip → noop
 *   error  → noop, but never silently dropped: the `summary` is
 *            `ERROR`-prefixed and the reason is carried in `meta.error`
 *            so callers can surface the failure.
 */
const actionToChange = (recipeHandle: string, action: PlannedAction): RecipeChange => {
  const path = `${recipeHandle}.op[${action.index}]`;
  const label = action.operation.label;
  if (action.status === "error") {
    return {
      kind: "noop",
      path,
      summary: `ERROR ${label}: ${action.reason ?? "unknown error"}`,
      meta: {
        operation: action.operation.op,
        error: action.reason ?? "unknown error",
      },
    };
  }
  const kind = action.status === "skip" ? "noop" : action.status;
  return {
    kind,
    path,
    summary: `${label}${action.reason ? ` — ${action.reason}` : ""}`,
    ...(action.diff && action.diff.length > 0 && { meta: { diff: action.diff } }),
  };
};

/** Flatten an `ExecutionResult[]` into the sync engine's `RecipeChange[]`. */
const resultsToChanges = (
  irs: readonly OperationIr[],
  results: readonly ExecutionResult[]
): RecipeChange[] => {
  const changes: RecipeChange[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const handle = irs[i]?.recipeHandle ?? results[i].plan.recipeHandle;
    for (const action of results[i].plan.actions) {
      changes.push(actionToChange(handle, action));
    }
  }
  return changes;
};

/**
 * Compute the plan to converge a tenant onto a recipe set.
 *
 * Compiles the set to `OperationIr[]`, runs each IR through the executor
 * in `plan` mode (no writes), maps every `PlannedAction` to a
 * `RecipeChange`, and stashes the compiled IRs in `RecipePlan.payload`
 * so `apply` can re-execute them without recompiling.
 */
const plan = async (desired: Recipe[], _ref: KindRef, ctx: SyncContext): Promise<RecipePlan> => {
  const { client, context } = resolveContext(ctx);
  // Stamp every CreateItem op with the `Scai Handle` identity marker
  // before planning, so the IRs carried into `apply` (via payload) write
  // the marker too — recipe identity travels with the compiled set.
  const irs = compileRecipeSet(desired, context).map(injectHandleMarker);
  const results: ExecutionResult[] = [];
  for (const ir of irs) {
    results.push(await executeIr(ir, client, { mode: "plan", signal: ctx.signal }));
  }
  const payload: RecipeKindPayload = { irs };
  return { changes: resultsToChanges(irs, results), payload };
};

/**
 * Apply a plan: re-execute the IRs stashed by `plan` in `apply` mode.
 *
 * `applied` carries every change the executor wrote (`create` / `update`);
 * `skipped` carries the rest (`noop`, including `ERROR`-prefixed entries
 * — an error means nothing was written for that op). The engine has
 * already gated on write consent before calling this.
 */
const apply = async (
  recipePlan: RecipePlan,
  _ref: KindRef,
  ctx: SyncContext
): Promise<ApplyResult> => {
  const payload = recipePlan.payload as RecipeKindPayload | undefined;
  if (!payload || !Array.isArray(payload.irs)) {
    throw createScaiError(
      "recipe apply was called with a plan that carries no compiled IRs.",
      "INPUT_INVALID",
      {
        hint: "Run the recipe kind's `plan` first — `apply` reuses the IRs it stashes in RecipePlan.payload.",
      }
    );
  }
  const { client } = resolveContext(ctx);
  const results: ExecutionResult[] = [];
  for (const ir of payload.irs) {
    results.push(await executeIr(ir, client, { mode: "apply", signal: ctx.signal }));
  }
  const changes = resultsToChanges(payload.irs, results);
  return {
    applied: changes.filter((change) => change.kind === "create" || change.kind === "update"),
    skipped: changes.filter((change) => change.kind === "noop"),
  };
};

/**
 * Capture live Sitecore items as a recipe set — the inverse of the
 * compile → push direction.
 *
 * Resolves the same env/roots/`AuthoringApiClient` bridge `plan` uses, then
 * delegates to `readCurrentRecipes`, which walks every reverse-projectable
 * subtree under the configured roots (`componentsRoot`, `contentModelsRoot`,
 * `templatesRoot` fallback, `enumerationsRoot`, `partialDesignsRoot`,
 * `pageDesignsRoot`, `pagesRoot`, `placeholderSettingsRoot`) and
 * reconstructs nine recipe kinds: component-section, component-template,
 * content-template, page-template, enumeration, partial-design,
 * page-design, page, and placeholder.
 *
 * Returns `null` only when the environment has no recipe roots configured at
 * all; otherwise returns the recipe array, which may be empty (roots set but
 * trees empty). The projection is lossy — see `read-current.ts` for the
 * per-kind fidelity notes.
 *
 * `ref.id` is ignored for v1: `readCurrent` pulls every reverse-projectable
 * item under the roots. Scoping the pull to one item by name is a future
 * refinement — the engine passes the whole-set ref today.
 */
const readCurrent = async (_ref: KindRef, ctx: SyncContext): Promise<Recipe[] | null> => {
  const { client, context } = resolveContext(ctx);
  const roots: ReadCurrentRoots = {
    templatesRoot: context.templatesRoot,
    renderingsRoot: context.renderingsRoot,
    ...(context.componentsRoot !== undefined && { componentsRoot: context.componentsRoot }),
    ...(context.contentModelsRoot !== undefined && {
      contentModelsRoot: context.contentModelsRoot,
    }),
    ...(context.pageTemplatesRoot !== undefined && {
      pageTemplatesRoot: context.pageTemplatesRoot,
    }),
    ...(context.enumerationsRoot !== undefined && {
      enumerationsRoot: context.enumerationsRoot,
    }),
    ...(context.partialDesignsRoot !== undefined && {
      partialDesignsRoot: context.partialDesignsRoot,
    }),
    ...(context.pageDesignsRoot !== undefined && {
      pageDesignsRoot: context.pageDesignsRoot,
    }),
    ...(context.pagesRoot !== undefined && { pagesRoot: context.pagesRoot }),
    ...(context.placeholderSettingsRoot !== undefined && {
      placeholderSettingsRoot: context.placeholderSettingsRoot,
    }),
  };
  return readCurrentRecipes(roots, client);
};

/** The `recipe` (Sitecore-item) recipe kind. */
export const recipeKind: RecipeKind<Recipe[]> = {
  name: "recipe",
  schema: z.array(RecipeSchema),
  readCurrent,
  plan,
  apply,
};

import path from "node:path";
import fastGlob from "fast-glob";
import { Logger } from "@/shared/logger";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/policy/environment";
import { createAuthoringClient } from "../api/authoring-client";
import type { AuthoringApiClient } from "../api/client";

/**
 * Shared option shapes for the three `scai provision recipe` tasks.
 *
 * All three honor the standard verbosity options (`--quiet`, `--json`,
 * `--log-file`). Plan and push additionally need an environment to talk
 * to a tenant; compile is pure-logic and doesn't.
 */

export interface RecipeCommonOptions {
  config?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export interface RecipeCompileOptions extends RecipeCommonOptions {
  /** Single recipe file path. Defaults to the config `recipes` glob. */
  input?: string;
  output?: string;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile (Phase 2 layout). */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile (Phase 2 layout). */
  contentModelsRoot?: string;
  /** Override `partialDesignsRoot` from the env profile (Phase 4). */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile (Phase 4). */
  pageDesignsRoot?: string;
  /** Override `contentItemsRoot` from the env profile (Phase 4). */
  contentItemsRoot?: string;
  /** Override `headlessVariantsRoot` from the env profile. */
  headlessVariantsRoot?: string;
  /** Override `availableRenderingsRoot` from the env profile. */
  availableRenderingsRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  /**
   * Active env profile to source `templatesRoot` / `renderingsRoot`
   * defaults from when the flags are not passed. Required for compile
   * since compile is otherwise environment-agnostic.
   */
  environmentName?: string;
}

export interface RecipeTenantOptions extends RecipeCommonOptions {
  environmentName?: string;
}

export interface RecipePlanOptions extends RecipeTenantOptions {
  /** Single IR file path. Defaults to the config `recipes` glob (compiled in-memory). */
  input?: string;
  output?: string;
}

export interface RecipePushOptions extends RecipeTenantOptions {
  /** Single recipe file path. Defaults to the config `recipes` glob. */
  input?: string;
  /** Override `templatesRoot` from the env profile. */
  templatesRoot?: string;
  /** Override `renderingsRoot` from the env profile. */
  renderingsRoot?: string;
  /** Override `componentsRoot` from the env profile (Phase 2 layout). */
  componentsRoot?: string;
  /** Override `contentModelsRoot` from the env profile (Phase 2 layout). */
  contentModelsRoot?: string;
  /** Override `partialDesignsRoot` from the env profile (Phase 4). */
  partialDesignsRoot?: string;
  /** Override `pageDesignsRoot` from the env profile (Phase 4). */
  pageDesignsRoot?: string;
  /** Override `contentItemsRoot` from the env profile (Phase 4). */
  contentItemsRoot?: string;
  /** Override `headlessVariantsRoot` from the env profile. */
  headlessVariantsRoot?: string;
  /** Override `availableRenderingsRoot` from the env profile. */
  availableRenderingsRoot?: string;
  /** Override `enumerationsRoot` from the env profile. */
  enumerationsRoot?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * When true, skip recipes whose compiled IR digest + env-profile roots
   * digest both match the persisted `.scai/recipe-cache.json` entry from
   * the previous successful push. Speedups re-pushes of an unchanged
   * recipe set on warm tenants. Off by default — out-of-band CMS edits
   * to recipe-owned items aren't auto-redetected until either the recipe
   * source changes or the cache is invalidated.
   */
  skipUnchangedRecipes?: boolean;
  /**
   * Plan-mode parallelism across recipes. Plan reads are pure (no
   * mutations, no shared mutable refs across recipes), so plan-mode
   * IRs can run concurrently. Defaults to 4. Apply-mode always runs
   * sequentially — within a push, mutations land in topological order.
   */
  planConcurrency?: number;
  /**
   * Optional progress callback. Receives per-recipe execution events
   * as they happen (op-start / op-result / apply-start / apply-success
   * / apply-error / site-job-poll / rollback events). Used by external
   * orchestrators (e.g. `scai mcp serve`) to forward live progress to
   * a client. The CLI logger does not need this — it observes the same
   * events via its own internal collator.
   */
  emit?: (event: { recipe: string; event: import("../runtime/execute").ExecutionEvent }) => void;
  /**
   * Cooperative cancellation. When the signal fires, the executor
   * stops between operations, rolls back applied mutations, and the
   * per-recipe `ExecutionResult.aborted` is set to true.
   */
  signal?: AbortSignal;
}

export const toLogger = (options: RecipeCommonOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export interface ResolvedTenant {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  client: AuthoringApiClient;
}

export const resolveTenant = (
  options: RecipeTenantOptions,
  clientOptions?: { pathItemIdCache?: Map<string, string> }
): ResolvedTenant => {
  const { envName, environment, root, timeoutMs } = resolveEnvironment(options);
  // Carry the org-scoped automation client's non-secret `clientId` from
  // the root config so the auth layer can pair it with the org-client
  // secret in the keychain (the tier-3 fallback for org-level profiles).
  const orgClientId = environment.organizationId
    ? root.orgClients[environment.organizationId]?.clientId
    : undefined;
  const client = createAuthoringClient({
    environment: { ...environment, orgClientId },
    request: { timeoutMs },
    ...(clientOptions?.pathItemIdCache && { pathItemIdCache: clientOptions.pathItemIdCache }),
  });
  return { envName, environment, root, client };
};

/**
 * Recipe kinds whose compilers create items under hardcoded
 * `/sitecore/system/*` roots and never read `templatesRoot` /
 * `renderingsRoot`:
 *   - `workflow`              → `/sitecore/system/Workflows`
 *   - `webhook-authorization` → `/sitecore/system/Settings/Webhooks/Authorizations`
 *
 * A recipe set built only from these kinds can compile, plan, and push
 * with neither root configured — see `recipeSetNeedsRoots`.
 */
const ROOTLESS_RECIPE_KINDS: ReadonlySet<string> = new Set(["workflow", "webhook-authorization"]);

/**
 * Whether a recipe set needs `templatesRoot` / `renderingsRoot` resolved.
 *
 * True when at least one recipe creates template / rendering items —
 * every kind except `ROOTLESS_RECIPE_KINDS`. An empty set (e.g. a push
 * fed only pre-compiled `.ir.json` inputs, which carry their roots baked
 * in) needs neither. New recipe kinds default to *needing* roots; add a
 * kind to `ROOTLESS_RECIPE_KINDS` only once its compiler is confirmed to
 * ignore both roots.
 */
export const recipeSetNeedsRoots = (recipes: readonly { kind: string }[]): boolean =>
  recipes.some((recipe) => !ROOTLESS_RECIPE_KINDS.has(recipe.kind));

/**
 * Resolve the recipe parent paths that the compiler will use for top-level
 * template + rendering items.
 *
 * Lookup order:
 *   1. `--templates-root` / `--renderings-root` CLI flags
 *   2. `envProfiles[<name>].templatesRoot` / `.renderingsRoot` from
 *      sitecoreai.cli.json (env-overrides via
 *      `SITECOREAI_ENV_<NAME>_TEMPLATES_ROOT` / `_RENDERINGS_ROOT` apply
 *      at config-load time before this helper runs)
 *   3. When `required`, throws `INPUT_INVALID` with a hint pointing at
 *      the envProfile shape. When not required (a workflow- /
 *      webhook-authorization-only set, or an IR-only push), missing
 *      roots resolve to `""` — the compilers in play never read them.
 *
 * Pass `required` from `recipeSetNeedsRoots(recipes)` once the set's
 * recipe kinds are known.
 *
 * Tenant-specific because each site has its own
 * `/sitecore/templates/Project/<site>/Components` location. Putting roots
 * in config keeps the orchestrator's `recipe push` invocation
 * config-driven (no plan-schema fields, no extra arg plumbing).
 */
export const resolveRecipeRoots = (
  options: { templatesRoot?: string; renderingsRoot?: string },
  environment: EnvironmentConfiguration | undefined,
  envName: string,
  required = true
): { templatesRoot: string; renderingsRoot: string } => {
  const templatesRoot = options.templatesRoot ?? environment?.templatesRoot;
  const renderingsRoot = options.renderingsRoot ?? environment?.renderingsRoot;
  if (!required) {
    // The recipe set in play never reads these roots — pass through
    // whatever's configured, or "" so the requirement doesn't block a
    // set that doesn't need it.
    return { templatesRoot: templatesRoot ?? "", renderingsRoot: renderingsRoot ?? "" };
  }
  if (!templatesRoot || !renderingsRoot) {
    const missing =
      !templatesRoot && !renderingsRoot
        ? "both roots"
        : !templatesRoot
          ? "templatesRoot"
          : "renderingsRoot";
    throw createScaiError(
      `Recipe parent path missing: ${missing} not configured for environment '${envName}'.`,
      "INPUT_INVALID",
      {
        hint: `Add 'templatesRoot' and 'renderingsRoot' to envProfiles.${envName} in sitecoreai.cli.json (or pass --templates-root / --renderings-root).`,
      }
    );
  }
  return { templatesRoot, renderingsRoot };
};

export interface RecipeInputResolution {
  files: string[];
  source: "input-flag" | "config-glob";
}

/**
 * Resolve the recipe files a task should operate on. Precedence:
 *   1. `--input <file>` if provided (single file).
 *   2. `recipes` globs from sitecoreai.cli.json (zero, one, or many files).
 *
 * Returns absolute paths. Throws `INPUT_INVALID` when neither path resolves
 * to any files — telling the user how to fix it.
 */
export const resolveRecipeInputs = async (
  options: { input?: string; config?: string },
  root: RootConfiguration
): Promise<RecipeInputResolution> => {
  if (options.input) {
    return { files: [path.resolve(options.input)], source: "input-flag" };
  }
  const configDir = path.dirname(root.physicalPath);
  // followSymbolicLinks: false defends against an attacker-planted symlink
  // in recipes/ pointing at /etc/, ~/.aws/, or any other sensitive TS file
  // — those files would otherwise be executed by tsx when the recipe gets
  // loaded (.recipe.ts is code, not data).
  const matched = await fastGlob(root.recipes, {
    cwd: configDir,
    absolute: true,
    followSymbolicLinks: false,
  });
  // Defense in depth: reject any resolved path that escapes the config
  // directory (e.g. via `..` segments in the glob input).
  const escaped = matched.filter((p) => path.relative(configDir, p).startsWith(".."));
  if (escaped.length > 0) {
    throw createScaiError(
      `Recipe glob resolved to ${escaped.length} path(s) outside the config directory: ${escaped.slice(0, 3).join(", ")}${escaped.length > 3 ? `, +${escaped.length - 3} more` : ""}.`,
      "INPUT_INVALID",
      {
        hint: "Recipe paths must live under the directory containing sitecoreai.cli.json.",
      }
    );
  }
  if (matched.length === 0) {
    throw createScaiError(
      `No recipe files matched the config glob: ${root.recipes.join(", ")}.`,
      "INPUT_INVALID",
      {
        hint: "Pass --input <recipe-file>, or update the `recipes` glob in sitecoreai.cli.json.",
      }
    );
  }
  return { files: matched.sort(), source: "config-glob" };
};

// Re-exported from the shared gate so `recipe push` goes through the
// same workspace-policy enforcement (ceiling, caller context, the
// `recipe-push` destructive tier) as every other write path. The
// recipe-local copy that used to live here predated the policy layer.
export { ensureAllowWrite } from "@/policy/allow-write";

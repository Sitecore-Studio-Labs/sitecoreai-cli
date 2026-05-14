import path from "node:path";
import fastGlob from "fast-glob";
import { Logger } from "@/shared/logger";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { createAuthoringClient } from "../api/authoring-client";
import type { AuthoringApiClient } from "../api/client";

/**
 * Shared option shapes for the three `scai recipe` tasks.
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
  emit?: (event: { recipe: string; event: import("../execute").ExecutionEvent }) => void;
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
  const client = createAuthoringClient({
    environment,
    request: { timeoutMs },
    ...(clientOptions?.pathItemIdCache && { pathItemIdCache: clientOptions.pathItemIdCache }),
  });
  return { envName, environment, root, client };
};

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
 *   3. Throws `INPUT_INVALID` with a hint pointing at the envProfile shape
 *
 * Tenant-specific because each site has its own
 * `/sitecore/templates/Project/<site>/Components` location. Putting roots
 * in config keeps the orchestrator's `recipe push` invocation
 * config-driven (no plan-schema fields, no extra arg plumbing).
 */
export const resolveRecipeRoots = (
  options: { templatesRoot?: string; renderingsRoot?: string },
  environment: EnvironmentConfiguration | undefined,
  envName: string
): { templatesRoot: string; renderingsRoot: string } => {
  const templatesRoot = options.templatesRoot ?? environment?.templatesRoot;
  const renderingsRoot = options.renderingsRoot ?? environment?.renderingsRoot;
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

export const ensureAllowWrite = (
  root: RootConfiguration,
  envName: string,
  override?: boolean
): void => {
  const environment = root.environments[envName];
  if (override || environment?.allowWrite) {
    return;
  }
  const envKey = envName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  throw createScaiError(
    `Environment ${envName} is not configured to allow writing data.`,
    "INPUT_INVALID",
    {
      hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
    }
  );
};

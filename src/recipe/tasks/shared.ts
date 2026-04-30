import path from "node:path";
import fastGlob from "fast-glob";
import { Logger } from "@/shared/logger";
import {
  readRootConfiguration,
  readRootConfigurationFile,
  type EnvironmentConfiguration,
  type RootConfiguration,
} from "@/config";
import { createCliError } from "@/shared/errors";
import { resolveApiTimeoutMs } from "@/serialization/tasks/shared";
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
  whatIf?: boolean;
  allowWrite?: boolean;
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

export const resolveTenant = (options: RecipeTenantOptions): ResolvedTenant => {
  const configPath = options.config ?? process.cwd();
  const rootFile = readRootConfigurationFile(configPath);
  const envName = options.environmentName ?? rootFile.config.defaultEnvProfile;
  if (!envName) {
    throw createCliError("Environment name is required.", "INPUT_INVALID", {
      hint: "Pass --environment-name or set defaultEnvProfile in the config.",
    });
  }
  const root = readRootConfiguration(configPath, envName);
  const environment = root.environments[envName];
  if (!environment) {
    throw createCliError(`Environment '${envName}' is not configured.`, "ENV_NOT_FOUND", {
      hint: "Run 'scai init' to configure the environment.",
    });
  }
  const client = createAuthoringClient({
    environment,
    request: { timeoutMs: resolveApiTimeoutMs(root) },
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
    throw createCliError(
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
  const matched = await fastGlob(root.recipes, { cwd: configDir, absolute: true });
  if (matched.length === 0) {
    throw createCliError(
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
  throw createCliError(
    `Environment ${envName} is not configured to allow writing data.`,
    "INPUT_INVALID",
    {
      hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
    }
  );
};

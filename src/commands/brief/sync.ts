/**
 * `scai ops brief sync` — pull, diff, and push a brief type OR a brief
 * instance as a declarative recipe. See docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live brief type or brief as a recipe file
 *   diff  show the plan to converge a brief type or brief onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 *
 * Both verbs default to `--kind brief-type` for back-compat with the
 * pre-instance surface — the same flag distinguishes `briefTypeKind`
 * (the schema template) from `briefInstanceKind` (a populated brief).
 */
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { briefInstanceKind, briefTypeKind } from "@/brief/recipe";
import { readRootConfiguration } from "@/config/root-config";
import { inputError, toLogger } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";
import {
  loadRecipe,
  planIsNoop,
  resolveHttpBaselineStorageFromEnv,
  summarizePlan,
  syncDiff,
  syncPull,
  syncPush,
  writeRecipe,
  type RecipeKind,
  type RecipePlan,
  type SyncContext,
  type SyncMode,
} from "@/sync";

/** Recipe-kind discriminator — accepts both the kind names verbatim. */
type BriefSyncKind = "brief-type" | "brief";
const BRIEF_SYNC_KINDS: ReadonlyArray<BriefSyncKind> = ["brief-type", "brief"];

interface SyncOptions extends CommonOptions {
  environmentName?: string;
  config?: string;
  kind?: BriefSyncKind;
  name?: string;
  file?: string;
  allowWrite?: boolean;
  prune?: boolean;
  /**
   * Three-way merge conflict policy. Honored by `briefTypeKind` /
   * `briefInstanceKind` when a baseline is loaded (via
   * `ctx.baselineStorage`). Without a baseline the kinds degrade to
   * two-way diff and this flag has no effect.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
}

/** Slugify a recipe name for a default filename. */
const slug = (value: string, fallback: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;

/** Per-kind metadata — wires the discriminator to the right kind + filename suffix. */
const kindFor = (
  kind: BriefSyncKind | undefined
): { recipeKind: RecipeKind<unknown>; suffix: string; humanName: string } => {
  const resolved = kind ?? "brief-type";
  if (resolved === "brief") {
    return {
      recipeKind: briefInstanceKind as RecipeKind<unknown>,
      suffix: "brief.yaml",
      humanName: "brief",
    };
  }
  return {
    recipeKind: briefTypeKind as RecipeKind<unknown>,
    suffix: "brieftype.yaml",
    humanName: "brief type",
  };
};

/**
 * A loaded recipe minimally carries `name` — and optionally a stable
 * `handle` used as the baseline key when present. Display `name` can
 * include URL-unsafe characters (`&`, `?`, etc.); handles are URL-safe
 * by convention so they ride cleanly inside the baseline path.
 */
type NamedRecipe = { name: string; handle?: string } & Record<string, unknown>;

/**
 * Build the KindRef for a loaded recipe.
 *
 * `id` stays the display name so each kind's `readCurrent` can locate
 * the resource on the tenant the way it always has (the brief lookup
 * extracts an identity marker from the name; the brief-type lookup
 * matches the codename verbatim).
 *
 * `baselineKey` carries the URL-safe handle. The remote
 * `HttpBaselineStorage` rides this as the path segment instead of
 * the display name, which sidesteps the orchestrator's `/api/v1/
 * sync-baselines/...` regex on URL-unsafe characters like `&`.
 */
const refFor = (
  kindName: string,
  recipe: NamedRecipe,
): { kind: string; id: string; baselineKey?: string } => ({
  kind: kindName,
  id: recipe.name,
  ...(recipe.handle ? { baselineKey: recipe.handle } : {}),
});

/**
 * Build the `SyncContext` for a brief sync command invocation.
 * Picks up an `HttpBaselineStorage` from env when the orchestrator
 * spawned scai with the baseline endpoint configured. Plain CLI
 * invocations leave `baselineStorage` unset.
 */
const buildContext = (options: SyncOptions, logger: Logger): SyncContext => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  const baselineStorage = resolveHttpBaselineStorageFromEnv();
  return {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
    ...(baselineStorage ? { baselineStorage } : {}),
    ...(options.conflictPolicy ? { pushConflictPolicy: options.conflictPolicy } : {}),
  };
};

const PLAN_MARK: Record<string, string> = { create: "+", update: "~", delete: "-", noop: "=" };

/** Render a plan to the logger — one line per change, then a tally. */
const printPlan = (logger: Logger, plan: RecipePlan): void => {
  if (plan.changes.length === 0) {
    logger.info("Plan: no changes.");
    return;
  }
  for (const change of plan.changes) {
    logger.info(`  ${PLAN_MARK[change.kind] ?? "?"} ${change.summary}`);
  }
  const tally = summarizePlan(plan);
  logger.info(
    `Plan: ${tally.create} create, ${tally.update} update, ${tally.delete} delete, ${tally.noop} unchanged.`
  );
};

/** `--kind` is shared across all three verbs. */
const addKindOption = (command: Command): Command =>
  command.addOption(
    new Option(
      "--kind <kind>",
      "Recipe kind to operate on. Defaults to brief-type for back-compat."
    )
      .choices(BRIEF_SYNC_KINDS as unknown as string[])
      .default("brief-type")
  );

const createPullCommand = (): Command => {
  const command = new Command("pull")
    .description("Capture a live brief type or brief instance as a recipe file.")
    .requiredOption(
      "--name <name>",
      "Identifier of the recipe. Brief-type codename (`Creative`) or brief display name (`Q3 Launch`)."
    )
    .addOption(new Option("--file <path>", "Output recipe file (default: <name>.<kind>.yaml)"));
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const { recipeKind, suffix, humanName } = kindFor(options.kind);
    const name = options.name ?? "";
    const recipe = await syncPull(recipeKind, { kind: recipeKind.name, id: name }, ctx);
    if (!recipe) {
      throw inputError(
        `${humanName.charAt(0).toUpperCase()}${humanName.slice(1)} "${name}" not found.`,
        recipeKind === (briefTypeKind as RecipeKind<unknown>)
          ? "List brief types with `scai ops brief types list`."
          : "List briefs with `scai ops brief list`."
      );
    }
    const file = options.file ?? `${slug(name, humanName.replace(/\s+/g, "-"))}.${suffix}`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${name}" -> ${file}`, "green");
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff")
    .description("Show the plan to converge a brief type or brief onto a recipe file.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)");
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const { recipeKind } = kindFor(options.kind);
    const recipe = (await loadRecipe(options.file ?? "", recipeKind.schema)) as NamedRecipe;
    const plan = await syncDiff(
      recipeKind,
      recipe,
      refFor(recipeKind.name, recipe),
      ctx
    );
    printPlan(logger, plan);
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a brief type or brief onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"))
    .addOption(new Option("--prune", "Include delete changes (off by default)"))
    .addOption(
      new Option(
        "--conflict-policy <policy>",
        "Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them. Requires a baseline (HTTP storage via env or file-backed); without one, the kinds degrade to two-way diff and this flag has no effect."
      ).choices(["error", "recipe-wins", "cms-wins"])
    );
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const { recipeKind } = kindFor(options.kind);
    const recipe = (await loadRecipe(options.file ?? "", recipeKind.schema)) as NamedRecipe;
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const outcome = await syncPush(
      recipeKind,
      recipe,
      refFor(recipeKind.name, recipe),
      ctx,
      { mode, prune: options.prune }
    );
    printPlan(logger, outcome.plan);
    if (outcome.result) {
      logger.info(
        `Applied ${outcome.result.applied.length} change(s); ${outcome.result.skipped.length} skipped.`,
        "green"
      );
    } else if (planIsNoop(outcome.plan)) {
      logger.info("Already converged — nothing to do.", "green");
    } else {
      logger.info("Dry-run. Re-run with --allow-write to apply.");
    }
  });
  return command;
};

/** `scai ops brief sync` — the recipe pull / diff / push verbs. */
export const createBriefSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push a brief type or brief instance as a declarative recipe."
  );
  command.addCommand(createPullCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPushCommand());
  return command;
};

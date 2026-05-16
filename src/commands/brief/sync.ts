/**
 * `scai ops brief sync` — pull, diff, and push a brief type as a
 * declarative recipe. The recipe / sync model — see
 * docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live brief type into a recipe file
 *   diff  show the plan to converge a brief type onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { briefTypeKind } from "@/brief/recipe";
import { readRootConfiguration } from "@/config/root-config";
import { inputError, toLogger } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";
import {
  loadRecipe,
  planIsNoop,
  summarizePlan,
  syncDiff,
  syncPull,
  syncPush,
  writeRecipe,
  type RecipePlan,
  type SyncContext,
  type SyncMode,
} from "@/sync";

interface SyncOptions extends CommonOptions {
  environmentName?: string;
  config?: string;
  name?: string;
  file?: string;
  allowWrite?: boolean;
  prune?: boolean;
}

/** Slugify a brief-type name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "brief-type";

/** Build the `SyncContext` for a brief sync command invocation. */
const buildContext = (options: SyncOptions, logger: Logger): SyncContext => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  return {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
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

const createPullCommand = (): Command => {
  const command = new Command("pull")
    .description("Capture a live brief type as a recipe file.")
    .requiredOption("--name <name>", "Brief type codename")
    .addOption(new Option("--file <path>", "Output recipe file (default: <name>.brieftype.yaml)"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const name = options.name ?? "";
    const recipe = await syncPull(briefTypeKind, { kind: briefTypeKind.name, id: name }, ctx);
    if (!recipe) {
      throw inputError(
        `Brief type "${name}" not found.`,
        "List brief types with `scai ops brief types list`."
      );
    }
    const file = options.file ?? `${slug(name)}.brieftype.yaml`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${name}" -> ${file}`, "green");
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff")
    .description("Show the plan to converge a brief type onto a recipe file.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = loadRecipe(options.file ?? "", briefTypeKind.schema);
    const plan = await syncDiff(
      briefTypeKind,
      recipe,
      { kind: briefTypeKind.name, id: recipe.name },
      ctx
    );
    printPlan(logger, plan);
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a brief type onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"))
    .addOption(new Option("--prune", "Include delete changes (off by default)"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = loadRecipe(options.file ?? "", briefTypeKind.schema);
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const outcome = await syncPush(
      briefTypeKind,
      recipe,
      { kind: briefTypeKind.name, id: recipe.name },
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

/** `scai ops brief sync` — the recipe pull / diff / push verbs for brief types. */
export const createBriefSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push a brief type as a declarative recipe."
  );
  command.addCommand(createPullCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPushCommand());
  return command;
};

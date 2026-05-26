/**
 * `scai agents sync` — pull, diff, and push Agentic Studio resources as
 * declarative recipes. `--kind` selects the resource (agent | skill |
 * widget | custom-mcp); the recipe / sync model is shared with the other
 * areas — see docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live resource into a recipe file
 *   diff  show the plan to converge a resource onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { Command, Option } from "commander";
import { agentRecipeKindByName } from "@/agents/recipe";
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
  type RecipeKind,
  type RecipePlan,
  type SyncContext,
  type SyncMode,
} from "@/sync";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

interface SyncOptions extends CommonOptions {
  environmentName?: string;
  config?: string;
  kind?: string;
  name?: string;
  file?: string;
  allowWrite?: boolean;
}

const KIND_NAMES = ["agent", "skill", "widget", "custom-mcp", "schema", "html-template"];

/** Resolve the `--kind` option to a recipe kind, or fail with a hint. */
const resolveKind = (kindName: string | undefined): RecipeKind<unknown> => {
  if (!kindName || !(kindName in agentRecipeKindByName)) {
    throw inputError(
      `--kind must be one of: ${KIND_NAMES.join(", ")}.`,
      "Pass e.g. `--kind agent`."
    );
  }
  return agentRecipeKindByName[kindName as keyof typeof agentRecipeKindByName];
};

/** Slugify a name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "recipe";

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

const recipeName = (recipe: unknown): string => String((recipe as { name?: unknown }).name ?? "");

const addKindOption = (command: Command): void => {
  command.addOption(new Option("--kind <kind>", `Recipe kind: ${KIND_NAMES.join(" | ")}`));
};

const createPullCommand = (): Command => {
  const command = new Command("pull")
    .description("Capture a live Agentic Studio resource as a recipe file.")
    .requiredOption("--name <name>", "Resource display name")
    .addOption(new Option("--file <path>", "Output recipe file (default: <name>.<kind>.yaml)"));
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const kind = resolveKind(options.kind);
    const ctx = buildContext(options, logger);
    const name = options.name ?? "";
    const recipe = await syncPull(kind, { kind: kind.name, id: name }, ctx);
    if (!recipe) {
      throw inputError(
        `No ${kind.name} named "${name}".`,
        "Check the name with `scai agents list`."
      );
    }
    const file = options.file ?? `${slug(name)}.${kind.name}.yaml`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${name}" -> ${file}`, "green");
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff")
    .description("Show the plan to converge a resource onto a recipe file.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)");
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const kind = resolveKind(options.kind);
    const ctx = buildContext(options, logger);
    const recipe = await loadRecipe(options.file ?? "", kind.schema);
    const plan = await syncDiff(kind, recipe, { kind: kind.name, id: recipeName(recipe) }, ctx);
    printPlan(logger, plan);
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a resource onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"));
  addKindOption(command);
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const kind = resolveKind(options.kind);
    const ctx = buildContext(options, logger);
    const recipe = await loadRecipe(options.file ?? "", kind.schema);
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const outcome = await syncPush(kind, recipe, { kind: kind.name, id: recipeName(recipe) }, ctx, {
      mode,
    });
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

/** `scai agents sync` — recipe pull / diff / push for Agentic Studio resources. */
export const createAgentsSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push Agentic Studio resources as declarative recipes."
  );
  command.addCommand(createPullCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPushCommand());
  return command;
};

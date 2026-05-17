/**
 * `scai ops campaign sync` — pull, diff, and push a campaign as a
 * declarative recipe. The recipe / sync model — see
 * docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live campaign into a recipe file
 *   diff  show the plan to converge a campaign onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { campaignKind } from "@/campaigns/recipe";
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
  campaign?: string;
  file?: string;
  allowWrite?: boolean;
  prune?: boolean;
}

/** Slugify a campaign name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "campaign";

/** Build the `SyncContext` for a campaign sync command invocation. */
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
    .description("Capture a live campaign as a recipe file.")
    .requiredOption("--campaign <name>", "Campaign display name")
    .addOption(
      new Option("--file <path>", "Output recipe file (default: <campaign>.campaign.yaml)")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const campaignName = options.campaign ?? "";
    const recipe = await syncPull(campaignKind, { kind: campaignKind.name, id: campaignName }, ctx);
    if (!recipe) {
      throw inputError(
        `Campaign "${campaignName}" not found.`,
        "List campaigns with `scai ops campaign list`."
      );
    }
    const file = options.file ?? `${slug(campaignName)}.campaign.yaml`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${campaignName}" -> ${file}`, "green");
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff")
    .description("Show the plan to converge a campaign onto a recipe file.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = loadRecipe(options.file ?? "", campaignKind.schema);
    const plan = await syncDiff(
      campaignKind,
      recipe,
      { kind: campaignKind.name, id: recipe.name },
      ctx
    );
    printPlan(logger, plan);
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a campaign onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"))
    .addOption(new Option("--prune", "Include delete changes (off by default)"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = loadRecipe(options.file ?? "", campaignKind.schema);
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const outcome = await syncPush(
      campaignKind,
      recipe,
      { kind: campaignKind.name, id: recipe.name },
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

/** `scai ops campaign sync` — recipe pull / diff / push verbs for campaigns. */
export const createCampaignSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push a campaign as a declarative recipe."
  );
  command.addCommand(createPullCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPushCommand());
  return command;
};

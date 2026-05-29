/**
 * `scai brand sync` — pull, diff, and push a brand kit as a declarative
 * recipe. The recipe / sync model — see docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live brand kit into a recipe file
 *   diff  show the plan to converge a kit onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { brandKitKind } from "@/brand/recipe";
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
  kit?: string;
  file?: string;
  allowWrite?: boolean;
  prune?: boolean;
  /**
   * Commander negation pattern: declaring `--no-enrich` exposes the
   * value under the positive key `enrich` (default `true`, set to
   * `false` when `--no-enrich` is passed). Reading `options.noEnrich`
   * would always be undefined — keep this typed as `enrich`.
   */
  enrich?: boolean;
}

/** Slugify a kit name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "kit";

/** Build the `SyncContext` for a brand sync command invocation. */
const buildContext = (options: SyncOptions, logger: Logger): SyncContext => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  return {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
    ...(options.enrich === false ? { skipEnrichment: true } : {}),
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

/** Whether a plan would trigger the paid AI ingestion/enrichment pipelines. */
const hasPaidPipeline = (plan: RecipePlan): boolean =>
  plan.changes.some((change) => change.meta?.stage === "document");

const createPullCommand = (): Command => {
  const command = new Command("pull")
    .description("Capture a live brand kit as a recipe file.")
    .requiredOption("--kit <name>", "Brand kit display name")
    .addOption(new Option("--file <path>", "Output recipe file (default: <kit>.brandkit.yaml)"));
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const kitName = options.kit ?? "";
    const recipe = await syncPull(brandKitKind, { kind: brandKitKind.name, id: kitName }, ctx);
    if (!recipe) {
      throw inputError(
        `Brand kit "${kitName}" not found.`,
        "List kits with `scai brand kits list`."
      );
    }
    const file = options.file ?? `${slug(kitName)}.brandkit.yaml`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${kitName}" -> ${file}`, "green");
  });
  return command;
};

const createDiffCommand = (): Command => {
  const command = new Command("diff")
    .description("Show the plan to converge a brand kit onto a recipe file.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)");
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = await loadRecipe(options.file ?? "", brandKitKind.schema);
    const plan = await syncDiff(
      brandKitKind,
      recipe,
      { kind: brandKitKind.name, id: recipe.name },
      ctx
    );
    printPlan(logger, plan);
    if (hasPaidPipeline(plan)) {
      logger.warn("On push this recipe triggers paid AI pipeline runs (~5-15 min).");
    }
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a brand kit onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"))
    .addOption(new Option("--prune", "Include delete changes (off by default)"))
    .addOption(
      new Option(
        "--no-enrich",
        "Skip every code path that triggers a Sitecore AI enrichment pipeline run. Field PATCHes only — kit must already exist with the right section structure. Useful for fast iteration on field values without waiting 5-15 min for an enrichment cycle."
      )
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = await loadRecipe(options.file ?? "", brandKitKind.schema);
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const outcome = await syncPush(
      brandKitKind,
      recipe,
      { kind: brandKitKind.name, id: recipe.name },
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
      if (hasPaidPipeline(outcome.plan)) {
        logger.warn("Push triggers paid AI pipeline runs (~5-15 min).");
      }
      logger.info("Dry-run. Re-run with --allow-write to apply.");
    }
  });
  return command;
};

/** `scai brand sync` — the recipe pull / diff / push verbs for brand kits. */
export const createBrandSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push a brand kit as a declarative recipe."
  );
  command.addCommand(createPullCommand());
  command.addCommand(createDiffCommand());
  command.addCommand(createPushCommand());
  return command;
};

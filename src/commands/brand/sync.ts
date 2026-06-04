/**
 * `scai brand sync` — pull, diff, and push a brand kit as a declarative
 * recipe. The recipe / sync model — see docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live brand kit into a recipe file
 *   diff  show the plan to converge a kit onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { writeFile } from "node:fs/promises";

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
  resolveHttpBaselineStorageFromEnv,
  syncDiff,
  syncPull,
  syncPush,
  writeRecipe,
  type RecipePlan,
  type ResolvedIdentity,
  type SyncContext,
  type SyncMode,
} from "@/sync";

const writeIdentitiesOut = async (
  path: string,
  identities: ReadonlyArray<ResolvedIdentity>,
): Promise<void> => {
  const body = JSON.stringify({ identities }, null, 2);
  await writeFile(path, body, "utf8");
};

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
  /**
   * Three-way merge conflict policy. Honored by `brandKitKind` when a
   * baseline is loaded (via `ctx.baselineStorage`). Without a baseline
   * the brand kind degrades to two-way diff and this flag has no
   * effect. Default `"error"` matches the safety-first stance:
   * conflicts surface for resolution rather than silently clobbering.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
  /** Optional path; when set, the push outcome's resolved Sitecore
   *  brand-kit UUID is written there as JSON. Consumed by the
   *  orchestrator so the brand_kits row holds a real UUID instead
   *  of the recipe handle. */
  identitiesOut?: string;
}

/** Slugify a kit name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "kit";

/**
 * Build the `SyncContext` for a brand sync command invocation. When
 * the orchestrator spawned scai and set `SYNC_BASELINE_ENDPOINT_URL`
 * + `SYNC_BASELINE_AUTH_TOKEN`, the context gains an
 * `HttpBaselineStorage` instance so three-way merge persists into
 * the orchestrator DB instead of the operator filesystem. Plain CLI
 * invocations (no env vars) leave `baselineStorage` unset — the
 * brand kind degrades to two-way diff or its file-backed fallback
 * accordingly.
 */
/**
 * Map the CLI flag value into the SyncContext slot the brand kind
 * reads. `undefined` (flag not passed) leaves the kind on its
 * built-in `"error"` default — the kind treats absent + "error" the
 * same way so omitting the flag yields safe behavior.
 */
const buildContext = (options: SyncOptions, logger: Logger): SyncContext => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  const baselineStorage = resolveHttpBaselineStorageFromEnv();
  return {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
    ...(options.enrich === false ? { skipEnrichment: true } : {}),
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
    )
    .addOption(
      new Option(
        "--conflict-policy <policy>",
        "Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them and drops the recipe-side change for this push. Requires a baseline (HTTP storage via env or file-backed); without one, the brand kind degrades to two-way diff and this flag has no effect."
      ).choices(["error", "recipe-wins", "cms-wins"])
    )
    .addOption(
      new Option(
        "--identities-out <path>",
        "Write the apply outcome's resolved Sitecore brand-kit UUID to a JSON file at this path. The orchestrator reads it back to stamp the real UUID onto its brand_kits row — without this the row stores the recipe handle as a placeholder and downstream campaign pushes can't populate `brandkit_id`."
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
    if (options.identitiesOut && outcome.result?.identities) {
      await writeIdentitiesOut(options.identitiesOut, outcome.result.identities);
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

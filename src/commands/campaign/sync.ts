/**
 * `scai ops campaign sync` — pull, diff, and push a campaign as a
 * declarative recipe. The recipe / sync model — see
 * docs/recipe-sync-architecture.md.
 *
 *   pull  capture a live campaign into a recipe file
 *   diff  show the plan to converge a campaign onto a recipe
 *   push  apply that plan (dry-run unless --allow-write)
 */
import { writeFile } from "node:fs/promises";

import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { emitPullResultJson, emitPushResultJson } from "../sync-json";
import { campaignKind } from "@/campaigns/recipe";
import { readRootConfiguration } from "@/config/root-config";
import { inputError, toLogger } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";
import type { ResolvedIdentity } from "@/sync";

const writeIdentitiesOut = async (
  path: string,
  identities: ReadonlyArray<ResolvedIdentity>
): Promise<void> => {
  const body = JSON.stringify({ identities }, null, 2);
  await writeFile(path, body, "utf8");
};
import {
  loadRecipe,
  planIsNoop,
  resolveHttpBaselineStorageFromEnv,
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
  /**
   * Sitecore Orchestrate project UUID. When set on `pull`, the read
   * path skips findProjectByName and loads the project by id directly
   * — survives any display-name drift between the recipe side and the
   * tenant. The orchestrator passes this once a first push stamps a
   * UUID onto the registry's recipe.
   */
  sitecoreId?: string;
  /** Stable campaign handle — matches the project by its `handle:` label
   *  on pull so a renamed campaign still resolves (see `--handle`). */
  handle?: string;
  file?: string;
  allowWrite?: boolean;
  prune?: boolean;
  /** Optional path; when set, the push outcome's resolved Sitecore
   *  UUIDs (project / deliverables / tasks) are written there as JSON.
   *  Consumed by the orchestrator. */
  identitiesOut?: string;
  /**
   * Three-way merge conflict policy. Honored by `campaignKind` when a
   * baseline is loaded (via `ctx.baselineStorage`). Without a baseline
   * the kind degrades to two-way diff and this flag has no effect.
   * Mirrors `brief sync push`'s flag.
   */
  conflictPolicy?: "error" | "recipe-wins" | "cms-wins";
}

/** Slugify a campaign name for a default recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "campaign";

/**
 * Build the `SyncContext` for a campaign sync command invocation.
 * Picks up an `HttpBaselineStorage` from env when the orchestrator
 * spawned scai with the baseline endpoint configured.
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

const createPullCommand = (): Command => {
  const command = new Command("pull")
    .description("Capture a live campaign as a recipe file.")
    .requiredOption("--campaign <name>", "Campaign display name")
    .addOption(
      new Option(
        "--sitecore-id <uuid>",
        "Sitecore Orchestrate project UUID. When set, the read path loads the project by id and skips the display-name search — survives renames on either side. Pass the UUID stamped by a prior push (`--identities-out` writes it; the orchestrator persists it onto the recipe row)."
      )
    )
    .addOption(
      new Option(
        "--handle <handle>",
        "Stable campaign handle. When set, the read path matches the project by its `handle:` label so a renamed campaign still resolves even before a `sitecoreId` has been stamped. Falls back to display-name match when omitted."
      )
    )
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
    const ref = {
      kind: campaignKind.name,
      id: campaignName,
      ...(options.handle ? { baselineKey: options.handle } : {}),
      ...(options.sitecoreId ? { tenantId: options.sitecoreId } : {}),
    };
    const recipe = await syncPull(campaignKind, ref, ctx);
    if (!recipe) {
      // Under --json, "not found" is a structured found:false result the
      // orchestrator reads off the envelope — never a regex on a thrown
      // message. Humans still get a clear error.
      if (logger.isJson()) {
        emitPullResultJson({
          logger,
          command: "campaign.sync.pull",
          environment: ctx.environmentName,
          kind: campaignKind.name,
          ref,
          found: false,
        });
        return;
      }
      throw inputError(
        `Campaign "${campaignName}"${options.sitecoreId ? ` (sitecoreId=${options.sitecoreId})` : ""} not found.`,
        "List campaigns with `scai ops campaign list`."
      );
    }
    const file = options.file ?? `${slug(campaignName)}.campaign.yaml`;
    writeRecipe(file, recipe);
    logger.info(`Pulled "${campaignName}" -> ${file}`, "green");
    emitPullResultJson({
      logger,
      command: "campaign.sync.pull",
      environment: ctx.environmentName,
      kind: campaignKind.name,
      ref,
      found: true,
    });
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
    const recipe = await loadRecipe(options.file ?? "", campaignKind.schema);
    const ref = {
      kind: campaignKind.name,
      id: recipe.name,
      ...(recipe.handle ? { baselineKey: recipe.handle } : {}),
      ...(recipe.sitecoreId ? { tenantId: recipe.sitecoreId } : {}),
    };
    const plan = await syncDiff(campaignKind, recipe, ref, ctx);
    printPlan(logger, plan);
    emitPushResultJson({
      logger,
      command: "campaign.sync.diff",
      environment: ctx.environmentName,
      operation: "diff",
      kind: campaignKind.name,
      ref,
      mode: "what-if",
      outcome: { plan, result: null },
    });
  });
  return command;
};

const createPushCommand = (): Command => {
  const command = new Command("push")
    .description("Converge a campaign onto a recipe file. Dry-run unless --allow-write.")
    .requiredOption("--file <path>", "Recipe file (.yaml / .json)")
    .addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)"))
    .addOption(new Option("--prune", "Include delete changes (off by default)"))
    .addOption(
      new Option(
        "--conflict-policy <policy>",
        "Three-way merge resolution when tenant-side edits diverge from baseline. `error` (default) refuses the push and surfaces the cells; `recipe-wins` clobbers tenant edits; `cms-wins` preserves them. Requires a baseline (HTTP storage via env or file-backed); without one, the kind degrades to two-way diff and this flag has no effect. Mirrors `scai ops brief sync push --conflict-policy`."
      ).choices(["error", "recipe-wins", "cms-wins"])
    )
    .addOption(
      new Option(
        "--identities-out <path>",
        "Write the apply outcome's resolved Sitecore UUIDs (project, deliverables, tasks) to a JSON file at this path. The orchestrator reads it back to persist UUIDs onto its own model so the next push can read entities by id directly."
      )
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.action(async (options: SyncOptions) => {
    const logger = toLogger(options);
    const ctx = buildContext(options, logger);
    const recipe = await loadRecipe(options.file ?? "", campaignKind.schema);
    const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
    const ref = {
      kind: campaignKind.name,
      id: recipe.name,
      ...(recipe.handle ? { baselineKey: recipe.handle } : {}),
      ...(recipe.sitecoreId ? { tenantId: recipe.sitecoreId } : {}),
    };
    const outcome = await syncPush(campaignKind, recipe, ref, ctx, {
      mode,
      prune: options.prune,
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
    // Back-compat side-channel; new consumers read identities from the
    // `--json` envelope (identities-in-envelope).
    if (options.identitiesOut && outcome.result?.identities) {
      await writeIdentitiesOut(options.identitiesOut, outcome.result.identities);
    }
    emitPushResultJson({
      logger,
      command: "campaign.sync.push",
      environment: ctx.environmentName,
      operation: "push",
      kind: campaignKind.name,
      ref,
      mode,
      outcome,
    });
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

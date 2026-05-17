/**
 * `scai sync` — the cross-domain aggregate over the recipe/sync engine.
 *
 * `brand sync` and `ops brief sync` each pull/diff/push ONE instance at
 * a time. `scai sync` fans those out: it enumerates every brand kit and
 * every brief type on the environment and pulls / diffs / pushes them
 * all, into one workspace directory.
 *
 * Only kinds that can enumerate themselves (`RecipeKind.list`) take
 * part. Component / page / site recipes are file-authored — there is
 * nothing to enumerate — so they stay with `provision recipe`.
 *
 * Workspace layout: <dir>/<kind-name>/<slug(id)>.yaml
 *   .scai/sync/brand-kit/acme.yaml
 *   .scai/sync/brief-type/creative-brief.yaml
 *
 * The aggregate algorithm lives in `@/sync` (`aggregatePull` /
 * `aggregateStatus` / `aggregatePush`); this file only wires the kinds,
 * resolves config, and renders the structured result.
 */
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { readRootConfiguration } from "@/config/root-config";
import { ENUMERABLE_RECIPE_KINDS } from "@/sync/aggregate-kinds";
import {
  aggregatePull,
  aggregatePush,
  aggregateStatus,
  DEFAULT_SYNC_DIR,
  type SyncContext,
  type SyncMode,
} from "@/sync";
import { toLogger } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";

interface SyncOptions extends CommonOptions {
  environmentName?: string;
  config?: string;
  dir?: string;
  allowWrite?: boolean;
  prune?: boolean;
}

const buildContext = (options: SyncOptions, logger: Logger): SyncContext => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  return {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
  };
};

const runPull = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const result = await aggregatePull(ENUMERABLE_RECIPE_KINDS, ctx, { dir: options.dir });
  for (const kind of result.kinds) {
    logger.info(`${kind.kind}:`, "cyan");
    if (kind.skipped) {
      // A domain that isn't configured for this env (no credential) is
      // skipped, not fatal — the other domains still pulled.
      logger.warn(`  skipped — ${kind.skipped}`);
      continue;
    }
    for (const item of kind.pulled) {
      logger.info(`  pulled ${item.file}`);
    }
  }
  logger.info(`Pulled ${result.total} recipe(s) into ${result.dir}.`, "green");
};

const runStatus = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const result = await aggregateStatus(ENUMERABLE_RECIPE_KINDS, ctx, { dir: options.dir });
  for (const kind of result.kinds) {
    logger.info(`${kind.kind}:`, "cyan");
    for (const item of kind.items) {
      if (item.status === "in-sync") {
        logger.info(`  = ${item.id} — in sync`);
      } else if (item.status === "drift" && item.summary) {
        const tally = item.summary;
        logger.info(
          `  ~ ${item.id} — ${tally.create} create, ${tally.update} update, ${tally.delete} delete`
        );
      } else {
        logger.warn(`  ! ${item.id} — ${item.error}`);
      }
    }
  }
  logger.info(
    result.drifted === 0
      ? "Everything in sync."
      : `${result.drifted} recipe(s) drifted — \`scai sync push\` to converge.`,
    result.drifted === 0 ? "green" : "yellow"
  );
};

const runPush = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
  if (mode === "what-if") {
    logger.info("Dry run — no writes. Re-run with --allow-write to converge.", "yellow");
  }
  const result = await aggregatePush(ENUMERABLE_RECIPE_KINDS, ctx, {
    dir: options.dir,
    mode,
    prune: Boolean(options.prune),
  });
  for (const kind of result.kinds) {
    logger.info(`${kind.kind}:`, "cyan");
    for (const item of kind.items) {
      if (item.status === "applied") {
        logger.info(`  ✓ ${item.id} — ${item.appliedCount} change(s)`);
      } else if (item.status === "in-sync") {
        logger.info(`  = ${item.id} — in sync`);
      } else if (item.status === "planned") {
        logger.info(`  ~ ${item.id} — would apply ${item.plannedCount}`);
      } else {
        logger.warn(`  ! ${item.id} — ${item.error}`);
      }
    }
  }
  if (result.mode === "apply") {
    logger.info(`Applied ${result.applied} change(s).`, "green");
  }
};

/** `scai sync` — cross-domain recipe pull / status / push. */
export const createSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push every brand kit and brief type at once — the cross-domain recipe aggregate."
  );

  const dirOption = (): Option =>
    new Option("--dir <path>", "Workspace directory for recipe files.").default(DEFAULT_SYNC_DIR);

  const pull = new Command("pull").description(
    "Enumerate every brand kit + brief type and capture each as a recipe file."
  );
  pull.addOption(dirOption());
  addEnvironmentOption(pull);
  addConfigOption(pull);
  addVerbosityOptions(pull);
  pull.action(async (options: SyncOptions) => runPull(options));

  const status = new Command("status").description(
    "Diff every recipe file in the workspace against the environment."
  );
  status.addOption(dirOption());
  addEnvironmentOption(status);
  addConfigOption(status);
  addVerbosityOptions(status);
  status.action(async (options: SyncOptions) => runStatus(options));

  const push = new Command("push").description(
    "Converge every recipe file in the workspace onto the environment. Dry-run unless --allow-write."
  );
  push.addOption(dirOption());
  push.addOption(new Option("--allow-write", "Apply the plan (default is a dry-run)."));
  push.addOption(new Option("--prune", "Include delete changes (off by default)."));
  addEnvironmentOption(push);
  addConfigOption(push);
  addVerbosityOptions(push);
  push.action(async (options: SyncOptions) => runPush(options));

  command.addCommand(pull);
  command.addCommand(status);
  command.addCommand(push);

  command.addHelpText(
    "after",
    [
      "",
      "Covers every recipe kind that can enumerate itself: brand kits and",
      "brief types today. File-authored component/page/site recipes stay",
      "with `provision recipe`.",
      "",
      "Examples:",
      "  $ scai sync pull -n agents              # capture everything into .scai/sync",
      "  $ scai sync status -n agents            # what has drifted",
      "  $ scai sync push -n agents --allow-write",
      "",
    ].join("\n")
  );

  return command;
};

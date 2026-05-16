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
 */
import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "./shared";
import { readRootConfiguration } from "@/config/root-config";
import { brandKitKind } from "@/brand/recipe";
import { briefTypeKind } from "@/brief/recipe";
import {
  loadRecipe,
  planIsNoop,
  summarizePlan,
  syncDiff,
  syncPull,
  syncPush,
  writeRecipe,
  type RecipeKind,
  type SyncContext,
  type SyncMode,
} from "@/sync";
import { toLogger } from "@/shared/cli-tasks";
import { toScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";

/**
 * The kinds the aggregate covers — every `RecipeKind` that implements
 * `list`. Add a row when a new enumerable kind ships.
 */
const AGGREGATE_KINDS: RecipeKind<unknown>[] = [
  brandKitKind as RecipeKind<unknown>,
  briefTypeKind as RecipeKind<unknown>,
];

const DEFAULT_DIR = ".scai/sync";

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

/** Slugify an instance id for a recipe filename. */
const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

/** Every recipe carries a `name` — its `KindRef.id`. */
const recipeId = (recipe: unknown): string => String((recipe as { name?: unknown }).name ?? "");

/** Recipe files under a kind's workspace subdirectory. */
const recipeFiles = (dir: string, kindName: string): string[] => {
  const kindDir = path.join(dir, kindName);
  if (!fs.existsSync(kindDir)) return [];
  return fs
    .readdirSync(kindDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json"))
    .map((f) => path.join(kindDir, f));
};

const runPull = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const dir = options.dir ?? DEFAULT_DIR;
  let total = 0;
  for (const kind of AGGREGATE_KINDS) {
    if (!kind.list) continue;
    logger.info(`${kind.name}:`, "cyan");
    let refs;
    try {
      refs = await kind.list(ctx);
    } catch (error) {
      // A domain that isn't configured for this env (no credential) is
      // skipped, not fatal — the other domains still pull.
      logger.warn(`  skipped — ${toScaiError(error).message}`);
      continue;
    }
    for (const ref of refs) {
      const recipe = await syncPull(kind, ref, ctx);
      if (!recipe) continue;
      const file = path.join(dir, kind.name, `${slug(ref.id)}.yaml`);
      writeRecipe(file, recipe);
      logger.info(`  pulled ${file}`);
      total += 1;
    }
  }
  logger.info(`Pulled ${total} recipe(s) into ${dir}.`, "green");
};

const runStatus = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const dir = options.dir ?? DEFAULT_DIR;
  let drifted = 0;
  for (const kind of AGGREGATE_KINDS) {
    const files = recipeFiles(dir, kind.name);
    if (files.length === 0) continue;
    logger.info(`${kind.name}:`, "cyan");
    for (const file of files) {
      const recipe = loadRecipe(file, kind.schema);
      try {
        const plan = await syncDiff(kind, recipe, { kind: kind.name, id: recipeId(recipe) }, ctx);
        if (planIsNoop(plan)) {
          logger.info(`  = ${recipeId(recipe)} — in sync`);
        } else {
          const t = summarizePlan(plan);
          logger.info(
            `  ~ ${recipeId(recipe)} — ${t.create} create, ${t.update} update, ${t.delete} delete`
          );
          drifted += 1;
        }
      } catch (error) {
        logger.warn(`  ! ${recipeId(recipe)} — ${toScaiError(error).message}`);
      }
    }
  }
  logger.info(
    drifted === 0
      ? "Everything in sync."
      : `${drifted} recipe(s) drifted — \`scai sync push\` to converge.`,
    drifted === 0 ? "green" : "yellow"
  );
};

const runPush = async (options: SyncOptions): Promise<void> => {
  const logger = toLogger(options);
  const ctx = buildContext(options, logger);
  const dir = options.dir ?? DEFAULT_DIR;
  const mode: SyncMode = options.allowWrite ? "apply" : "what-if";
  if (mode === "what-if") {
    logger.info("Dry run — no writes. Re-run with --allow-write to converge.", "yellow");
  }
  let applied = 0;
  for (const kind of AGGREGATE_KINDS) {
    const files = recipeFiles(dir, kind.name);
    if (files.length === 0) continue;
    logger.info(`${kind.name}:`, "cyan");
    for (const file of files) {
      const recipe = loadRecipe(file, kind.schema);
      try {
        const outcome = await syncPush(
          kind,
          recipe,
          { kind: kind.name, id: recipeId(recipe) },
          ctx,
          { mode, prune: Boolean(options.prune) }
        );
        if (outcome.result) {
          logger.info(`  ✓ ${recipeId(recipe)} — ${outcome.result.applied.length} change(s)`);
          applied += outcome.result.applied.length;
        } else if (planIsNoop(outcome.plan)) {
          logger.info(`  = ${recipeId(recipe)} — in sync`);
        } else {
          const t = summarizePlan(outcome.plan);
          logger.info(`  ~ ${recipeId(recipe)} — would apply ${t.create + t.update + t.delete}`);
        }
      } catch (error) {
        logger.warn(`  ! ${recipeId(recipe)} — ${toScaiError(error).message}`);
      }
    }
  }
  if (mode === "apply") {
    logger.info(`Applied ${applied} change(s).`, "green");
  }
};

/** `scai sync` — cross-domain recipe pull / status / push. */
export const createSyncCommand = (): Command => {
  const command = new Command("sync").description(
    "Pull, diff, and push every brand kit and brief type at once — the cross-domain recipe aggregate."
  );

  const dirOption = (): Option =>
    new Option("--dir <path>", "Workspace directory for recipe files.").default(DEFAULT_DIR);

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

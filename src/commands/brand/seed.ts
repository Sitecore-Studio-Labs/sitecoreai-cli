import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { readRootConfiguration } from "@/config/root-config";
import {
  seedBrandKit,
  type BrandApiClientOptions,
  type SeedBrandKitOptions,
  type SeedProgressEvent,
} from "@/brand";
import { brandKitKind } from "@/brand/recipe";
import { loadRecipe, syncPush, type SyncContext } from "@/sync";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";
import type { Logger } from "@/shared/logger";

interface SeedOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  name?: string;
  description?: string;
  industry?: string;
  url?: string;
  file?: string;
  pollIntervalSec?: string;
  timeoutSec?: string;
  format?: "text" | "json";
}

const resolveClient = (options: SeedOptions): BrandApiClientOptions => {
  const root = readRootConfiguration(options.config ?? process.cwd(), options.environmentName);
  const envName = options.environmentName ?? root.defaultEnvironment;
  const env = root.environments[envName];
  const orgId = options.orgId ?? env?.organizationId;
  if (!orgId) {
    throw inputError(
      `Cannot resolve organizationId for env '${envName}'.`,
      "Pass --org-id <id> or set organizationId on the env profile."
    );
  }
  const credential = root.brand?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No Brand credential is configured for org '${orgId}'.`,
      "AUTH_BRAND_REQUIRED",
      { hint: `Run \`scai setup login brand -n ${envName}\` to provision one.` }
    );
  }
  return { orgId, credential };
};

/**
 * `--url` path: drive a brand kit from "doesn't exist" to "has
 * populated sections" by running the full ingest + enrich pipeline on
 * a hosted PDF. Triggers two paid AI pipeline runs (~5–15 min).
 */
const seedFromUrl = async (options: SeedOptions, logger: Logger): Promise<void> => {
  if (!options.name) {
    throw inputError("--name is required when seeding from --url.");
  }
  const client = resolveClient(options);
  const source: SeedBrandKitOptions["source"] = { url: options.url ?? "" };

  const onProgress = (event: SeedProgressEvent): void => {
    if (options.format === "json") {
      // Streaming progress to stderr keeps stdout clean for the
      // final JSON payload.
      process.stderr.write(`${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n`);
    } else {
      logger.info(
        `[+${event.elapsedSec.toString().padStart(3)}s] ${event.stage}: ${event.message}`
      );
    }
  };

  const result = await seedBrandKit({
    client,
    name: options.name,
    source,
    description: options.description,
    industry: options.industry,
    pollIntervalSec: options.pollIntervalSec ? Number(options.pollIntervalSec) : undefined,
    timeoutSec: options.timeoutSec ? Number(options.timeoutSec) : undefined,
    onProgress,
  });

  if (options.format === "json") {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  logger.info(`\n✓ Seeded kit ${result.kit.id} in ${result.elapsedSec}s`, "green");
  logger.info(`  ${result.sections.length} section(s):`);
  for (const s of result.sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    logger.info(`    ${s.order ?? "?"}. ${s.name}`);
  }
  logger.info(
    `\nReady for Brand Review. Try:\n  scai brand review <file.md> --kit ${result.kit.id} --threshold 4`
  );
};

/**
 * `--file` path: seed a kit straight from a kit-shaped recipe file —
 * the same `BrandKitRecipe` shape `brand sync pull` emits and
 * `brand sync push` consumes. No PDF, no AI pipeline: the recipe's
 * section content is written directly via the converge engine. A kit
 * named after the recipe is created if absent, or updated to match.
 */
const seedFromFile = async (options: SeedOptions, logger: Logger): Promise<void> => {
  const configPath = options.config ?? process.cwd();
  const root = readRootConfiguration(configPath, options.environmentName);
  const ctx: SyncContext = {
    environmentName: options.environmentName ?? root.defaultEnvironment,
    configPath,
    logger,
  };
  const recipe = loadRecipe(options.file ?? "", brandKitKind.schema);
  const outcome = await syncPush(
    brandKitKind,
    recipe,
    { kind: brandKitKind.name, id: recipe.name },
    ctx,
    { mode: "apply", prune: false }
  );
  if (options.format === "json") {
    process.stdout.write(
      JSON.stringify({ recipe: recipe.name, plan: outcome.plan, result: outcome.result }, null, 2) +
        "\n"
    );
    return;
  }
  if (outcome.result) {
    logger.info(
      `✓ Seeded kit '${recipe.name}' from ${options.file} — ` +
        `${outcome.result.applied.length} change(s) applied, ${outcome.result.skipped.length} skipped.`,
      "green"
    );
  } else {
    logger.info(`Kit '${recipe.name}' already matches ${options.file} — nothing to do.`, "green");
  }
};

/**
 * `scai brand seed` — create a brand kit, either:
 *   - `--url <pdf>`  : the full ingest + enrich pipeline on a hosted
 *                      PDF ([[project-scai-brand-kit-seed-recipe]]).
 *   - `--file <json>`: a kit-shaped recipe applied directly (no PDF,
 *                      no AI pipeline) — round-trips with `sync pull`.
 */
export const createBrandSeedCommand = (): Command => {
  const command = new Command("seed")
    .description(
      "Create a brand kit — from a PDF (--url, full ingest+enrich pipeline, ~5–15 min) " +
        "or from a kit-shaped recipe file (--file, applied directly)."
    )
    .addOption(new Option("--name <name>", "Display name for the new kit (required with --url)"))
    .addOption(new Option("--url <url>", "Public HTTPS URL to a PDF Sitecore's edge can reach"))
    .addOption(
      new Option("--file <path>", "Kit-shaped recipe file (.yaml / .json) — the `sync pull` shape")
    )
    .addOption(new Option("--description <text>", "Kit description (--url path only)"))
    .addOption(new Option("--industry <label>", "Industry label (--url path only)"))
    .addOption(
      new Option("--poll-interval-sec <n>", "Section poll interval in seconds (default 15)")
    )
    .addOption(
      new Option(
        "--timeout-sec <n>",
        "Max seconds to wait for sections to populate (default 900 / 15min)"
      )
    )
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));

  command.addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  $ scai brand seed --name 'Acme' --url https://acme.example/brand.pdf",
      "  $ scai brand seed --file acme.brandkit.yaml",
      "",
      "`--file` takes the same recipe `scai brand sync pull` writes — the two round-trip.",
      "",
    ].join("\n")
  );

  command.action(async (options: SeedOptions) => {
    const logger = toLogger(options);
    if (options.url && options.file) {
      throw inputError("Pass either --url (PDF) or --file (kit recipe), not both.");
    }
    if (options.file) {
      await seedFromFile(options, logger);
      return;
    }
    if (!options.url) {
      throw inputError(
        "A source is required: --url <pdfUrl> for the ingest pipeline, or --file <kit.json>.",
        "scai brand seed --name <name> --url <pdfUrl>   |   scai brand seed --file <kit.json>"
      );
    }
    await seedFromUrl(options, logger);
  });

  return command;
};

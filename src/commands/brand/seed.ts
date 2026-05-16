import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";
import { readRootConfiguration } from "@/config/root-config";
import {
  seedBrandKit,
  LOCAL_UPLOAD_UNSUPPORTED_MESSAGE,
  LOCAL_UPLOAD_UNSUPPORTED_HINT,
  type BrandApiClientOptions,
  type SeedBrandKitOptions,
  type SeedProgressEvent,
} from "@/brand";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";

interface SeedOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  name: string;
  description?: string;
  industry?: string;
  url?: string;
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
  const credential = root.aiSkills?.[orgId];
  if (!credential) {
    throw createScaiError(
      `No AI Skills credential is configured for org '${orgId}'.`,
      "AUTH_AI_SKILLS_REQUIRED",
      { hint: `Run \`scai setup login ai-skills -n ${envName}\` to provision one.` }
    );
  }
  return { orgId, credential };
};

/**
 * `scai brand seed` — one-shot kit creation flow. Orchestrates the
 * full 7-step recipe ([[project-scai-brand-kit-seed-recipe]]) so the
 * operator (or an agent via MCP) gets back a populated kit from a
 * single PDF input.
 *
 * Cost: triggers two paid AI pipeline runs. Wall-clock ~5–15 min.
 */
export const createBrandSeedCommand = (): Command => {
  const command = new Command("seed")
    .description(
      "Create + upload + publish + ingest + enrich a brand kit from a single PDF in one command (~5–15 min)."
    )
    .argument("[file]", "(Unsupported) local file path — host the PDF and use --url instead")
    .requiredOption("--name <name>", "Display name for the new kit")
    .addOption(new Option("--url <url>", "Public HTTPS URL to a PDF Sitecore's edge can reach"))
    .addOption(new Option("--description <text>", "Kit description"))
    .addOption(new Option("--industry <label>", "Industry label"))
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

  command.action(async (file: string | undefined, options: SeedOptions) => {
    const logger = toLogger(options);
    const client = resolveClient(options);

    if (file) {
      throw inputError(LOCAL_UPLOAD_UNSUPPORTED_MESSAGE, LOCAL_UPLOAD_UNSUPPORTED_HINT);
    }
    if (!options.url) {
      throw inputError("A --url is required.", "scai brand seed --name <name> --url <pdfUrl>");
    }
    const source: SeedBrandKitOptions["source"] = { url: options.url };

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
  });

  return command;
};

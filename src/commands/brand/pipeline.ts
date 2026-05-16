import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions, collectList } from "../shared";
import { readRootConfiguration } from "@/config/root-config";
import {
  runBrandIngestionPipeline,
  runEnrichSectionsPipeline,
  type BrandApiClientOptions,
} from "@/brand";
import { inputError, toLogger } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import type { CommonOptions } from "@/shared/cli-options";

interface PipelineCommonOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  format?: "text" | "json";
}

const resolveClient = (options: PipelineCommonOptions): BrandApiClientOptions => {
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

const writeJson = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};

const createIngestCommand = (): Command => {
  const command = new Command("ingest")
    .description("Trigger BrandIngestionPipeline — chunks the kit's documents.")
    .argument("<kitId>", "Brand kit UUID")
    .addOption(
      new Option(
        "--doc-ids <ids>",
        "Comma-separated document UUIDs (defaults to all unprocessed docs)"
      ).argParser(collectList)
    )
    .addOption(new Option("--no-populate-sections", "Skip auto-populating sections from chunks"))
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(
    async (
      kitId: string,
      options: PipelineCommonOptions & {
        docIds?: string[];
        populateSections?: boolean;
      }
    ) => {
      const logger = toLogger(options);
      const client = resolveClient(options);
      const run = await runBrandIngestionPipeline({
        client,
        brandKitId: kitId,
        populateSections: options.populateSections,
        documentIds: options.docIds,
      });
      if (options.format === "json") {
        writeJson(run);
        return;
      }
      logger.info(`Started BrandIngestionPipeline run ${run.id}`, "green");
      logger.info(
        "\nNext: run `scai brand pipeline enrich <kitId>` to populate sections from the chunks (the ingestion step alone leaves sections empty)."
      );
    }
  );
  return command;
};

const createEnrichCommand = (): Command => {
  const command = new Command("enrich")
    .description(
      "Trigger EnrichSectionsPipeline — populates kit sections from already-ingested chunks."
    )
    .argument("<kitId>", "Brand kit UUID")
    .addOption(
      new Option("--section-ids <ids>", "Comma-separated section UUIDs").argParser(collectList)
    )
    .addOption(
      new Option("--field-ids <ids>", "Comma-separated field UUIDs").argParser(collectList)
    )
    .addOption(
      new Option("--format <kind>", "Output format").choices(["text", "json"]).default("text")
    );
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.addOption(new Option("--org-id <id>", "Override orgId from env profile"));
  command.action(
    async (
      kitId: string,
      options: PipelineCommonOptions & { sectionIds?: string[]; fieldIds?: string[] }
    ) => {
      const logger = toLogger(options);
      const client = resolveClient(options);
      const run = await runEnrichSectionsPipeline({
        client,
        brandKitId: kitId,
        sectionIds: options.sectionIds,
        fieldIds: options.fieldIds,
      });
      if (options.format === "json") {
        writeJson(run);
        return;
      }
      logger.info(`Started EnrichSectionsPipeline run ${run.id}`, "green");
      logger.info(
        "\nPoll `scai brand kits sections <kitId>` every 30s — sections should appear in ~3–10 min."
      );
    }
  );
  return command;
};

/**
 * `scai brand pipeline …` — wraps the two AI Skills pipelines.
 *   - `ingest <kitId>`  : BrandIngestionPipeline (chunks docs)
 *   - `enrich <kitId>`  : EnrichSectionsPipeline (populates sections)
 *
 * Both are paid AI compute. Use `scai brand seed` for the full
 * happy-path flow that orchestrates create + upload + publish +
 * ingest + enrich + poll.
 */
export const createBrandPipelineCommand = (): Command => {
  const command = new Command("pipeline").description(
    "Brand kit ingestion + enrichment pipelines (server-side async AI compute)."
  );
  command.addCommand(createIngestCommand());
  command.addCommand(createEnrichCommand());
  return command;
};

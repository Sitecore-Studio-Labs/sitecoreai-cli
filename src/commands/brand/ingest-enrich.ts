import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions, collectList } from "../shared";
import { runBrandIngestionPipeline, runEnrichSectionsPipeline } from "@/brand";
import { resolveBrandClient } from "@/brand/credential";
import { toLogger } from "@/shared/cli-tasks";
import type { CommonOptions } from "@/shared/cli-options";

/**
 * `scai brand ingest` / `scai brand enrich` — the two server-side AI
 * steps that turn a brand kit's documents into populated sections.
 * They were briefly grouped under a `brand pipeline` parent; "pipeline"
 * said nothing about ingest-vs-enrich, so the two verbs are top-level.
 * `scai brand seed` still orchestrates the whole happy path
 * (create + upload + publish + ingest + enrich + poll).
 */
interface PipelineCommonOptions extends CommonOptions {
  environmentName?: string;
  orgId?: string;
  format?: "text" | "json";
}

const writeJson = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
};

export const createBrandIngestCommand = (): Command => {
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
      const client = resolveBrandClient(options);
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
        "\nNext: run `scai brand enrich <kitId>` to populate sections from the chunks (the ingestion step alone leaves sections empty)."
      );
    }
  );
  return command;
};

export const createBrandEnrichCommand = (): Command => {
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
      const client = resolveBrandClient(options);
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

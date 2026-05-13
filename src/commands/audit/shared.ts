import { Command } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions } from "../shared";

/**
 * Standard option set for `scai audit *` commands. Includes the perf
 * knobs — `--concurrency`, `--batch-size`, `--page-parallel`, `--cache`
 * — that override env-default values resolved by `resolveHygieneKnobs`.
 */
export const addAuditBaseOptions = (command: Command): Command => {
  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);
  command.option(
    "--index <name>",
    "Override the search index name (default: sitecore_master_index)"
  );
  command.option("--include-system", "Include /sitecore/system and platform items in the scan");
  command.option("--limit <count>", "Maximum number of items to inspect", (v) => parseInt(v, 10));
  command.option(
    "--concurrency <count>",
    "Parallel batch fan-out for field reads + ref resolution (default 8, env SITECOREAI_HYGIENE_CONCURRENCY)",
    (v) => parseInt(v, 10)
  );
  command.option(
    "--batch-size <count>",
    "Aliased GraphQL batch size per field-read query (default 50, env SITECOREAI_HYGIENE_BATCH_SIZE)",
    (v) => parseInt(v, 10)
  );
  command.option(
    "--page-parallelism <count>",
    "Parallel page-windows during search enumeration (default 4, env SITECOREAI_HYGIENE_PAGE_PARALLELISM)",
    (v) => parseInt(v, 10)
  );
  command.option(
    "--cache",
    "Use the on-disk field cache (keyed by itemId+updatedDate) at ~/.sitecoreai/audit-cache/"
  );
  return command;
};

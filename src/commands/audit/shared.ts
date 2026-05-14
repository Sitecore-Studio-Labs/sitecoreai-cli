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
  command.option(
    "--exclude <path>",
    "Exclude items under this path prefix. Repeat or comma-separate.",
    (v: string, prev: string[] = []) =>
      prev.concat(
        v
          .split(",")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0)
      ),
    []
  );
  command.option(
    "--since <date>",
    "Only items updated on/after this date (ISO 8601 or YYYY-MM-DD)"
  );
  command.option(
    "--owner <user>",
    "Filter by createdBy or updatedBy (post-fetch filter on Authoring API)"
  );
  command.option(
    "--baseline",
    "Filter out findings present in the per-env baseline at .scai/audit-baseline-<envName>.json"
  );
  command.option(
    "--output <file>",
    "Write the report to a file instead of stdout. Format inferred from extension (.json, .csv, .md)"
  );
  command.option("--format <fmt>", "Output format: json (default), csv, markdown");
  return command;
};

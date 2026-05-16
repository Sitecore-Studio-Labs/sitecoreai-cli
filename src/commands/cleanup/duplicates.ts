import { Command, Option } from "commander";
import {
  runCleanupDuplicates,
  type CleanupDuplicatesOptions,
} from "@/hygiene/tasks/cleanup/duplicates";
import type { DuplicatesGroup } from "@/hygiene/tasks/audit/duplicates";
import { readScaiEnvelopeFromStdin } from "@/shared/envelope";
import { withApplyGate } from "../shared";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupDuplicatesCommand = (): Command => {
  const command = new Command("duplicates").description(
    "Delete duplicate-content items, keeping one per group per --keep-rule"
  );

  const purge = new Command("purge").description(
    "Delete duplicates per keep-rule (default: oldest creation date wins)"
  );
  addCleanupBaseOptions(purge);
  purge.option("--root <path>", "Content-tree root (default: /sitecore/content)");
  purge.option("--language <code>", "Restrict to one language (default: include all)");
  purge.option(
    "--min-group-size <count>",
    "Only act on groups with at least this many duplicates (default: 2)",
    (v) => parseInt(v, 10)
  );
  purge.option("--limit <count>", "Cap on the number of items inspected (default: 5000)", (v) =>
    parseInt(v, 10)
  );
  purge.option("--index <name>", "Override the search index name");
  purge.option("--include-system", "Include /sitecore/system items in the scan (off by default)");
  purge.option(
    "--include-system-fields",
    "Include __-prefixed system fields when computing the content hash"
  );
  purge.addOption(
    new Option("--keep-rule <rule>", "Which member of each duplicate group survives")
      .choices(["oldest", "newest", "shortest-path", "interactive"])
      .default("oldest")
  );
  purge.option("--concurrency <count>", "Delete concurrency (default: 4)", (v) => parseInt(v, 10));
  purge.option("--batch-size <count>", "Aliased GraphQL batch size for field reads", (v) =>
    parseInt(v, 10)
  );
  purge.option(
    "--skip-ref-check",
    "Skip the inbound-reference pre-flight scan (faster on large tenants; refs to deleted dupes will become broken)"
  );
  purge.option(
    "--from-stdin",
    "Read an `audit duplicates list` envelope from stdin and use its groups directly, skipping the cleanup's internal audit re-run. Pair with the audit's --json mode."
  );
  purge.addHelpText(
    "after",
    "\nPre-flight: each dupe targeted for deletion is scanned for inbound refs\n" +
      "via `audit references`; matches are reported as 'blocked' and skipped.\n" +
      "Pass --skip-ref-check or --force (from cleanup base options) to override;\n" +
      "run `scai hygiene audit broken-links list` after the purge to triage any dangling refs.\n\n" +
      "Pipelining: skip the cleanup's internal audit re-run with --from-stdin:\n" +
      "  $ scai hygiene audit duplicates list --json | scai hygiene cleanup duplicates purge --from-stdin --apply\n" +
      "Useful when the operator wants to inspect / filter the audit envelope\n" +
      "before passing it to the cleanup, or when running both in a pipeline\n" +
      "shouldn't repeat the hash scan.\n"
  );
  purge.action(
    withApplyGate(async (options: CleanupDuplicatesOptions & { fromStdin?: boolean }) => {
      if (options.fromStdin) {
        const envelope = await readScaiEnvelopeFromStdin<DuplicatesGroup[]>();
        if (!Array.isArray(envelope.data)) {
          throw new Error(
            `--from-stdin: envelope.data is not an array (got ${typeof envelope.data}). Expected an audit duplicates list envelope.`
          );
        }
        return runCleanupDuplicates({ ...options, preComputedGroups: envelope.data });
      }
      return runCleanupDuplicates(options);
    })
  );

  command.addCommand(purge);
  return command;
};

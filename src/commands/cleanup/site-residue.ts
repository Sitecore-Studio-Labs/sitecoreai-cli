import { Command } from "commander";
import { runCleanupSiteResidue } from "@/hygiene/tasks/cleanup-site-residue";
import { addCleanupBaseOptions } from "./shared";

export const createCleanupSiteResidueCommand = (): Command => {
  const command = new Command("site-residue").description(
    "Delete SXA tenant/site folders left behind after a Sites-API delete (templates/Project, layout/Renderings/Project, media library/Project)"
  );

  const purge = new Command("purge").description(
    "Delete orphan tenant/site subtrees identified by `audit site-residue`. Defaults to plan-mode; combine --what-if with --allow-write to mutate."
  );
  addCleanupBaseOptions(purge);
  purge.option(
    "--root <path>",
    "Additional root to scan on top of the SXA defaults. Repeat or comma-separate.",
    (value: string, previous: string[] = []) =>
      previous.concat(
        value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      ),
    []
  );
  purge.option(
    "--content-root <path>",
    "Override the content root walked when discovering active sites (default /sitecore/content)"
  );
  purge.option(
    "--skip-ref-check",
    "Skip the inbound-ref pre-flight scan. Faster but loses the safety net — pair with `audit broken-links` if you use this."
  );
  purge.option("--index <name>", "Override the search index name (default: sitecore_master_index)");
  purge.option("--concurrency <count>", "Concurrent deletes / pre-flight scans (default: 4)", (v) =>
    parseInt(v, 10)
  );
  purge.action(async (options) => {
    await runCleanupSiteResidue(options);
  });

  command.addCommand(purge);

  command.addHelpText(
    "after",
    "\nSafety:\n" +
      "  - Defaults to plan-mode. Add --allow-write to mutate.\n" +
      "  - Pre-flight scans every active tenant for refs into the doomed tree.\n" +
      "    Orphans with inbound refs are skipped unless --force is passed.\n" +
      "  - Recommended sequence:\n" +
      "      $ scai cleanup site-residue purge --what-if          # plan + ref check\n" +
      "      $ scai cleanup site-residue purge --allow-write       # execute\n" +
      "      $ scai audit broken-links list                        # verify no breaks\n"
  );

  return command;
};

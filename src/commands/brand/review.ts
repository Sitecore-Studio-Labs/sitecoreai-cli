import { Command, Option } from "commander";
import { addConfigOption, addEnvironmentOption, addVerbosityOptions, collectList } from "../shared";
import { runBrandReview, type BrandReviewCommandOptions } from "@/brand/tasks/review";

const parseInt5 = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer: ${value}`);
  }
  return parsed;
};

/**
 * `scai brand review <files...>` — evaluate file content against a
 * Sitecore AI Skills brand kit. Streams text rows as files complete,
 * or aggregates into JSON / SARIF for `--format` consumers. The
 * SARIF + `--threshold` combination is the headline CI gate.
 *
 * Cost note: every reviewed file is one paid AI inference call. The
 * `--limit` guardrail (default 1000) prevents accidental fan-out
 * against a giant repo; pass `--force` to override after seeing the
 * `--what-if` projection.
 */
export const createBrandReviewCommand = (): Command => {
  const command = new Command("review")
    .description(
      "Evaluate file content against a Sitecore brand kit. Streams text, or aggregates into JSON / SARIF."
    )
    .argument("[files...]", "Files to review. Mixed with --glob results.");

  addEnvironmentOption(command);
  addConfigOption(command);
  addVerbosityOptions(command);

  command
    .addOption(new Option("--org-id <id>", "Override the orgId resolved from the env profile."))
    .addOption(
      new Option("--kit <id>", "Brand kit ID to evaluate against.").makeOptionMandatory(false)
    )
    .addOption(
      new Option(
        "--section-id <id>",
        "Restrict to a section UUID (repeatable, comma-separated). Use <sectionId>:<fieldId> to narrow to a subsection. List section IDs with the Brand Management API."
      ).argParser(collectList)
    )
    .addOption(new Option("--glob <pattern>", "Glob pattern(s) to expand").argParser(collectList))
    .addOption(
      new Option(
        "--threshold <score>",
        "Fail (exit 1) if any score is below this value (1–5)."
      ).argParser(parseInt5)
    )
    .addOption(
      new Option("--concurrency <n>", "Parallel in-flight reviews (default 4)").argParser(parseInt5)
    )
    .addOption(
      new Option("--fail-fast", "Stop scheduling on first failure (in-flight requests drain).")
    )
    .addOption(
      new Option("--format <kind>", "Output format")
        .choices(["text", "json", "sarif"])
        .default("text")
    )
    .addOption(new Option("--output <path>", "Write the report to this file instead of stdout."))
    .addOption(
      new Option("--limit <n>", "Maximum files to review without --force (default 1000)").argParser(
        parseInt5
      )
    )
    .addOption(new Option("--force", "Bypass the --limit guardrail"))
    .addOption(
      new Option(
        "--what-if",
        "Print the resolved file list + count and exit without calling the API."
      )
    );

  command.addHelpText(
    "after",
    "\nExamples:\n" +
      "  $ scai brand review content/about.md --kit <kitId>\n" +
      "  $ scai brand review --glob 'content/**/*.md' --kit <kitId> --threshold 4\n" +
      "  $ scai brand review --glob 'content/**/*.md' --kit <kitId> --threshold 4 \\\n" +
      "      --format sarif --output brand.sarif\n" +
      "\nCI gate (GitHub Actions):\n" +
      "  - run: scai brand review --glob 'content/**/*.md' --kit <kitId> \\\n" +
      "         --threshold 4 --format sarif --output brand.sarif\n" +
      "  - uses: github/codeql-action/upload-sarif@v3\n" +
      "    with: { sarif_file: brand.sarif }\n"
  );

  command.action(
    async (
      files: string[] | undefined,
      flags: Omit<BrandReviewCommandOptions, "inputs">
    ): Promise<void> => {
      const result = await runBrandReview({ ...flags, inputs: files ?? [] });
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    }
  );

  return command;
};

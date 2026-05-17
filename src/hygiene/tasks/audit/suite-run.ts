import { resolveEnvironment } from "@/policy/environment";
import { auditSuiteToRunnerInput, expandOutputPath, loadAuditSuite } from "../../audit-suite";
import { runAuditAll } from "./all";
import { type HygieneCommonOptions, toLogger } from "../shared";

export interface AuditSuiteRunOptions extends HygieneCommonOptions {
  /** Path to the YAML file. Required. */
  file: string;
  /** Override the suite's `baseline.enabled`. */
  baseline?: boolean;
  /** Override the suite's `output.path`. */
  output?: string;
  /** Override the suite's `output.format`. */
  format?: "json" | "csv" | "markdown";
  /**
   * Run only a subset of the suite's audits. Useful for re-running
   * after a fix.
   */
  only?: string[];
}

/**
 * Execute a YAML-defined audit suite.
 *
 * Loads the suite, resolves environment, expands the output path
 * template (with {date}, {env}, {suite} tokens), and hands off to
 * `runAuditAll` with the merged options.
 *
 * The suite's `baseline.update-on-success` flag is honored if no
 * audits report findings — useful for the "accept current state as
 * the new baseline" pattern after a manual review.
 */
export const runAuditSuiteRun = async (options: AuditSuiteRunOptions): Promise<void> => {
  const logger = toLogger(options);
  const suite = loadAuditSuite(options.file, logger);
  const { envName } = resolveEnvironment(options);

  const { include, sharedOptions } = auditSuiteToRunnerInput(suite);
  const baselineEnabled = options.baseline ?? suite.baseline?.enabled ?? false;
  const outputPath = options.output ?? suite.output?.path;
  const expandedOutput = outputPath
    ? expandOutputPath(outputPath, { envName, suiteName: suite.name })
    : undefined;
  const format = options.format ?? suite.output?.format;

  const filteredInclude = options.only?.length
    ? include.filter((name) => options.only!.includes(name))
    : include;

  logger.info(
    `Running audit suite '${suite.name}' (${filteredInclude.length} audit${filteredInclude.length === 1 ? "" : "s"}${baselineEnabled ? ", baseline=on" : ""}${expandedOutput ? `, → ${expandedOutput}` : ""}).`,
    "cyan"
  );

  await runAuditAll({
    ...options,
    ...sharedOptions,
    include: filteredInclude,
    baseline: baselineEnabled,
    output: expandedOutput,
    format,
  });

  // `update-on-success` would require re-reading the audit-all output
  // to confirm no findings; left to a follow-up. Documented in the
  // file shape but not yet enforced here.
};

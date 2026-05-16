import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { createScaiError } from "@/shared/errors";
import { Logger } from "@/shared/logger";

/**
 * Audit suite — a YAML-defined pipeline of audits that an operator
 * can codify per-project and check into version control. Lets teams
 * standardise their hygiene policy without each operator memorising
 * the right flags.
 *
 * File shape:
 *
 *   version: 1
 *   name: monthly-hygiene
 *   audits:
 *     - name: broken-links
 *       options:
 *         root: /sitecore/content/MySite
 *         limit: 1000
 *     - name: duplicates
 *       options:
 *         min-group-size: 3
 *     - name: stale-content
 *       options:
 *         not-updated-in-days: 180
 *   output:
 *     format: markdown
 *     path: ./reports/{date}.md
 *   baseline:
 *     enabled: true
 *     update-on-success: false
 *
 * Output path templating:
 *   {date}       — YYYY-MM-DD
 *   {datetime}   — YYYY-MM-DDTHH-mm-ss
 *   {env}        — environment name
 *   {suite}      — suite `name:` from the file
 */

export interface AuditSuiteFile {
  version: number;
  name: string;
  audits: AuditSuiteEntry[];
  output?: {
    format?: "json" | "csv" | "markdown";
    path?: string;
  };
  baseline?: {
    enabled?: boolean;
    "update-on-success"?: boolean;
  };
}

export interface AuditSuiteEntry {
  name: string;
  /** Free-form per-audit options. Validated by the audit task itself. */
  options?: Record<string, unknown>;
}

const SUPPORTED_VERSION = 1;

export const loadAuditSuite = (filePath: string, logger?: Logger): AuditSuiteFile => {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw createScaiError(`Audit suite file not found: ${abs}`, "CONFIG_NOT_FOUND");
  }
  const raw = fs.readFileSync(abs, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw createScaiError(
      `Audit suite file is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      "CONFIG_INVALID",
      { hint: `File: ${abs}` }
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw createScaiError(
      "Audit suite file must be a YAML mapping with at least 'version' and 'audits'.",
      "CONFIG_INVALID"
    );
  }
  const suite = parsed as Partial<AuditSuiteFile>;
  if (suite.version !== SUPPORTED_VERSION) {
    throw createScaiError(
      `Unsupported audit-suite version: ${suite.version} (expected ${SUPPORTED_VERSION}).`,
      "CONFIG_INVALID"
    );
  }
  if (!suite.name || typeof suite.name !== "string") {
    throw createScaiError("Audit suite must have a 'name'.", "CONFIG_INVALID");
  }
  if (!Array.isArray(suite.audits) || suite.audits.length === 0) {
    throw createScaiError("Audit suite must have a non-empty 'audits' list.", "CONFIG_INVALID");
  }
  for (const a of suite.audits) {
    if (!a || typeof a !== "object" || typeof (a as AuditSuiteEntry).name !== "string") {
      throw createScaiError(
        "Each audit suite entry must be a mapping with a 'name' string.",
        "CONFIG_INVALID"
      );
    }
  }
  logger?.verbose(`Loaded audit suite '${suite.name}' with ${suite.audits.length} audits.`);
  return suite as AuditSuiteFile;
};

/**
 * Substitute templated tokens in an output path.
 *   {date}       — YYYY-MM-DD
 *   {datetime}   — YYYY-MM-DDTHH-mm-ss
 *   {env}        — environment name
 *   {suite}      — suite name
 */
export const expandOutputPath = (
  template: string,
  context: { envName: string; suiteName: string; now?: Date }
): string => {
  const now = context.now ?? new Date();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const datetime = `${date}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return template
    .replace(/\{date\}/g, date)
    .replace(/\{datetime\}/g, datetime)
    .replace(/\{env\}/g, context.envName)
    .replace(/\{suite\}/g, context.suiteName);
};

/**
 * Convert audit suite entries to the option shape `runAuditAll`
 * expects. The suite declares one entry per audit with free-form
 * options; `runAuditAll` takes a flat options object with `include`
 * (which audits) and shared defaults.
 *
 * Because `runAuditAll` shares one option object across all sub-audits,
 * per-audit option overrides aren't directly expressible — operators
 * who need per-audit knobs run them individually rather than through
 * a suite. The suite covers the common "run this set with these
 * shared options" case.
 *
 * Returns the suite's audit names plus the merged shared options.
 */
export const auditSuiteToRunnerInput = (
  suite: AuditSuiteFile
): { include: string[]; sharedOptions: Record<string, unknown> } => {
  const include = suite.audits.map((a) => a.name);
  // Merge per-audit options into one shared bag. Conflicts are last-wins.
  const sharedOptions: Record<string, unknown> = {};
  for (const a of suite.audits) {
    if (!a.options) continue;
    for (const [key, value] of Object.entries(a.options)) {
      const camel = toCamelCase(key);
      sharedOptions[camel] = value;
    }
  }
  return { include, sharedOptions };
};

const toCamelCase = (key: string): string =>
  key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

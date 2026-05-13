import { Logger } from "@/shared/logger";
import { createCliError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { type EnvironmentConfiguration, type RootConfiguration } from "@/config";
import { createHygieneApiClient, type HygieneApiClient } from "../api/client";

/**
 * Shared option shape, tenant resolution, and link-extraction helpers for
 * `scai audit` + `scai cleanup` tasks. Both groups read through the same
 * Authoring API client and produce JSON-shaped results.
 */

export interface HygieneCommonOptions {
  config?: string;
  environmentName?: string;
  verbose?: boolean;
  trace?: boolean;
  quiet?: boolean;
  json?: boolean;
  logFile?: string;
  nonInteractive?: boolean;
}

export const toLogger = (options: HygieneCommonOptions): Logger =>
  new Logger(
    Boolean(options.verbose),
    Boolean(options.trace),
    Boolean(options.json),
    Boolean(options.quiet),
    options.logFile ?? process.env.SITECOREAI_LOG_FILE
  );

export interface ResolvedHygieneTenant {
  envName: string;
  environment: EnvironmentConfiguration;
  root: RootConfiguration;
  client: HygieneApiClient;
}

export const resolveTenant = (options: HygieneCommonOptions): ResolvedHygieneTenant => {
  const { envName, environment, root, timeoutMs } = resolveEnvironment(options);
  const client = createHygieneApiClient({
    environment,
    request: { timeoutMs },
  });
  return { envName, environment, root, client };
};

/** Print either a JSON envelope (when `--json`) or a heading + items table. */
export interface PrintReportOptions<T> {
  logger: Logger;
  command: string;
  envName: string;
  results: T[];
  /** Returns one human-readable line per result for non-JSON output. */
  formatLine: (item: T) => string;
  /** Optional headline shown above the list. Defaults to `${results.length} item(s) found`. */
  summary?: string;
  extra?: Record<string, unknown>;
}

export const printReport = <T>({
  logger,
  command,
  envName,
  results,
  formatLine,
  summary,
  extra,
}: PrintReportOptions<T>): void => {
  if (logger.isJson()) {
    logger.json({
      command,
      environment: envName,
      ...extra,
      count: results.length,
      results,
    });
    return;
  }
  const headline = summary ?? `${results.length} item${results.length === 1 ? "" : "s"} found.`;
  logger.info(headline, results.length === 0 ? "green" : "yellow");
  for (const item of results) {
    logger.info(`  - ${formatLine(item)}`);
  }
};

/** Normalize a Sitecore itemId to lowercase, no dashes, no braces (search-index form). */
export const normalizeItemId = (raw: string): string => raw.toLowerCase().replace(/[{}-]/g, "");

/** Dashify a flat 32-char itemId back to canonical 8-4-4-4-12. */
export const dashifyItemId = (flat: string): string => {
  const norm = flat.replace(/[-{}]/g, "");
  if (norm.length !== 32) return flat;
  return `${norm.slice(0, 8)}-${norm.slice(8, 12)}-${norm.slice(12, 16)}-${norm.slice(16, 20)}-${norm.slice(20)}`;
};

/**
 * Extract internal Sitecore itemId references from a field value.
 *
 * Recognises three field-value shapes:
 *
 *   1. Bare GUID — `{11111111-...}` or unwrapped uuid. Used by single-item-ref
 *      fields (Droplink, General Link, Droptree, etc.).
 *   2. Pipe-delimited GUIDs — `{guid1}|{guid2}|...`. Used by Multilist
 *      (Treelist, Multilist, TreelistEx, MultilistEx).
 *   3. RichText `<link>` tags — `<link linktype="internal" id="{guid}" ...>`
 *      (Sitecore RichText editor inserts internal links this way).
 *      External (`linktype="external"`) and media (`linktype="media"`) tags
 *      are ignored at this layer — media refs are surfaced separately by
 *      `extractMediaReferences`.
 *
 * Returns normalized lowercase no-dash itemIds (search-index form) so a
 * Set<string> comparison with `_path` / `parentId` fields from search results
 * compares clean.
 */
export const extractInternalRefs = (value: string): string[] => {
  if (!value) return [];
  const refs: string[] = [];
  const guidPattern =
    /\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?/gi;
  let match: RegExpExecArray | null;
  while ((match = guidPattern.exec(value))) {
    refs.push((match[1] + match[2] + match[3] + match[4] + match[5]).toLowerCase());
  }
  return refs;
};

/**
 * Extract media item references — refs that point at items under the
 * `/sitecore/media library` tree.
 *
 * Recognises:
 *   1. RichText `<link linktype="media" id="{guid}" />` tags.
 *   2. Image-field XML — `<image mediaid="{guid}" ...>` (Sitecore's Image
 *      field stores this XML in field values).
 *   3. Bare GUIDs in Multilist-style fields targeting media items (caller
 *      passes those through `extractInternalRefs` and resolves against the
 *      media library at a higher layer).
 *
 * Returns normalized itemIds. Callers de-dup with a Set; ordering is not
 * preserved.
 */
export const extractMediaRefs = (value: string): string[] => {
  if (!value) return [];
  const refs: string[] = [];
  // <link linktype="media" id="{guid}">
  const linkMediaPattern =
    /<link\b[^>]*\blinktype=["']?media["']?[^>]*\bid=["']?(\{?[0-9a-f-]{32,38}\}?)/gi;
  // <image mediaid="{guid}">  — the Sitecore Image field XML shape
  const imageFieldPattern = /<image\b[^>]*\bmediaid=["']?(\{?[0-9a-f-]{32,38}\}?)/gi;
  for (const pattern of [linkMediaPattern, imageFieldPattern]) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(value))) {
      const guid = m[1].replace(/[{}-]/g, "").toLowerCase();
      if (guid.length === 32) refs.push(guid);
    }
  }
  return refs;
};

/**
 * Build a SearchStatement that limits results to descendants of the given
 * itemId (i.e. items whose `_path` indexed field contains the ancestor's
 * itemId). Used to scope audits to a sub-tree.
 */
export const buildPathFilterStatement = (
  ancestorItemId: string
): { criteria: { field: string; value: string; criteriaType: "CONTAINS" } } => ({
  criteria: {
    field: "_path",
    value: normalizeItemId(ancestorItemId),
    criteriaType: "CONTAINS",
  },
});

/**
 * Sitecore-controlled item paths that audits should skip by default.
 *
 * `/sitecore/system` and `/sitecore/templates/System` carry hundreds of
 * thousands of platform-supplied items that aren't user-authored and
 * aren't actionable hygiene targets. Without this filter, `audit
 * broken-links list` and `audit stale-workflow list` would surface
 * platform noise that the operator can't fix.
 *
 * Operators can opt in to scanning system items with `--include-system`.
 */
export const SYSTEM_PATH_PREFIXES = [
  "/sitecore/system",
  "/sitecore/layout/Layouts/System",
  "/sitecore/templates/System",
  "/sitecore/templates/Branches/System",
];

export const isSystemPath = (path: string): boolean =>
  SYSTEM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

export const ensureAllowWriteForCleanup = (
  root: RootConfiguration,
  envName: string,
  override?: boolean
): void => {
  const env = root.environments[envName];
  if (override || env?.allowWrite) return;
  const envKey = envName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  throw createCliError(
    `Environment ${envName} is not configured to allow writing data.`,
    "INPUT_INVALID",
    {
      hint: `Set allowWrite in sitecoreai.cli.json, set SITECOREAI_ENV_${envKey}_ALLOW_WRITE=true, or pass --allow-write.`,
    }
  );
};

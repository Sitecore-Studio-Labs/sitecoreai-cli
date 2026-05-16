import { Logger } from "@/shared/logger";
import { createScaiError } from "@/shared/errors";
import { resolveEnvironment } from "@/shared/env";
import { mapWithConcurrency } from "@/shared/cli-tasks";
import { buildScaiEnvelope } from "@/shared/envelope";
import type { EnvironmentConfiguration, RootConfiguration } from "@/config/types";
import { createHygieneApiClient, type HygieneApiClient } from "../api/client";
import {
  createFieldCache,
  isAuditCacheEnabled,
  wrapFieldsBatchWithCache,
  type FieldCache,
} from "../cache";
import { openBaseline, splitByBaseline, type BaselineHandle } from "../baseline";
import {
  inferFormatFromExtension,
  writeAuditOutput,
  type AuditEnvelope,
  type OutputFormat,
} from "../output-adapters";
import path from "node:path";

/**
 * Shared option shape, tenant resolution, and link-extraction helpers for
 * `scai hygiene audit` + `scai hygiene cleanup` tasks. Both groups read through the same
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
  /**
   * The audit's task options. When provided, enables baseline
   * filtering (`options.baseline`), output redirect (`options.output`),
   * and format selection (`options.format`). Each audit passes its
   * own `options` object through.
   */
  options?: {
    baseline?: boolean;
    output?: string;
    format?: OutputFormat;
    config?: string;
    environmentName?: string;
  };
}

export const printReport = <T>(params: PrintReportOptions<T>): void => {
  finishAudit({ ...params, auditName: deriveAuditName(params.command) });
};

/**
 * Extended print helper used by every audit task runner. Adds:
 *
 *   - **Baseline filtering** (`options.baseline`): splits findings
 *     into "new" vs. "ignored" using the per-env baseline file.
 *   - **Output redirection** (`options.output` / `options.format`):
 *     writes a serialized report to a file instead of (or in
 *     addition to) printing the JSON envelope to stdout.
 *
 * `auditName` is the bare audit slug used as the baseline key
 * (e.g. `"broken-links"`). Without it, the `--baseline` flag is a
 * no-op with a warning.
 */
export interface FinishAuditOptions<T> extends PrintReportOptions<T> {
  /** Bare audit name (e.g. "broken-links"). Required for baseline filtering. */
  auditName?: string;
  /**
   * Pass `options.baseline`, `options.output`, `options.format`, plus
   * `options.config` through here so this helper can locate the
   * baseline file and the output target.
   */
  options?: {
    baseline?: boolean;
    output?: string;
    format?: OutputFormat;
    config?: string;
    environmentName?: string;
  };
}

const deriveAuditName = (command: string): string | undefined => {
  // command shape: "audit.<name>.<verb>" e.g. "audit.broken-links.list"
  const m = /^audit\.([^.]+)\./.exec(command);
  return m?.[1];
};

const resolveConfigDir = (config: string | undefined): string => {
  if (!config) return process.cwd();
  if (config.endsWith(".json")) return path.dirname(config);
  return config;
};

export const finishAudit = <T>(params: FinishAuditOptions<T>): void => {
  const { logger, command, envName, formatLine, summary, extra, options, auditName } = params;
  let results = params.results;
  let ignoredCount = 0;
  // Total accepted entries for this audit across all runs — surfaced
  // even when --baseline isn't set, so operators discover the baseline
  // exists and know how many findings are already accepted.
  let baselineAcceptedTotal: number | undefined;

  // Open the baseline once if we know the audit name. `openBaseline`
  // is cheap when the file doesn't exist (returns an empty in-memory
  // baseline), so the unconditional open here costs ~ms on the warm
  // path. Both behaviors — filtering on `--baseline` and surfacing
  // accepted counts on every run — share the same handle.
  if (auditName) {
    try {
      const baseline = openBaseline({
        envName,
        configDir: resolveConfigDir(options?.config),
        logger,
      });
      const snapshot = baseline.snapshot();
      const acceptedForThisAudit = snapshot.ignored[auditName]?.length ?? 0;
      if (acceptedForThisAudit > 0) {
        baselineAcceptedTotal = acceptedForThisAudit;
      }
      if (options?.baseline) {
        const split = splitByBaseline(auditName, results as unknown[], baseline);
        results = split.kept as T[];
        ignoredCount = split.ignored.length;
      }
    } catch (error) {
      logger.warn(
        `Failed to apply baseline filter for '${auditName}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else if (options?.baseline && !auditName) {
    logger.warn(
      `--baseline requested but the audit command name '${command}' doesn't map to a baseline key.`
    );
  }

  // Build the canonical `ScaiEnvelope` shape — `data` (not `results`)
  // for the primary payload; `meta` collects command-specific extras
  // that don't have a structured slot. Pre-2026-05-14 this surface
  // emitted `results` while deploy emitted `result`; the unification
  // lets agents parse one shape across every CLI command.
  const envelope = buildScaiEnvelope({
    command,
    environment: envName,
    data: results,
    extra: {
      ...(extra ?? {}),
      count: results.length,
      ...(ignoredCount > 0 ? { ignoredCount } : {}),
      ...(baselineAcceptedTotal !== undefined ? { baselineAcceptedTotal } : {}),
    },
  });

  // Output adapter: --output writes serialised report to file.
  const explicitFormat = options?.format;
  const inferredFormat = options?.output ? inferFormatFromExtension(options.output) : undefined;
  const format: OutputFormat = explicitFormat ?? inferredFormat ?? "json";

  if (options?.output) {
    // ScaiEnvelope is structurally compatible with AuditEnvelope but
    // lacks the latter's `[key: string]: unknown` index signature;
    // cast widens the type without changing the runtime shape.
    writeAuditOutput(envelope as unknown as AuditEnvelope, { format, output: options.output });
    if (!logger.isJson()) {
      logger.info(
        `Wrote ${options.output} (${envelope.count} finding${envelope.count === 1 ? "" : "s"}${
          ignoredCount > 0 ? `, ${ignoredCount} ignored by baseline` : ""
        }).`,
        "green"
      );
    }
    return;
  }

  // Stdout path — same as the original printReport behavior.
  if (logger.isJson()) {
    logger.json(envelope);
    return;
  }
  const headline = summary ?? `${results.length} item${results.length === 1 ? "" : "s"} found.`;
  logger.info(headline, results.length === 0 ? "green" : "yellow");
  if (ignoredCount > 0) {
    logger.info(`  (${ignoredCount} ignored by baseline)`, "gray");
  }
  // Always surface the per-audit baseline size — even when the operator
  // didn't pass --baseline. The agent feedback called out that baseline
  // is underused because it's invisible; showing the count nudges
  // operators toward it. Skip when --baseline is on (the ignoredCount
  // line above already says what got filtered).
  if (baselineAcceptedTotal !== undefined && !options?.baseline) {
    logger.info(
      `  (${baselineAcceptedTotal} finding${baselineAcceptedTotal === 1 ? "" : "s"} in baseline; pass --baseline to filter, or 'scai hygiene audit baseline accept --audit ${auditName} --from-stdin' to add more)`,
      "gray"
    );
  }
  for (const item of results) {
    logger.info(`  - ${formatLine(item)}`);
  }
};

export type { BaselineHandle };

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

/**
 * Resolved performance knobs for hygiene audits. Reads precedence:
 *
 *   1. Explicit per-call option (when `--concurrency` / `--batch-size`
 *      is passed on the command line).
 *   2. Environment variable (`SITECOREAI_HYGIENE_CONCURRENCY`,
 *      `SITECOREAI_HYGIENE_BATCH_SIZE`, `SITECOREAI_HYGIENE_PAGE_PARALLELISM`).
 *   3. Built-in defaults — biased toward parallelism since XM Cloud
 *      tolerates moderate fan-out and the transport already absorbs
 *      429/503 backoff.
 *
 * Defaults vs. the original 4/25:
 *   - concurrency 8 (was 4) — doubles field-read throughput.
 *   - batchSize 50 (was 25) — halves the number of aliased queries
 *     for the same item set; payload stays under the typical 1-2MB
 *     GraphQL request cap.
 *   - pageParallelism 4 (was 1, i.e. serial) — once the first page
 *     reveals totalCount, fetch up to 4 page-windows concurrently.
 *
 * Operators can dial these down for restricted tenants or up for
 * faster cold runs.
 */
export interface HygienePerfKnobs {
  concurrency: number;
  batchSize: number;
  pageParallelism: number;
}

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
};

export const resolveHygieneKnobs = (options: {
  concurrency?: number;
  batchSize?: number;
  pageParallelism?: number;
}): HygienePerfKnobs => ({
  concurrency: options.concurrency ?? parseIntEnv(process.env.SITECOREAI_HYGIENE_CONCURRENCY, 8),
  batchSize: options.batchSize ?? parseIntEnv(process.env.SITECOREAI_HYGIENE_BATCH_SIZE, 50),
  pageParallelism:
    options.pageParallelism ?? parseIntEnv(process.env.SITECOREAI_HYGIENE_PAGE_PARALLELISM, 4),
});

/**
 * Sitecore field names that hold layout rendering XML. These are the
 * fields parsed by `extractRenderingDatasources` and
 * `extractPersonalizationVariantRefs`.
 *
 * - `__Renderings`        — shared (multi-language) presentation layer.
 * - `__Final Renderings`  — per-language presentation overlay.
 * - `__Renderings (Page)` — page-design-tier layout (rare; only on Page
 *                           Design items).
 */
export const RENDERING_FIELDS = ["__Renderings", "__Final Renderings", "__Renderings (Page)"];

export const isRenderingField = (fieldName: string): boolean =>
  RENDERING_FIELDS.includes(fieldName);

/**
 * Extract datasource references from a rendering-layout XML value.
 *
 * Sitecore stores rendering presentation as XML like:
 *
 *   <r uid="{...}" id="{rendering-id}" ds="/sitecore/content/Home/DS"
 *      s:ds="{...}" par="..." />
 *
 * The `ds` (or sometimes `s:ds`) attribute on each `<r>` element holds
 * the datasource — either a content-tree path, a bare itemId, or a
 * Sitecore query (`query:./ancestor-or-self::*[@@templatename='Site']/Data`).
 * Queries are dynamic; they're returned with a `query:` prefix so the
 * caller can decide whether to skip them. Empty `ds` values are
 * omitted from the result.
 *
 * Returns values verbatim (path / itemId / `query:…`) for the caller to
 * resolve.
 */
export const extractRenderingDatasources = (
  renderingsXml: string
): Array<{ datasource: string; renderingId: string | null }> => {
  if (!renderingsXml) return [];
  const out: Array<{ datasource: string; renderingId: string | null }> = [];
  // Match every <r ...> element start tag — attribute order is unstable.
  const rPattern = /<r\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = rPattern.exec(renderingsXml))) {
    const attrs = m[1];
    // Prefer `s:ds` if present, fall back to bare `ds`. Some tenants
    // emit both with the namespaced form taking precedence at runtime.
    const dsMatch = /\bs?:?ds=["']([^"']*)["']/i.exec(attrs);
    if (!dsMatch || !dsMatch[1]) continue;
    const idMatch = /\bs?:?id=["']([^"']*)["']/i.exec(attrs);
    out.push({
      datasource: dsMatch[1],
      renderingId: idMatch?.[1] ?? null,
    });
  }
  return out;
};

/**
 * Extract personalization variant + rule references from a rendering-layout
 * XML value.
 *
 * Personalization is stored in `<rules>` elements nested under `<r>`:
 *
 *   <r ...>
 *     <rules s:set="{xyz}">
 *       <rule s:uid="{...}" s:name="..." s:templateid="{variant-tid}">
 *         <conditions>...</conditions>
 *         <actions>
 *           <action id="{...}" datasource="{variant-itemId}" />
 *         </actions>
 *       </rule>
 *     </rules>
 *   </r>
 *
 * Returns refs found in `datasource=` attributes of `<action>` elements
 * AND in rule `s:set=` attributes (the rule-set itemId).
 */
export const extractPersonalizationRefs = (renderingsXml: string): string[] => {
  if (!renderingsXml) return [];
  const refs: string[] = [];
  const actionDs = /<action\b[^>]*\bdatasource=["']([^"']*)["']/gi;
  const ruleSet = /<rules\b[^>]*\bs:set=["']([^"']*)["']/gi;
  for (const pattern of [actionDs, ruleSet]) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(renderingsXml))) {
      if (m[1]) refs.push(m[1]);
    }
  }
  return refs;
};

/**
 * Compute a content hash over an item's authored fields, suitable for
 * exact-duplicate detection.
 *
 * Includes only authored fields (not `__`-prefixed system fields, which
 * carry per-item metadata like `__Created`, `__Updated`, `__Lock`).
 * Field name + trimmed value joined by `\0`, fields sorted by name for
 * determinism. SHA-256, returned as 16-char hex (sufficient to bucket
 * tenant-scale item counts without realistic collision).
 */
export const computeContentHash = async (
  fields: ReadonlyArray<{ name: string; value: string }>,
  options: { includeSystem?: boolean } = {}
): Promise<string> => {
  const crypto = await import("node:crypto");
  const filtered = fields
    .filter((f) => options.includeSystem || !f.name.startsWith("__"))
    .map((f) => ({ name: f.name, value: (f.value ?? "").trim() }))
    .filter((f) => f.value.length > 0);
  // An item with no authored content has nothing to fingerprint. Return
  // empty string so callers' `if (!hash) continue;` correctly skips it —
  // otherwise every empty item shares sha256("") = "e3b0c44298fc1c14",
  // bucketing unrelated blank items into a single false-positive
  // "duplicate group" in `audit duplicates`.
  if (filtered.length === 0) return "";
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  const input = filtered.map((f) => `${f.name}\0${f.value}`).join("");
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
};

/**
 * Sitecore's `__Final Page Design` (or fallback `__Page Design`) field
 * holds a page design itemId GUID. Empty string means "inherit from
 * ancestor / no override."
 */
export const PAGE_DESIGN_FIELDS = ["__Final Page Design", "__Page Design"];

export const isPageDesignField = (fieldName: string): boolean =>
  PAGE_DESIGN_FIELDS.includes(fieldName);

/**
 * Common scan-then-fetch pipeline used by every field-reading audit.
 *
 * Combines:
 *   1. Root-path → itemId resolution (one search call).
 *   2. Paged enumeration via `searchAll(parallel: knobs.pageParallelism)`,
 *      with system-path filter applied at gather time.
 *   3. Batched field reads with bounded concurrency (`knobs.concurrency`)
 *      and `knobs.batchSize` per aliased GraphQL query.
 *   4. Optional cross-audit field cache (opt-in via `--cache` / env).
 *
 * Returns the scanned item set and the fields-by-itemId map. The cache
 * is also returned so callers can `await cache.flush()` at audit end.
 *
 * Callers that DON'T need fields (e.g. `audit dead-templates` enumerates
 * templates, not field-bearing items) should not use this helper.
 */
export interface ScanItem {
  itemId: string;
  path: string;
  name: string;
  templateName: string | null;
  templateId: string | null;
  language: string | null;
  version: number | null;
  createdDate: string | null;
  updatedDate: string | null;
}

export interface ScanFieldsResult {
  scanned: ScanItem[];
  fieldsByItemId: Map<string, ItemFieldRecord[] | null>;
  cache: FieldCache | null;
  knobs: HygienePerfKnobs;
}

export interface ItemFieldRecord {
  fieldId: string;
  name: string;
  value: string;
}

export interface ScanItemsAndFieldsParams {
  client: import("../api/client").HygieneApiClient;
  envName: string;
  root: string;
  logger: Logger;
  options: HygieneCommonOptions & {
    limit?: number;
    batchSize?: number;
    concurrency?: number;
    pageParallelism?: number;
    includeSystem?: boolean;
    language?: string;
    index?: string;
    cache?: boolean;
    /** Repeatable: skip items whose path starts with any of these. */
    exclude?: string[];
    /** ISO date (YYYY-MM-DD or full ISO): only items updated on/after this date. */
    since?: string;
    /** Filter by createdBy or updatedBy. */
    owner?: string;
  };
  /** Override `latestVersionOnly` on the search. Default true. */
  latestVersionOnly?: boolean;
  /** Skip the field-fetch phase entirely (returns empty fields map). */
  skipFields?: boolean;
}

/**
 * Cross-cutting result-filter helpers — applied during the
 * enumeration phase before items are accumulated. Exposed here so
 * audits that don't go through `scanItemsAndFields` (orphans,
 * dead-templates) can re-use the same predicates.
 */
export interface ScanFilters {
  excludePaths?: string[];
  sinceMs?: number;
  owner?: string;
}

export const resolveScanFilters = (options: {
  exclude?: string[];
  since?: string;
  owner?: string;
}): ScanFilters => {
  const excludePaths = options.exclude?.length
    ? options.exclude.map((p) => p.toLowerCase()).filter((p) => p.length > 0)
    : undefined;
  let sinceMs: number | undefined;
  if (options.since) {
    const ts = Date.parse(options.since);
    if (Number.isFinite(ts)) sinceMs = ts;
    else
      throw createScaiError(
        `--since '${options.since}' is not a valid ISO date.`,
        "INPUT_INVALID",
        { hint: "Use YYYY-MM-DD or a full ISO 8601 timestamp." }
      );
  }
  return { excludePaths, sinceMs, owner: options.owner };
};

/** Returns true if the search result should be excluded by the filters. */
export const matchesScanFilters = (
  r: { path?: string; updatedDate?: string | null; createdDate?: string | null },
  filters: ScanFilters
): boolean => {
  if (filters.excludePaths) {
    const p = r.path?.toLowerCase() ?? "";
    if (filters.excludePaths.some((e) => p.startsWith(e))) return false;
  }
  if (filters.sinceMs !== undefined) {
    const t = r.updatedDate ? Date.parse(r.updatedDate) : NaN;
    if (!Number.isFinite(t) || t < filters.sinceMs) return false;
  }
  // The owner filter is harder — `createdBy` / `updatedBy` aren't on
  // SearchResultItem. Defer to the audit task layer when needed; we
  // can't filter here without a per-item Authoring API call. (Kept on
  // the interface so the helper signature is forward-compatible.)
  return true;
};

export const scanItemsAndFields = async ({
  client,
  envName,
  root,
  logger,
  options,
  latestVersionOnly = true,
  skipFields = false,
}: ScanItemsAndFieldsParams): Promise<ScanFieldsResult> => {
  const knobs = resolveHygieneKnobs(options);
  const cacheEnabled = options.cache ?? isAuditCacheEnabled();
  const cache = cacheEnabled ? createFieldCache({ envName, logger }) : null;
  const limit = options.limit ?? 5000;
  const includeSystem = Boolean(options.includeSystem);
  const filters = resolveScanFilters({
    exclude: options.exclude,
    since: options.since,
    owner: options.owner,
  });

  // Resolve root path → itemId.
  let rootItemId: string | undefined;
  if (root) {
    const r = await client.search({
      index: options.index,
      paging: { pageSize: 1 },
      searchStatement: {
        criteria: { field: "_fullpath", value: root.toLowerCase(), criteriaType: "EXACT" },
      },
    });
    rootItemId = r.results[0]?.itemId;
    if (!rootItemId) {
      logger.warn(`Root path '${root}' not found in search index — scanning entire master DB.`);
    }
  }

  // Paged enumeration with optional parallel page-windows.
  const scanned: ScanItem[] = [];
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly,
      ...(options.language && { language: options.language }),
      ...(rootItemId && { searchStatement: buildPathFilterStatement(rootItemId) }),
    },
    100,
    knobs.pageParallelism
  )) {
    if (!includeSystem && isSystemPath(r.path)) continue;
    if (!matchesScanFilters(r, filters)) continue;
    scanned.push({
      itemId: normalizeItemId(r.itemId),
      path: r.path,
      name: r.name,
      templateName: r.templateName ?? null,
      templateId: r.templateId ?? null,
      language: r.language?.name ?? null,
      version: r.version ?? null,
      createdDate: r.createdDate ?? null,
      updatedDate: r.updatedDate ?? null,
    });
    if (scanned.length >= limit) break;
  }
  logger.verbose(
    `Scanned ${scanned.length} items (concurrency=${knobs.concurrency}, batchSize=${knobs.batchSize}, pageParallel=${knobs.pageParallelism}${cache ? ", cache=on" : ""}).`
  );

  // Skip the field-fetch phase if caller doesn't need fields.
  if (skipFields) {
    return { scanned, fieldsByItemId: new Map(), cache, knobs };
  }

  // Build per-item updatedDate map for cache freshness.
  const updatedDateByItemId = new Map<string, string | null>();
  for (const s of scanned) updatedDateByItemId.set(s.itemId, s.updatedDate);

  // Choose the underlying fetcher — either direct, or cache-wrapped.
  const getFieldsBatch = cache
    ? wrapFieldsBatchWithCache((ids) => client.getItemFieldsBatch(ids), cache, updatedDateByItemId)
    : (ids: readonly string[]) => client.getItemFieldsBatch(ids);

  // Batch + fan out.
  const batches: string[][] = [];
  for (let i = 0; i < scanned.length; i += knobs.batchSize) {
    batches.push(scanned.slice(i, i + knobs.batchSize).map((s) => s.itemId));
  }
  const batchResults = await mapWithConcurrency(
    batches,
    (ids) => getFieldsBatch(ids),
    knobs.concurrency
  );
  const fieldsByItemId = new Map<string, ItemFieldRecord[] | null>();
  for (const m of batchResults) {
    for (const [id, fields] of m) fieldsByItemId.set(id, fields ?? null);
  }
  if (cache) {
    const stats = cache.stats();
    logger.verbose(
      `Cache stats: ${stats.hits} hits / ${stats.misses} misses (${stats.size} stored).`
    );
  }
  return { scanned, fieldsByItemId, cache, knobs };
};

export { ensureAllowWrite as ensureAllowWriteForCleanup } from "@/shared/allow-write";

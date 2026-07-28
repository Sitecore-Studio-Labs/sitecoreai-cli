import { mapWithConcurrency } from "@/shared/cli-tasks";
import { sleep } from "@/shared/concurrency";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";

/**
 * Patterns in GraphQL `errors[].message` payloads that we treat as
 * transient and retry. Sitecore returns 200-with-errors for several
 * server-side failures the HTTP retry path never sees:
 *
 *   - "Service Unavailable" / "service is currently unavailable" — the
 *     search backend restarted or is rolling.
 *   - "timeout" / "took too long" — query was killed by the gateway
 *     before the search index responded.
 *   - "transient" / "try again" — explicit retry hints from the API.
 *   - "circuit breaker" — internal fault tolerance kicked in.
 *
 * The matches are intentionally permissive: a false-positive retry on
 * a permanent error wastes time but doesn't corrupt state — the read
 * surface is idempotent.
 */
const TRANSIENT_GRAPHQL_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /service\s+(is\s+)?(currently\s+)?unavailable/i,
  /\btransient\b/i,
  /\btry\s+again\b/i,
  /\bcircuit\s+breaker\b/i,
  /\btime(?:d)?\s*out\b/i,
  /took\s+too\s+long/i,
];

const isTransientError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return TRANSIENT_GRAPHQL_ERROR_PATTERNS.some((p) => p.test(error.message));
};

/**
 * "The search service is not available" — the environment has no search
 * index provisioned. Unlike the transient patterns above this never
 * clears on retry: dead-templates simply cannot run without search.
 */
const isSearchUnavailableError = (error: unknown): boolean =>
  error instanceof Error && /search service is not available/i.test(error.message);

/**
 * Wrap a read operation in transient-aware retry. The shared HTTP
 * transport already retries 503/429 and friends, but Sitecore's search
 * service surfaces some failures as 200-with-`errors` payloads which
 * the transport throws as `ScaiError("NETWORK")` — no retry. This
 * helper catches those, matches against `TRANSIENT_GRAPHQL_ERROR_PATTERNS`,
 * and retries with exponential backoff.
 */
const retryOnTransient = async <T>(
  op: () => Promise<T>,
  opts: {
    attempts: number;
    baseDelayMs: number;
    logger: ReturnType<typeof toLogger>;
    label: string;
  }
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    if (attempt > 0) {
      const delay = Math.min(15_000, opts.baseDelayMs * 2 ** (attempt - 1));
      opts.logger.verbose(
        `Retry ${attempt}/${opts.attempts - 1} for ${opts.label} after ${delay}ms (transient error).`
      );
      await sleep(delay);
    }
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error)) break;
    }
  }
  throw lastError;
};

export interface AuditDeadTemplatesOptions extends HygieneCommonOptions {
  /**
   * Template-tree root to scan. Default `/sitecore/templates` —
   * the templates root. By default the scan excludes `System/` and
   * `Branches/System/` subtrees (set `--include-system` to include).
   */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on the number of templates inspected. Default 5000. */
  limit?: number;
  /** Concurrency for per-template item-count checks. Default 8. */
  concurrency?: number;
  /**
   * Include System / platform templates (`/sitecore/templates/System`,
   * `/sitecore/templates/Branches/System`) in the scan. Off by default —
   * these are platform-internal and aren't actionable cleanup targets.
   */
  includeSystem?: boolean;
}

const SYSTEM_TEMPLATE_PREFIXES = ["System/", "Branches/System/"];

export interface DeadTemplateReport {
  templateId: string;
  name: string;
  fullName: string | null;
  /**
   * Number of items in the master DB that derive from this template.
   * Zero items → dead template, safe to delete (subject to inbound base-template
   * references; the cleanup command surfaces those at delete time).
   */
  itemCount: number;
}

/**
 * Audit a template tree for templates with zero items based on them.
 *
 * Strategy:
 *   1. List all templates under `--root` via the `itemTemplates`
 *      Authoring query (paged).
 *   2. For each template, run a small search (`_template: <templateId>`)
 *      that ignores standard-values items (templates ship a SV item under
 *      themselves; that's not a "real" usage). Fastest cap-at-1 page.
 *   3. Emit a row for every template with zero items.
 *
 * Output is sorted by fullName for stable diffs across runs.
 */
export const runAuditDeadTemplates = async (
  options: AuditDeadTemplatesOptions
): Promise<DeadTemplateReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  // Default to `/sitecore/templates` rather than `/sitecore/templates/Project`
  // because non-SXA tenants don't have a `Project` folder. `/sitecore/templates`
  // is universal; SYSTEM_PATH_PREFIXES filtering removes `/sitecore/templates/System`
  // descendants from the scan unless --include-system is passed.
  const root = options.root ?? "/sitecore/templates";
  const limit = options.limit ?? 5000;
  const concurrency = options.concurrency ?? 8;

  logger.verbose(`Listing templates under ${root} (limit ${limit}).`);

  const includeSystem = Boolean(options.includeSystem);
  let raw: Awaited<ReturnType<typeof client.listItemTemplates>>;
  try {
    raw = await client.listItemTemplates({ rootPath: root });
  } catch (error) {
    if (!isSearchUnavailableError(error)) {
      throw error;
    }
    // No search index on this environment — dead-templates can't run.
    // Point the caller at the traversal-based audits that can.
    throw createScaiError(
      "The dead-templates audit needs a provisioned search index, which this environment does not have.",
      "NETWORK",
      {
        hint: "Use a traversal-based audit — it does not depend on a search index.",
        remediation: {
          actor: "agent",
          fix: `scai hygiene audit heavy-templates list --root ${root}`,
          detail:
            "heavy-templates (and the content_browse MCP tool) walk the item tree directly and work without a search index; dead-templates cannot.",
        },
      }
    );
  }
  const filtered = includeSystem
    ? raw
    : raw.filter((t) => {
        const fn = t.fullName ?? "";
        return !SYSTEM_TEMPLATE_PREFIXES.some((p) => fn.startsWith(p));
      });
  const bounded = filtered.slice(0, limit);
  if (bounded.length === 0) {
    logger.warn(`No templates found under '${root}' (after system-filter).`);
  }
  logger.verbose(
    `Listed ${raw.length} templates; ${bounded.length} after filtering (system=${includeSystem}).`
  );

  type Check = { template: (typeof bounded)[number]; itemCount: number };
  const checks: Check[] = await mapWithConcurrency(
    bounded,
    async (template) => {
      const value = normalizeItemId(template.templateId);
      const runSearch = (): Promise<{ totalCount: number; results: unknown[] }> =>
        client.search({
          index: options.index,
          latestVersionOnly: true,
          paging: { pageSize: 1 },
          searchStatement: {
            operator: "SHOULD",
            subStatements: [
              {
                criteria: {
                  field: "_template",
                  value,
                  criteriaType: "EXACT",
                },
              },
              {
                criteria: {
                  field: "_basetemplates",
                  value,
                  criteriaType: "CONTAINS",
                },
              },
              {
                criteria: {
                  field: "__masters",
                  value,
                  criteriaType: "CONTAINS",
                },
              },
              {
                criteria: {
                  field: "datasource template",
                  value,
                  criteriaType: "CONTAINS",
                },
              },
            ],
          },
        });
      // Transient GraphQL errors ("Service Unavailable", "circuit
      // breaker", etc.) surface as 200-with-errors and bypass the
      // shared HTTP retry. Wrap the per-template search so one flaky
      // backend response doesn't kill an entire dead-templates run.
      const page = await retryOnTransient(runSearch, {
        attempts: 4,
        baseDelayMs: 1000,
        logger,
        label: `template ${template.fullName ?? template.name}`,
      });
      return { template, itemCount: page.totalCount };
    },
    concurrency
  );

  // A template is "dead" only when nothing — direct or inherited —
  // depends on it. The SHOULD query above OR's four signals:
  //   1. `_template = <id>` → items whose primary template IS this one.
  //      Sitecore typically excludes Standard Values from the index;
  //      where they leak in, count is 1 and the template is correctly
  //      NOT flagged as dead.
  //   2. `_basetemplates CONTAINS <id>` → templates that derive from
  //      this one through any depth of inheritance. SXA base
  //      templates (`Project`, `Experience Accelerator`) have zero
  //      direct items but many derived templates — without this check
  //      they would be misclassified as dead.
  //   3. `__masters CONTAINS <id>` → Standard-Values items whose
  //      Insert Options list this template as an allowed child.
  //      Deleting the template breaks the "Insert > <Name>" menu.
  //   4. `datasource template CONTAINS <id>` → Rendering items pinning
  //      this template as the datasource type. Deleting breaks
  //      "Create Local Datasource" in Pages / Experience Editor.

  const dead: DeadTemplateReport[] = checks
    .filter((c) => c.itemCount === 0)
    .map((c) => ({
      templateId: c.template.templateId,
      name: c.template.name,
      fullName: c.template.fullName,
      itemCount: 0,
    }))
    .sort((a, b) => (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name));

  printReport({
    logger,
    command: "audit.dead-templates.list",
    envName,
    results: dead,
    summary: `Inspected ${bounded.length} templates under ${root}; ${dead.length} dead.`,
    formatLine: (r) => `${r.fullName ?? r.name} (${r.templateId.slice(0, 8)})`,
    extra: { root, limit, scannedCount: bounded.length },
    options,
  });

  return dead;
};

import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

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
  const raw = await client.listItemTemplates({ rootPath: root });
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
      // Count items deriving from this template. We don't need the full
      // result set — a single page with totalCount is enough.
      //
      // Note: the Sitecore search index typically excludes Standard
      // Values items from `_template` indexing (they live under the
      // template itself and aren't real content). On tenants where SV
      // items DO appear, the count will be 1 for "dead" templates that
      // only have their SV item. The cleanup mutation `deleteItemTemplate`
      // succeeds anyway in that case — it cascades the SV deletion.
      // We err on the conservative side: count > 0 means "not flagged
      // as dead", reducing false positives.
      const page = await client.search({
        index: options.index,
        latestVersionOnly: true,
        paging: { pageSize: 1 },
        searchStatement: {
          criteria: {
            field: "_template",
            value: normalizeItemId(template.templateId),
            criteriaType: "EXACT",
          },
        },
      });
      return { template, itemCount: page.totalCount };
    },
    concurrency
  );

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

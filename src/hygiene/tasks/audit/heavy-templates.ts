import { mapWithConcurrency } from "@/shared/cli-tasks";
import {
  type HygieneCommonOptions,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  toLogger,
} from "../shared";

export interface AuditHeavyTemplatesOptions extends HygieneCommonOptions {
  /** Field-count threshold to flag a template as "heavy". Default 50. */
  threshold?: number;
  /** Template-tree root to scan. Default `/sitecore/templates`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
}

export interface HeavyTemplateReport {
  templateId: string;
  name: string;
  fullName: string | null;
  fieldCount: number;
}

const SYSTEM_TEMPLATE_PREFIXES = ["System/", "Branches/System/"];

/**
 * Audit templates with field counts above a threshold.
 *
 * Heavy templates correlate with slow editor rendering, expensive
 * standard-values fan-out, and brittle test fixtures. Default
 * threshold is 50 fields — a soft "this template is doing too many
 * things" signal.
 *
 * Strategy:
 *   1. List templates via the search index (`_template: <Template>`).
 *   2. For each, fetch field children via `getChildren` and count
 *      the ones that derive from `Template field` (templateId
 *      `455a3e98a627-4b40-8035-e683a0331ac7`).
 *      For simplicity, count any non-section child as a field —
 *      Sitecore templates have Section children which themselves
 *      contain Field children. The "real" field count is the sum
 *      across sections.
 *   3. Emit a row per template with count >= threshold.
 */
export const runAuditHeavyTemplates = async (
  options: AuditHeavyTemplatesOptions
): Promise<HeavyTemplateReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);
  const root = options.root ?? "/sitecore/templates";
  const threshold = options.threshold ?? 50;
  const knobs = resolveHygieneKnobs(options);
  const includeSystem = Boolean(options.includeSystem);

  const raw = await client.listItemTemplates({ rootPath: root });
  const candidates = includeSystem
    ? raw
    : raw.filter((t) => {
        const fn = t.fullName ?? "";
        return !SYSTEM_TEMPLATE_PREFIXES.some((p) => fn.startsWith(p));
      });
  const bounded = candidates.slice(0, options.limit ?? 5000);
  logger.verbose(`Listed ${raw.length} templates; ${bounded.length} after filtering.`);

  // For each template, count its fields by walking sections → fields.
  // Templates are structured: <template>/<section>/<field>.
  const reports: HeavyTemplateReport[] = (
    await mapWithConcurrency(
      bounded,
      async (t) => {
        const sections = await client.getChildren({ itemId: t.templateId });
        let fieldCount = 0;
        for (const section of sections) {
          const fields = await client.getChildren({ itemId: section.itemId });
          fieldCount += fields.length;
        }
        return fieldCount >= threshold
          ? {
              templateId: t.templateId,
              name: t.name,
              fullName: t.fullName,
              fieldCount,
            }
          : null;
      },
      knobs.concurrency
    )
  ).filter((r): r is HeavyTemplateReport => r !== null);

  reports.sort((a, b) => b.fieldCount - a.fieldCount);

  printReport({
    logger,
    command: "audit.heavy-templates.list",
    envName,
    results: reports,
    summary: `Inspected ${bounded.length} templates; ${reports.length} have >= ${threshold} fields.`,
    formatLine: (r) => `${r.fullName ?? r.name} — ${r.fieldCount} fields`,
    extra: { root, threshold, scannedCount: bounded.length },
    options,
  });

  return reports;
};

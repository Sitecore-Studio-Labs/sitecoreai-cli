import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "./shared";

/**
 * Inbound-reference kinds we currently surface.
 *
 *   - `primary-template`: items whose `_template` is the target. These
 *     are the items that would lose their template definition outright
 *     if the target were deleted — usually the dominant blocker.
 *
 *   - `base-template`: templates whose `_basetemplates` contains the
 *     target through any depth of inheritance. Deleting the target
 *     orphans every inheritor's inherited fields/sections.
 *
 *   - `insert-options`: Standard-Values items whose `__masters`
 *     contains the target. Deleting the target removes an entry from
 *     the parent template's Insert Options menu — content authors
 *     lose the ability to create that child type.
 *
 *   - `branch-source`: items (typically other templates / branch
 *     definitions) whose `__source` contains the target. Deleting
 *     breaks the "New from Branch" flow for that branch.
 *
 * Lower-priority kinds intentionally not covered yet (track separately):
 *   - Custom droplist/treelist fields whose `Source=` value resolves
 *     to the target's path. Requires per-field-definition scan.
 *   - Generic ID-bearing fields that happen to hold the target's GUID
 *     in their value. Requires a full-text scan.
 */
export type TemplateReferenceKind =
  | "primary-template"
  | "base-template"
  | "insert-options"
  | "branch-source";

export interface AuditTemplateDependenciesOptions extends HygieneCommonOptions {
  /** Target template ID — GUID in any standard form ({…}, dashes, flat). Required. */
  templateId?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on number of references per kind. Default 5000. */
  limit?: number;
  /** Skip a reference kind by name. Use to scope big tenants. */
  skip?: TemplateReferenceKind[];
}

export interface TemplateDependencyReport {
  itemId: string;
  path: string | null;
  name: string;
  templateId: string | null;
  templateName: string | null;
  /** Why this item references the target template. */
  referenceKind: TemplateReferenceKind;
}

const SEARCH_KINDS: Array<{
  kind: TemplateReferenceKind;
  field: string;
  criteriaType: "EXACT" | "CONTAINS";
}> = [
  { kind: "primary-template", field: "_template", criteriaType: "EXACT" },
  { kind: "base-template", field: "_basetemplates", criteriaType: "CONTAINS" },
  { kind: "insert-options", field: "__masters", criteriaType: "CONTAINS" },
  { kind: "branch-source", field: "__source", criteriaType: "CONTAINS" },
];

/**
 * Inverse of `audit dead-templates`: for a given template, list every
 * item in the tenant that points at it — primary template, inheritor,
 * insert-options host, branch source. Use this to triage what's
 * blocking a template delete *before* calling `cleanup dead-templates`
 * or running an ad-hoc delete.
 *
 * `audit dead-templates` answers "is X safe to delete?" in aggregate.
 * This answers "what specifically points at X?" with an actionable
 * list grouped by reference kind.
 */
export const runAuditTemplateDependencies = async (
  options: AuditTemplateDependenciesOptions
): Promise<TemplateDependencyReport[]> => {
  const logger = toLogger(options);
  const { envName, client } = resolveTenant(options);

  if (!options.templateId) {
    throw createScaiError(
      "audit template-dependencies requires --template-id <guid>.",
      "INPUT_INVALID"
    );
  }
  const value = normalizeItemId(options.templateId);
  const limit = options.limit ?? 5000;
  const skip = new Set<TemplateReferenceKind>(options.skip ?? []);

  logger.verbose(`Resolving dependencies on template ${value}.`);

  const reports: TemplateDependencyReport[] = [];
  for (const entry of SEARCH_KINDS) {
    if (skip.has(entry.kind)) continue;
    let pageIndex = 0;
    let collected = 0;
    // Page through results until we hit the limit. We don't use
    // `searchAll` here because each kind needs its own running count
    // and label; folding them into one iterator would muddy that.
    while (collected < limit) {
      const page = await client.search({
        index: options.index,
        latestVersionOnly: true,
        paging: { pageIndex, pageSize: 100 },
        searchStatement: {
          criteria: {
            field: entry.field,
            value,
            criteriaType: entry.criteriaType,
          },
        },
      });
      if (page.results.length === 0) break;
      for (const r of page.results) {
        if (collected >= limit) break;
        reports.push({
          itemId: normalizeItemId(r.itemId),
          path: r.path ?? null,
          name: r.name,
          templateId: r.templateId ?? null,
          templateName: r.templateName ?? null,
          referenceKind: entry.kind,
        });
        collected += 1;
      }
      if (page.results.length < 100) break;
      pageIndex += 1;
    }
    logger.verbose(`  ${entry.kind}: ${collected} reference(s).`);
  }

  reports.sort((a, b) => {
    const kindCmp = a.referenceKind.localeCompare(b.referenceKind);
    if (kindCmp !== 0) return kindCmp;
    return (a.path ?? a.name).localeCompare(b.path ?? b.name);
  });

  printReport({
    logger,
    command: "audit.template-dependencies.list",
    envName,
    results: reports,
    summary: `Template ${value}: ${reports.length} inbound reference(s).`,
    formatLine: (r) => `[${r.referenceKind}] ${r.path ?? r.name} (${r.itemId.slice(0, 8)})`,
    extra: { templateId: value, limit, skipped: [...skip] },
    options,
  });

  return reports;
};

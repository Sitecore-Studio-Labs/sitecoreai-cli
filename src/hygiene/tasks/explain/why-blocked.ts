/**
 * `scai hygiene explain why-blocked <itemId>` — answer the question "why
 * won't this item delete?" with a structured, kind-sorted list of
 * every inbound reference that would block (or potentially block) a
 * Authoring-API delete.
 *
 * The Authoring API rejects delete requests with terse messages like
 * "Template is used by at least one item" — enough to know something
 * is wrong, not enough to know what. Operators (and agents) end up
 * piecing together the picture by hand: run `audit references`, then
 * `audit template-dependencies`, then cross-reference the field
 * names. This verb does that composition once and returns a single
 * report with each blocker labeled by reference kind.
 *
 * Combines two existing primitives:
 *
 *   - `audit references` (text walk of content fields)
 *   - `audit template-dependencies` (search-index queries against the
 *     five structural fields `_template` / `_basetemplates` /
 *     `__masters` / `__source` / `datasource template`)
 *
 * Both are invoked with `silent: true` so this verb owns the printed
 * report.
 */

import { createScaiError } from "@/shared/errors";
import { runAuditReferences } from "../audit/references";
import {
  runAuditTemplateDependencies,
  type TemplateReferenceKind,
} from "../audit/template-dependencies";
import { REFERENCE_KIND_PRIORITY, type ReferenceKind } from "../reference-kind";
import {
  type HygieneCommonOptions,
  normalizeItemId,
  printReport,
  resolveTenant,
  toLogger,
} from "../shared";

export interface ExplainWhyBlockedOptions extends HygieneCommonOptions {
  /** Required. ItemId to explain (any GUID form accepted). */
  itemId?: string;
  /** Content root for the field-value scan. Default `/sitecore/content`. */
  root?: string;
  /** Override the search index. */
  index?: string;
  /** Cap on inbound refs returned per check. Default 5000. */
  limit?: number;
  /**
   * Skip the field-value content scan (the slow part). Use when you
   * already know the target is a template and only structural refs
   * matter — typically when triaging a template-delete failure.
   */
  skipContentScan?: boolean;
  /**
   * Skip the template-dependencies (search-index) check. Use when
   * the target is a content item that isn't referenced as a template
   * by anything — saves the five search-index round-trips. Most useful
   * for triaging deletes of leaf content items, never for templates.
   */
  skipTemplateDeps?: boolean;
  /** Pass through to the field-value scan when caching back-to-back invocations. */
  cache?: boolean;
}

export interface BlockerEntry {
  referenceKind: ReferenceKind;
  referrerItemId: string;
  referrerPath: string | null;
  /** Field name that holds the ref. Null for template-deps results that don't surface a field. */
  fieldName: string | null;
  /** Templating context — `null` when the referrer isn't a template. */
  referrerTemplateName: string | null;
  /** Source of the finding — useful when both scans surface the same referrer for different reasons. */
  source: "audit-references" | "audit-template-dependencies";
}

export interface ExplainWhyBlockedReport {
  /** Normalized 32-char itemId of the target. */
  itemId: string;
  blockers: BlockerEntry[];
}

// `audit-template-dependencies` returns one of five reference kinds —
// the structural ones. Map 1:1 to our wider `ReferenceKind` (which
// also includes `field-value` for content refs that aren't structural).
const TEMPLATE_KIND_TO_REFERENCE_KIND: Record<TemplateReferenceKind, ReferenceKind> = {
  "primary-template": "primary-template",
  "base-template": "base-template",
  "insert-options": "insert-options",
  "branch-source": "branch-source",
  "datasource-template": "datasource-template",
};

const sortBlockers = (a: BlockerEntry, b: BlockerEntry): number => {
  const kindDiff =
    REFERENCE_KIND_PRIORITY[a.referenceKind] - REFERENCE_KIND_PRIORITY[b.referenceKind];
  if (kindDiff !== 0) return kindDiff;
  const aPath = a.referrerPath ?? a.referrerItemId;
  const bPath = b.referrerPath ?? b.referrerItemId;
  return aPath.localeCompare(bPath);
};

const summarize = (itemId: string, blockers: BlockerEntry[]): string => {
  if (blockers.length === 0) {
    return `No inbound references found for ${itemId}. Item should be safe to delete.`;
  }
  const byKind = new Map<ReferenceKind, number>();
  for (const b of blockers) {
    byKind.set(b.referenceKind, (byKind.get(b.referenceKind) ?? 0) + 1);
  }
  const parts = [...byKind.entries()]
    .sort(([a], [b]) => REFERENCE_KIND_PRIORITY[a] - REFERENCE_KIND_PRIORITY[b])
    .map(([kind, count]) => `${count} ${kind}`);
  return `${itemId} is blocked by ${blockers.length} inbound reference(s): ${parts.join(", ")}.`;
};

/**
 * Run both audits in parallel against `itemId`, merge the findings
 * into a single sorted-by-kind blocker list, and print the canonical
 * envelope. Used by `scai hygiene explain why-blocked <itemId>` and any
 * automation that wants a single answer to "what's holding this
 * delete back?"
 */
export const runExplainWhyBlocked = async (
  options: ExplainWhyBlockedOptions
): Promise<ExplainWhyBlockedReport> => {
  if (!options.itemId) {
    throw createScaiError("explain why-blocked requires <itemId>.", "INPUT_INVALID");
  }

  const logger = toLogger(options);
  // Resolve the tenant once up front. The downstream audits also
  // resolve, but doing it here gives us a single `envName` for the
  // printed envelope and ensures auth errors surface before either
  // audit runs.
  const { envName } = resolveTenant(options);
  const normalizedTarget = normalizeItemId(options.itemId);

  const referencesPromise = options.skipContentScan
    ? Promise.resolve([])
    : runAuditReferences({
        ...options,
        to: normalizedTarget,
        silent: true,
      });

  const templateDepsPromise = options.skipTemplateDeps
    ? Promise.resolve([])
    : runAuditTemplateDependencies({
        ...options,
        templateId: normalizedTarget,
        silent: true,
      });

  const [referencesResult, templateDepsResult] = await Promise.all([
    referencesPromise,
    templateDepsPromise,
  ]);

  const blockers: BlockerEntry[] = [];
  for (const r of referencesResult) {
    // One field-value report can carry multiple field matches — emit
    // one BlockerEntry per (referrer, fieldName) so the kind sorting
    // and the per-field action are both visible.
    for (const match of r.matches) {
      blockers.push({
        referenceKind: "field-value",
        referrerItemId: normalizeItemId(r.itemId),
        referrerPath: r.path,
        fieldName: match.fieldName,
        referrerTemplateName: r.templateName,
        source: "audit-references",
      });
    }
  }
  for (const t of templateDepsResult) {
    blockers.push({
      referenceKind: TEMPLATE_KIND_TO_REFERENCE_KIND[t.referenceKind],
      referrerItemId: t.itemId,
      referrerPath: t.path,
      fieldName: null,
      referrerTemplateName: t.templateName,
      source: "audit-template-dependencies",
    });
  }
  blockers.sort(sortBlockers);

  const report: ExplainWhyBlockedReport = {
    itemId: normalizedTarget,
    blockers,
  };

  printReport({
    logger,
    command: "explain.why-blocked",
    envName,
    results: blockers,
    summary: summarize(normalizedTarget, blockers),
    formatLine: (b) =>
      `[${b.referenceKind}] ${b.referrerPath ?? b.referrerItemId}${b.fieldName ? ` . ${b.fieldName}` : ""}`,
    extra: {
      itemId: normalizedTarget,
      scannedContent: !options.skipContentScan,
      scannedTemplateDeps: !options.skipTemplateDeps,
    },
    options,
  });

  return report;
};

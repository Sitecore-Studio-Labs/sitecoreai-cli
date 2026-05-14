import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  buildPathFilterStatement,
  ensureAllowWriteForCleanup,
  normalizeItemId,
  printReport,
  resolveHygieneKnobs,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";
import type { HygieneApiClient } from "../api/client";
import { pruneFieldValue } from "./cleanup-subtree-prune";

/** Policy for handling external inbound references to the subtree. */
export type OrphanExternalRefsPolicy =
  /**
   * Empty the entire referring field. Cheap and correct for single-value
   * fields (droplists, single-link). Blunt for multi-value fields:
   * a treelist or multi-list field carrying ten GUIDs would lose all
   * ten, not just the one targeting the subtree.
   */
  | "clear"
  /**
   * Surgical removal — preserve sibling entries in multi-value fields.
   * Dispatches by field-value shape: `__Renderings`-style XML drops
   * just the `<r ... />` elements pointing at the subtree; pipe-
   * separated multi-list / treelist fields drop just the offending
   * GUIDs. Single-value fields with no shape to preserve fall through
   * to a clear (empty-string write).
   */
  | "prune";

export interface CleanupSubtreeOptions extends HygieneCommonOptions {
  /** Required. Root path of the subtree to delete. */
  path?: string;
  /**
   * Content root to scan for inbound references. Default `/sitecore` —
   * the entire CMS, so refs from any root are caught. Narrow to
   * `/sitecore/content` etc. for faster runs at the cost of missing
   * refs from outside that root.
   */
  scanRoot?: string;
  /**
   * What to do when external items have field values referencing items
   * inside the subtree. Default: refuse (hard-block) and print the
   * blockers. With `clear`, the audit clears those field values before
   * walking the deletion bottom-up.
   */
  orphanExternalRefs?: OrphanExternalRefsPolicy;
  /**
   * Permit operating on protected platform subtrees. Off by default —
   * `/sitecore/system`, `/sitecore/templates/System`, `/sitecore/layout/Layouts/System`,
   * and the Recycle Bin are all refused without `--force`.
   */
  force?: boolean;
  /** Hard cap on items deleted. Default 1000. Protects against runaway scope. */
  maxDeletions?: number;
  whatIf?: boolean;
  allowWrite?: boolean;
  index?: string;
  concurrency?: number;
  pageParallelism?: number;
  batchSize?: number;
  cache?: boolean;
  limit?: number;
  /** Restrict the inbound-ref scan to these field names. */
  fields?: string[];
}

const PROTECTED_ROOTS = [
  "/sitecore/system",
  "/sitecore/layout/Layouts/System",
  "/sitecore/templates/System",
  "/sitecore/templates/Branches/System",
  "/sitecore/content/Recycle Bin",
];

export interface InboundBlocker {
  /** Item that holds the referencing field — outside the subtree. */
  referrerItemId: string;
  referrerPath: string;
  referrerTemplateName: string | null;
  fieldName: string;
  /** Item inside the subtree the field value references. */
  targetItemId: string;
  /**
   * The field's value at scan time. Captured so `prune` can compute
   * surgical removals without a re-read; `clear` ignores it.
   */
  fieldValue?: string;
  /**
   * Whether the referring field was successfully written (cleared OR
   * pruned) in apply mode. Stays undefined in what-if mode and on
   * update failures. Name kept for back-compat with the v1.1 API.
   */
  cleared?: boolean;
}

export interface SubtreeDeletion {
  itemId: string;
  path: string;
  status: "deleted" | "what-if" | "failed";
  error?: string;
}

export interface CleanupSubtreeResult {
  blockers: InboundBlocker[];
  deletions: SubtreeDeletion[];
  /** What this run was — useful for downstream tooling. */
  policy: OrphanExternalRefsPolicy | "block";
  whatIf: boolean;
}

/**
 * Build every canonical form of an itemId the Authoring API might
 * surface in a field value. Single set of forms shared across all
 * subtree items so the per-field scan can be a flat substring check.
 */
const buildIdForms = (normalizedIds: ReadonlySet<string>): Map<string, string> => {
  // Map from search-form (the thing we look for in field values) →
  // the normalized 32-char id (the thing we store in the result row).
  const forms = new Map<string, string>();
  for (const id of normalizedIds) {
    const flat = id;
    const dashed = `${flat.slice(0, 8)}-${flat.slice(8, 12)}-${flat.slice(12, 16)}-${flat.slice(16, 20)}-${flat.slice(20)}`;
    forms.set(flat.toLowerCase(), id);
    forms.set(dashed.toLowerCase(), id);
    forms.set(`{${dashed.toLowerCase()}}`, id);
    forms.set(`{${dashed.toUpperCase()}}`, id);
  }
  return forms;
};

/**
 * Find every external item whose field value references any item in the
 * subtree. Walks `scanRoot` once, skipping items that are themselves in
 * `targetIds`. Self-references inside the subtree are not blockers —
 * the bottom-up delete walks past them.
 */
const findInboundBlockers = async (
  client: HygieneApiClient,
  envName: string,
  scanRoot: string,
  targetIds: ReadonlySet<string>,
  options: CleanupSubtreeOptions
): Promise<InboundBlocker[]> => {
  const logger = toLogger(options);
  const idForms = buildIdForms(targetIds);
  // Sort the form set descending by length so curly-wrapped matches
  // win over bare-dashed wins over flat. `String.includes` is O(n*m),
  // but field values are typically short and the form set is small.
  const sortedForms = [...idForms.entries()].sort((a, b) => b[0].length - a[0].length);

  const fieldFilter = options.fields?.length
    ? new Set(options.fields.map((f) => f.toLowerCase()))
    : null;

  const { scanned, fieldsByItemId } = await scanItemsAndFields({
    client,
    envName,
    root: scanRoot,
    logger,
    options,
  });

  const blockers: InboundBlocker[] = [];
  for (const item of scanned) {
    if (targetIds.has(item.itemId)) continue;
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field.value) continue;
      if (fieldFilter && !fieldFilter.has(field.name.toLowerCase())) continue;
      // Lowercase-once per field so the substring search is cheap.
      const lower = field.value.toLowerCase();
      // One blocker per (referrer, field, target). A multi-list field
      // referencing two subtree items emits two blockers — the cleanup
      // groups them back into one updateItemFields call later. Stop
      // recording once a target is seen so we don't double-count when
      // both the curly and dashed forms of the same id are in the value.
      const seenTargets = new Set<string>();
      for (const [form, targetId] of sortedForms) {
        if (seenTargets.has(targetId)) continue;
        if (lower.includes(form)) {
          blockers.push({
            referrerItemId: item.itemId,
            referrerPath: item.path,
            referrerTemplateName: item.templateName,
            fieldName: field.name,
            targetItemId: targetId,
            fieldValue: field.value,
          });
          seenTargets.add(targetId);
        }
      }
    }
  }
  return blockers;
};

/**
 * Bottom-up cascade delete of a Sitecore subtree.
 *
 * Steps:
 *   1. Resolve `--path` to an itemId; refuse protected roots.
 *   2. Enumerate the subtree via `_path CONTAINS <rootItemId>` and
 *      sort path-length-descending so leaves delete before their
 *      parents.
 *   3. Scan `--scan-root` (default `/sitecore`) for items outside the
 *      subtree whose field values reference any item inside.
 *   4. Hard-block by default. With `--orphan-external-refs clear`,
 *      empty each referring field, then proceed.
 *   5. Walk the deletion list and delete each item.
 *
 * Safety rails match the rest of `scai cleanup`: `--what-if` for
 * plan-only mode, `--allow-write` enforced outside what-if,
 * `--max-deletions` blast-radius cap.
 */
export const runCleanupSubtree = async (
  options: CleanupSubtreeOptions
): Promise<CleanupSubtreeResult> => {
  const logger = toLogger(options);

  if (!options.path) {
    throw createScaiError(
      "cleanup subtree requires --path <content-tree-path>.",
      "INPUT_INVALID"
    );
  }
  const subtreePath = options.path;
  if (!options.force && PROTECTED_ROOTS.some((p) => subtreePath.startsWith(p))) {
    throw createScaiError(
      `Refusing to operate on protected root '${subtreePath}'.`,
      "INPUT_INVALID",
      { hint: "Pass --force to override (only when you intentionally target a system tree)." }
    );
  }

  const scanRoot = options.scanRoot ?? "/sitecore";
  if (!subtreePath.startsWith(scanRoot)) {
    throw createScaiError(
      `--path '${subtreePath}' is not under --scan-root '${scanRoot}'.`,
      "INPUT_INVALID",
      {
        hint: "Either narrow --scan-root or broaden it to cover the deletion path. Defaulting to /sitecore covers every root.",
      }
    );
  }

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no items will be deleted.", "yellow");
  }

  // ─── Resolve the subtree root ─────────────────────────────────────────
  const rootSearch = await client.search({
    index: options.index,
    paging: { pageSize: 1 },
    searchStatement: {
      criteria: { field: "_fullpath", value: subtreePath.toLowerCase(), criteriaType: "EXACT" },
    },
  });
  const rootItem = rootSearch.results[0];
  if (!rootItem) {
    throw createScaiError(
      `Subtree root '${subtreePath}' not found.`,
      "INPUT_INVALID",
      {
        hint: "Verify the path exists in the tenant (`scai audit broken-links` can help locate misspellings).",
      }
    );
  }
  const rootItemId = normalizeItemId(rootItem.itemId);

  // ─── Enumerate the subtree (root + descendants), bottom-up ────────────
  const knobs = resolveHygieneKnobs(options);
  const subtreeItems: Array<{ itemId: string; path: string }> = [
    { itemId: rootItemId, path: rootItem.path },
  ];
  for await (const r of client.searchAll(
    {
      index: options.index,
      latestVersionOnly: true,
      searchStatement: buildPathFilterStatement(rootItemId),
    },
    100,
    knobs.pageParallelism
  )) {
    const id = normalizeItemId(r.itemId);
    if (id === rootItemId) continue;
    subtreeItems.push({ itemId: id, path: r.path });
  }
  // Bottom-up: longer paths first. Stable for items at the same depth.
  subtreeItems.sort((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path));

  const maxDeletions = options.maxDeletions ?? 1000;
  if (subtreeItems.length > maxDeletions) {
    throw createScaiError(
      `Subtree contains ${subtreeItems.length} items — exceeds --max-deletions ${maxDeletions}.`,
      "INPUT_INVALID",
      {
        hint: `Raise --max-deletions explicitly when you intend a large purge, or narrow the subtree with a deeper --path.`,
      }
    );
  }
  const targetIds = new Set(subtreeItems.map((i) => i.itemId));

  // ─── Inbound-reference scan ───────────────────────────────────────────
  logger.verbose(
    `Scanning ${scanRoot} for inbound references to ${subtreeItems.length} subtree item(s).`
  );
  const blockers = await findInboundBlockers(
    client,
    envName,
    scanRoot,
    targetIds,
    options
  );

  const policy: OrphanExternalRefsPolicy | "block" = options.orphanExternalRefs ?? "block";

  if (blockers.length > 0 && policy === "block") {
    // Print the blockers so the operator can choose: clear external refs,
    // or fix the refs out-of-band first.
    const sample = blockers
      .slice(0, 5)
      .map((b) => `  ${b.referrerPath} . ${b.fieldName} → ${b.targetItemId.slice(0, 8)}…`)
      .join("\n");
    throw createScaiError(
      `Refusing to delete subtree '${subtreePath}': ${blockers.length} external reference(s) point into it. ` +
        `Pass --orphan-external-refs clear to wipe those referring fields before deleting, or fix the refs out-of-band first.\n${sample}${
          blockers.length > 5 ? `\n  …and ${blockers.length - 5} more` : ""
        }`,
      "INPUT_INVALID"
    );
  }

  // ─── Optionally clear external referring fields ────────────────────────
  if (blockers.length > 0 && policy === "clear" && !options.whatIf) {
    // Group blockers by (referrerItemId, fieldName) — multiple targets
    // could point at the same field. One update per (item, field).
    const byKey = new Map<string, InboundBlocker[]>();
    for (const b of blockers) {
      const key = `${b.referrerItemId}::${b.fieldName}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(b);
      else byKey.set(key, [b]);
    }
    await mapWithConcurrency(
      [...byKey.entries()],
      async ([, group]) => {
        const [first] = group;
        try {
          await client.updateItemFields({
            itemId: first.referrerItemId,
            fields: [{ name: first.fieldName, value: "" }],
          });
          for (const b of group) b.cleared = true;
        } catch (error) {
          // Leave `cleared: undefined` so the caller can see the field
          // wasn't wiped; downstream delete will likely fail too.
          logger.warn(
            `Failed to clear ${first.referrerPath}.${first.fieldName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },
      options.concurrency ?? 4
    );
  }

  // ─── Delete bottom-up ─────────────────────────────────────────────────
  const deletions: SubtreeDeletion[] = [];
  for (const item of subtreeItems) {
    if (options.whatIf) {
      deletions.push({ itemId: item.itemId, path: item.path, status: "what-if" });
      continue;
    }
    try {
      await client.deleteItem({ itemId: item.itemId, permanently: true });
      deletions.push({ itemId: item.itemId, path: item.path, status: "deleted" });
    } catch (error) {
      deletions.push({
        itemId: item.itemId,
        path: item.path,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: CleanupSubtreeResult = {
    blockers,
    deletions,
    policy,
    whatIf: Boolean(options.whatIf),
  };

  const deletedCount = deletions.filter((d) => d.status === "deleted").length;
  const failedCount = deletions.filter((d) => d.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would delete ${subtreeItems.length} item${subtreeItems.length === 1 ? "" : "s"}${
        blockers.length > 0 ? ` (after ${policy === "clear" ? "clearing" : "blocking on"} ${blockers.length} external ref${blockers.length === 1 ? "" : "s"})` : ""
      }.`
    : `Deleted ${deletedCount} of ${subtreeItems.length} item${subtreeItems.length === 1 ? "" : "s"}${
        blockers.length > 0 ? ` (cleared ${blockers.filter((b) => b.cleared).length} of ${blockers.length} referring field${blockers.length === 1 ? "" : "s"})` : ""
      }${failedCount > 0 ? ` (${failedCount} delete failure${failedCount === 1 ? "" : "s"})` : ""}.`;

  printReport({
    logger,
    command: "cleanup.subtree.delete",
    envName,
    results: deletions,
    summary,
    formatLine: (d) =>
      `${d.status === "what-if" ? "[would delete] " : d.status === "failed" ? "[failed] " : "[deleted] "}${d.path}${d.error ? ` — ${d.error}` : ""}`,
    extra: {
      path: subtreePath,
      scanRoot,
      policy,
      whatIf: Boolean(options.whatIf),
      subtreeSize: subtreeItems.length,
      blockerCount: blockers.length,
      blockersCleared: blockers.filter((b) => b.cleared).length,
      deletedCount,
      failedCount,
    },
    options,
  });

  return result;
};

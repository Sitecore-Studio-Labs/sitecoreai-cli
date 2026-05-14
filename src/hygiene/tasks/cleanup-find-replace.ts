import { mapWithConcurrency } from "@/shared/cli-tasks";
import { createScaiError } from "@/shared/errors";
import {
  type HygieneCommonOptions,
  dashifyItemId,
  ensureAllowWriteForCleanup,
  printReport,
  resolveTenant,
  scanItemsAndFields,
  toLogger,
} from "./shared";

export interface CleanupFindReplaceOptions extends HygieneCommonOptions {
  /** Required. Pattern to find. */
  pattern: string;
  /** Required. Replacement string. Supports regex backreferences (`$1`, `$&`). */
  replacement: string;
  literal?: boolean;
  ignoreCase?: boolean;
  flags?: string;
  /** Field-name filter. */
  fields?: string[];
  includeSystemFields?: boolean;
  /** Content root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  language?: string;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  whatIf?: boolean;
  allowWrite?: boolean;
  /**
   * Maximum number of items to mutate per run. Default 100 — defends
   * against runaway pattern matches. Set higher when you've validated
   * the audit output and want to apply at scale.
   */
  maxMutations?: number;
}

export interface FindReplaceAction {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  fieldsChanged: Array<{
    fieldName: string;
    matchCount: number;
    /** Up to 3 before/after pairs for the report. */
    samples: Array<{ before: string; after: string }>;
  }>;
  status: "applied" | "what-if" | "failed" | "skipped-cap";
  error?: string;
}

const compilePattern = (
  pattern: string,
  options: { literal?: boolean; ignoreCase?: boolean; flags?: string }
): RegExp => {
  if (!pattern) {
    throw createScaiError("--pattern is required.", "INPUT_INVALID");
  }
  const baseFlags = options.flags ?? "g";
  let flags = baseFlags;
  if (options.ignoreCase && !flags.includes("i")) flags += "i";
  if (!flags.includes("g")) flags += "g";
  const escaped = options.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
  return new RegExp(escaped, flags);
};

const snippet = (value: string, maxLen = 80): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + "…";
};

/**
 * Apply a find-replace operation across content fields.
 *
 * Strategy:
 *   1. Use `scanItemsAndFields` to crawl items and load fields.
 *   2. Compile the pattern once; for each field, run `.replace` to
 *      compute the new value and count matches.
 *   3. Apply via `updateItemFields(itemId, [{name, value}])` per item.
 *   4. Stop when `--max-mutations` items have been touched.
 *
 * Safety rails:
 *   - `--what-if` reports the planned changes without calling the API.
 *   - `--allow-write` (or env `allowWrite`) required outside `--what-if`.
 *   - `--max-mutations` caps the change blast-radius. Default 100.
 *   - `__`-prefixed system fields are excluded by default. Operators
 *     who want to touch them must pass `--include-system-fields` AND
 *     know what they're doing — replacing a `__Renderings` value via
 *     regex will mangle the XML.
 *
 * Notes:
 *   - The `replacement` string supports JS RegExp backreferences
 *     (`$1`, `$&`, `$<name>`), same as `String.replace()`. Operators
 *     who want literal `$` use `$$$$`.
 *   - Each item is mutated in a single `updateItem` call regardless
 *     of how many fields change on it. Per-language updates aren't
 *     supported in this round — the Authoring API treats the update
 *     as latest-version on the item's primary language.
 */
export const runCleanupFindReplace = async (
  options: CleanupFindReplaceOptions
): Promise<FindReplaceAction[]> => {
  const logger = toLogger(options);
  if (!options.pattern) {
    throw createScaiError("--pattern is required.", "INPUT_INVALID");
  }
  if (options.replacement === undefined || options.replacement === null) {
    throw createScaiError("--replacement is required.", "INPUT_INVALID");
  }
  const regex = compilePattern(options.pattern, options);
  const maxMutations = options.maxMutations ?? 100;
  const fieldFilter = options.fields?.length
    ? new Set(options.fields.map((f) => f.toLowerCase()))
    : null;
  const includeSystemFields = Boolean(options.includeSystemFields);

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no items will be modified.", "yellow");
  }

  const { scanned, fieldsByItemId, cache, knobs } = await scanItemsAndFields({
    client,
    envName,
    root: options.root ?? "/sitecore/content",
    logger,
    options,
  });

  type Plan = {
    item: (typeof scanned)[number];
    fieldUpdates: Array<{ name: string; oldValue: string; newValue: string; matchCount: number }>;
  };
  const plans: Plan[] = [];
  for (const item of scanned) {
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const fieldUpdates: Plan["fieldUpdates"] = [];
    for (const field of fields) {
      if (!field.value) continue;
      if (fieldFilter && !fieldFilter.has(field.name.toLowerCase())) continue;
      if (!includeSystemFields && field.name.startsWith("__")) continue;
      regex.lastIndex = 0;
      const matchCount = (field.value.match(regex) || []).length;
      if (matchCount === 0) continue;
      regex.lastIndex = 0;
      const newValue = field.value.replace(regex, options.replacement);
      if (newValue === field.value) continue;
      fieldUpdates.push({
        name: field.name,
        oldValue: field.value,
        newValue,
        matchCount,
      });
    }
    if (fieldUpdates.length > 0) plans.push({ item, fieldUpdates });
    if (plans.length >= maxMutations) {
      logger.warn(
        `Hit --max-mutations cap (${maxMutations}); ${scanned.length - plans.length} item(s) skipped. Re-run with a higher cap to widen.`
      );
      break;
    }
  }
  logger.verbose(`${plans.length} item(s) plan to mutate.`);

  const actions: FindReplaceAction[] = await mapWithConcurrency(
    plans,
    async (plan): Promise<FindReplaceAction> => {
      const base: Omit<FindReplaceAction, "status" | "error"> = {
        itemId: plan.item.itemId,
        path: plan.item.path,
        templateName: plan.item.templateName,
        language: plan.item.language,
        fieldsChanged: plan.fieldUpdates.map((f) => ({
          fieldName: f.name,
          matchCount: f.matchCount,
          samples: [{ before: snippet(f.oldValue), after: snippet(f.newValue) }],
        })),
      };
      if (options.whatIf) {
        return { ...base, status: "what-if" };
      }
      try {
        await client.updateItemFields({
          itemId: dashifyItemId(plan.item.itemId),
          fields: plan.fieldUpdates.map((f) => ({ name: f.name, value: f.newValue })),
        });
        return { ...base, status: "applied" };
      } catch (error) {
        return {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    knobs.concurrency
  );

  await cache?.flush();

  const applied = actions.filter((a) => a.status === "applied").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const totalMatches = actions.reduce(
    (n, a) => n + a.fieldsChanged.reduce((m, f) => m + f.matchCount, 0),
    0
  );
  const summary = options.whatIf
    ? `Plan: would update ${actions.length} item${actions.length === 1 ? "" : "s"} (${totalMatches} match occurrences).`
    : `Applied ${applied} of ${actions.length} update${actions.length === 1 ? "" : "s"} (${totalMatches} replacements)${failed > 0 ? `; ${failed} failed` : ""}.`;

  printReport({
    logger,
    command: "cleanup.find-replace",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "what-if" ? "[would change] " : a.status === "failed" ? "[failed] " : ""}${a.path} — ${a.fieldsChanged
        .slice(0, 2)
        .map((f) => `${f.fieldName}(${f.matchCount}×)`)
        .join(", ")}${a.fieldsChanged.length > 2 ? "…" : ""}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      pattern: options.pattern,
      replacement: options.replacement,
      literal: Boolean(options.literal),
      ignoreCase: Boolean(options.ignoreCase),
      whatIf: Boolean(options.whatIf),
      maxMutations,
      appliedCount: applied,
      failedCount: failed,
      totalMatches,
    },
    options,
  });

  return actions;
};

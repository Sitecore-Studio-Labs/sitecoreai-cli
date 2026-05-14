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

export type FieldSetMode = "replace" | "add" | "remove" | "clear";

export interface CleanupFieldSetOptions extends HygieneCommonOptions {
  /**
   * Required. Field name to write (case-insensitive against the item's
   * template). Single field per run — the verb is intentionally narrow
   * so the audit trail stays clear.
   */
  field: string;
  /**
   * Required for `replace` and `add`/`remove`. The value to write:
   *   - `replace`: written verbatim (any Sitecore wire shape — raw
   *     string, `{guid}`, pipe-delimited list, `<link/>` XML, ISO date).
   *   - `add` / `remove`: one or more GUIDs (with or without braces),
   *     comma- or pipe-separated. Each is treated as a multilist
   *     member to union with / subtract from the current value.
   *   - `clear`: ignored; the field is wiped.
   */
  value?: string;
  /**
   * How to combine `value` with the existing field state.
   * Default `replace`.
   *
   * - `replace`: overwrite the field with `value` verbatim. Works for
   *   any field type — caller owns the wire shape.
   * - `add`: union the supplied GUIDs into a pipe-delimited list.
   *   Reads the current value first; refuses if the existing value is
   *   non-empty and isn't a pipe-delimited GUID list (avoids corrupting
   *   Single-Line Text or RichText fields by accident).
   * - `remove`: subtract the supplied GUIDs from a pipe-delimited list.
   *   Same shape guard as `add`.
   * - `clear`: write the empty string.
   *
   * The `add` / `remove` modes are the answer to "bulk tag-add" /
   * "bulk tag-remove" — Sitecore tags are TreelistEx fields whose
   * underlying wire format is `{guid1}|{guid2}|…`, so set-union and
   * set-difference are the right primitives.
   */
  mode?: FieldSetMode;
  /** Restrict to descendants of this content-tree path. Default `/sitecore/content`. */
  root?: string;
  /** Restrict by template name pattern. Strongly recommended. */
  templatePattern?: string;
  /** Only update items whose current value of `field` matches this regex. */
  whereCurrentMatches?: string;
  /** Restrict by language. Default: every language version of each item. */
  language?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
  /** Allow writing to `__`-prefixed system fields. Off by default. */
  includeSystemFields?: boolean;
  batchSize?: number;
  concurrency?: number;
  pageParallelism?: number;
  cache?: boolean;
  exclude?: string[];
  since?: string;
  owner?: string;
  whatIf?: boolean;
  allowWrite?: boolean;
  baseline?: boolean;
  output?: string;
  format?: "json" | "csv" | "markdown";
  /**
   * Maximum number of items mutated per run. Default 100 — defends
   * against an unintentionally-broad `--template-pattern` matching
   * thousands of items.
   */
  maxMutations?: number;
}

export interface FieldSetAction {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string | null;
  fieldName: string;
  mode: FieldSetMode;
  oldValue: string;
  newValue: string;
  status: "applied" | "what-if" | "failed" | "skipped-cap" | "skipped-no-change" | "skipped-shape";
  error?: string;
}

const GUID_PATTERN = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i;
const PIPE_GUID_LIST_PATTERN = /^(\{?[0-9a-f-]{32,38}\}?)(\|\{?[0-9a-f-]{32,38}\}?)*$/i;

/**
 * Normalize a GUID to the lower-case braced form `{xxxxxxxx-...-xxxxxxxxxxxx}`
 * that Sitecore Multilist/Treelist field values use.
 */
const normalizeGuid = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!GUID_PATTERN.test(trimmed)) return null;
  const bare = trimmed.replace(/[{}]/g, "").toLowerCase();
  // Insert hyphens at the standard 8-4-4-4-12 positions if absent.
  const hyphenated =
    bare.length === 32
      ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`
      : bare;
  return `{${hyphenated}}`;
};

/** Parse a "comma-or-pipe-separated GUID list" input into normalized braced GUIDs. */
const parseGuidList = (value: string): string[] => {
  const guids = value
    .split(/[,|]/)
    .map((part) => normalizeGuid(part))
    .filter((g): g is string => g !== null);
  if (!guids.length) {
    throw createScaiError(
      "`value` for mode='add'/'remove' must contain at least one GUID.",
      "INPUT_INVALID"
    );
  }
  return guids;
};

const splitMultilistValue = (current: string): string[] => {
  if (!current || !current.trim()) return [];
  return current
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const joinMultilistValue = (guids: string[]): string =>
  guids
    .map((g) => normalizeGuid(g) ?? g)
    .filter((g) => g.length > 0)
    .join("|");

const isPipeDelimitedGuidShape = (value: string): boolean => {
  if (!value || !value.trim()) return true; // empty is compatible with multilist
  return PIPE_GUID_LIST_PATTERN.test(value.trim());
};

/**
 * Bulk-edit a single field across a content scope.
 *
 * One verb, four modes — `replace`, `add`, `remove`, `clear`. Field
 * "type" is not part of the verb's contract; Sitecore resolves the
 * field name against the item's template and accepts the resulting
 * value string. The cleanup task validates the *shape* of the existing
 * value before `add` / `remove` (pipe-delimited GUID list) so a stray
 * `mode: add` against a Single-Line Text field can't silently corrupt
 * it.
 *
 * Safety rails:
 *   - `--what-if` reports the plan without writing.
 *   - `--allow-write` required outside what-if.
 *   - `--max-mutations` caps the blast radius (default 100).
 *   - `--template-pattern` is strongly recommended — without it the
 *     verb operates on every item in the content tree, which is
 *     rarely what's intended.
 *   - `__`-prefixed system fields rejected unless `--include-system-fields`.
 *   - `--where-current-matches` lets the operator restrict to items
 *     whose current value of the field matches a regex (useful for
 *     idempotent re-runs: "set Field X to V on every item where X is
 *     currently empty").
 */
export const runCleanupFieldSet = async (
  options: CleanupFieldSetOptions
): Promise<FieldSetAction[]> => {
  const logger = toLogger(options);
  if (!options.field || !options.field.trim()) {
    throw createScaiError("--field is required.", "INPUT_INVALID");
  }
  const mode: FieldSetMode = options.mode ?? "replace";
  if (mode !== "clear" && (options.value === undefined || options.value === null)) {
    throw createScaiError(`--value is required for mode='${mode}'.`, "INPUT_INVALID");
  }
  const maxMutations = options.maxMutations ?? 100;
  const templateRegex = options.templatePattern ? new RegExp(options.templatePattern, "i") : null;
  const currentRegex = options.whereCurrentMatches ? new RegExp(options.whereCurrentMatches) : null;
  const fieldNameLc = options.field.toLowerCase();
  const includeSystemFields = Boolean(options.includeSystemFields);
  if (fieldNameLc.startsWith("__") && !includeSystemFields) {
    throw createScaiError(
      "Refusing to write a `__`-prefixed system field without --include-system-fields.",
      "INPUT_INVALID"
    );
  }

  // For add/remove, parse the GUID list up-front so a bad input fails
  // before the search crawl.
  const guidList = mode === "add" || mode === "remove" ? parseGuidList(options.value!) : null;

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
    field: { name: string; oldValue: string };
    newValue: string;
    skip?: FieldSetAction["status"];
  };
  const plans: Plan[] = [];
  for (const item of scanned) {
    if (templateRegex && !templateRegex.test(item.templateName ?? "")) continue;
    const fields = fieldsByItemId.get(item.itemId);
    if (!fields || !Array.isArray(fields)) continue;
    const matchingField = fields.find((f) => f.name.toLowerCase() === fieldNameLc);
    if (!matchingField) continue; // Field not on this item's template; not our problem.
    const oldValue = matchingField.value ?? "";
    if (currentRegex && !currentRegex.test(oldValue)) continue;

    let newValue = oldValue;
    let skip: FieldSetAction["status"] | undefined;
    switch (mode) {
      case "replace":
        newValue = options.value!;
        break;
      case "clear":
        newValue = "";
        break;
      case "add": {
        if (!isPipeDelimitedGuidShape(oldValue)) {
          skip = "skipped-shape";
          break;
        }
        const existing = splitMultilistValue(oldValue);
        const merged = new Set(
          existing.map((g) => normalizeGuid(g) ?? g.toLowerCase()).filter(Boolean)
        );
        for (const g of guidList!) merged.add(g);
        newValue = joinMultilistValue([...merged]);
        break;
      }
      case "remove": {
        if (!isPipeDelimitedGuidShape(oldValue)) {
          skip = "skipped-shape";
          break;
        }
        const existing = splitMultilistValue(oldValue);
        const toRemove = new Set(guidList!);
        const filtered = existing.map((g) => normalizeGuid(g) ?? g).filter((g) => !toRemove.has(g));
        newValue = joinMultilistValue(filtered);
        break;
      }
    }
    if (!skip && newValue === oldValue) {
      skip = "skipped-no-change";
    }
    plans.push({
      item,
      field: { name: matchingField.name, oldValue },
      newValue,
      ...(skip && { skip }),
    });
    if (plans.filter((p) => !p.skip).length >= maxMutations) {
      logger.warn(
        `Hit --max-mutations cap (${maxMutations}); ${scanned.length - plans.length} item(s) skipped. Re-run with a higher cap to widen.`
      );
      break;
    }
  }
  logger.verbose(
    `${plans.length} item(s) considered; ${plans.filter((p) => !p.skip).length} will mutate.`
  );

  const actions: FieldSetAction[] = await mapWithConcurrency(
    plans,
    async (plan): Promise<FieldSetAction> => {
      const base: Omit<FieldSetAction, "status" | "error"> = {
        itemId: plan.item.itemId,
        path: plan.item.path,
        templateName: plan.item.templateName,
        language: plan.item.language,
        fieldName: plan.field.name,
        mode,
        oldValue: plan.field.oldValue,
        newValue: plan.newValue,
      };
      if (plan.skip) return { ...base, status: plan.skip };
      if (options.whatIf) return { ...base, status: "what-if" };
      try {
        await client.updateItemFields({
          itemId: dashifyItemId(plan.item.itemId),
          fields: [{ name: plan.field.name, value: plan.newValue }],
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
  const skippedShape = actions.filter((a) => a.status === "skipped-shape").length;
  const summary = options.whatIf
    ? `Plan: would update ${actions.filter((a) => a.status === "what-if").length} item(s) [mode=${mode}].`
    : `Applied ${applied} update(s) [mode=${mode}]${failed > 0 ? `; ${failed} failed` : ""}${skippedShape > 0 ? `; ${skippedShape} skipped (incompatible shape)` : ""}.`;

  printReport({
    logger,
    command: "cleanup.field-set",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "applied" ? "" : `[${a.status}] `}${a.path} — ${a.fieldName}: ${a.oldValue.slice(0, 30) || "(empty)"} → ${a.newValue.slice(0, 30) || "(empty)"}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      field: options.field,
      mode,
      whatIf: Boolean(options.whatIf),
      maxMutations,
      appliedCount: applied,
      failedCount: failed,
      skippedShapeCount: skippedShape,
    },
    options,
  });

  return actions;
};

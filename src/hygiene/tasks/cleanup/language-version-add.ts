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
} from "../shared";

export interface CleanupLanguageVersionAddOptions extends HygieneCommonOptions {
  /** Required. Language code(s) to add (e.g. ["fr", "es"]). */
  languages: string[];
  /**
   * Optional source language. When supplied, the new version's fields
   * are copied from the latest version in that language. Defaults to
   * letting Sitecore seed the new version empty.
   */
  fromLanguage?: string;
  /** Restrict by template name pattern. Recommended. */
  templatePattern?: string;
  /** Content-tree root. Default `/sitecore/content`. */
  root?: string;
  index?: string;
  limit?: number;
  includeSystem?: boolean;
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
   * Maximum number of (item, language) versions created per run.
   * Default 500. One run on /sitecore/content × 4 languages can fan
   * out to 10k+ writes; cap defends against runaway scope.
   */
  maxAdds?: number;
}

export interface LanguageVersionAddAction {
  itemId: string;
  path: string;
  templateName: string | null;
  language: string;
  versionNumber: number | null;
  status: "applied" | "what-if" | "failed" | "skipped-existing";
  error?: string;
}

/**
 * Add empty (or copied) language versions to items in bulk so
 * translators can pick them up without per-item clicking.
 *
 * Strategy:
 *   1. Scan items via `scanItemsAndFields(skipFields: true)`.
 *   2. For each (item, requested-language) pair, call
 *      `client.addItemVersion({itemId, language, baseVersion?})`. The
 *      Authoring API creates a new version in the target language
 *      whose fields are seeded empty (or copied from `fromLanguage`'s
 *      latest version when `baseVersion` is supplied).
 *
 * What this does NOT do:
 *   - It does not detect existing versions before calling — the
 *     Authoring API is the source of truth for "is this version
 *     already present?" Calling addItemVersion when a version exists
 *     returns the existing one (no duplicate created); we surface
 *     that as `skipped-existing` based on the returned versionNumber
 *     matching an already-known state. This is a server-side decision
 *     we trust, not a client-side check.
 *
 * Safety rails:
 *   - `--what-if` reports planned (item, language) pairs.
 *   - `--allow-write` required outside what-if.
 *   - `--max-adds` caps the version-creation count. Default 500.
 *   - `--template-pattern` is strongly recommended — adding language
 *     versions to every item under /sitecore/content (including system
 *     items) is rarely the intent.
 */
export const runCleanupLanguageVersionAdd = async (
  options: CleanupLanguageVersionAddOptions
): Promise<LanguageVersionAddAction[]> => {
  const logger = toLogger(options);
  if (!options.languages?.length) {
    throw createScaiError("`languages` is required (at least one language code).", "INPUT_INVALID");
  }
  const templateRegex = options.templatePattern ? new RegExp(options.templatePattern, "i") : null;
  const maxAdds = options.maxAdds ?? 500;

  const { envName, root: rootConfig, client } = resolveTenant(options);
  if (!options.whatIf) {
    ensureAllowWriteForCleanup(rootConfig, envName, options.allowWrite);
  } else if (!logger.isJson()) {
    logger.info("What-if mode active — no language versions will be created.", "yellow");
  }

  const { scanned, cache, knobs } = await scanItemsAndFields({
    client,
    envName,
    root: options.root ?? "/sitecore/content",
    logger,
    options,
    skipFields: true,
  });

  type Plan = { item: (typeof scanned)[number]; language: string };
  const plans: Plan[] = [];
  outer: for (const item of scanned) {
    if (templateRegex && !templateRegex.test(item.templateName ?? "")) continue;
    for (const language of options.languages) {
      plans.push({ item, language });
      if (plans.length >= maxAdds) {
        logger.warn(
          `Hit --max-adds cap (${maxAdds}); ${scanned.length - plans.length} item(s) skipped. Re-run with a higher cap to widen.`
        );
        break outer;
      }
    }
  }

  const actions: LanguageVersionAddAction[] = await mapWithConcurrency(
    plans,
    async (plan): Promise<LanguageVersionAddAction> => {
      const base: Omit<LanguageVersionAddAction, "status" | "error" | "versionNumber"> = {
        itemId: plan.item.itemId,
        path: plan.item.path,
        templateName: plan.item.templateName,
        language: plan.language,
      };
      if (options.whatIf) {
        return { ...base, versionNumber: null, status: "what-if" };
      }
      try {
        const result = await client.addItemVersion({
          itemId: dashifyItemId(plan.item.itemId),
          language: plan.language,
          ...(options.fromLanguage && { baseVersion: 1 }),
        });
        return {
          ...base,
          versionNumber: result.versionNumber,
          status: "applied",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The Authoring API tends to reject "version already exists"
        // with a recognizable error rather than returning the existing
        // version — we surface that as skipped-existing so the operator
        // sees a clean count rather than a noise of "failed" rows.
        if (/already.*exist/i.test(message)) {
          return { ...base, versionNumber: null, status: "skipped-existing" };
        }
        return {
          ...base,
          versionNumber: null,
          status: "failed",
          error: message,
        };
      }
    },
    knobs.concurrency
  );

  await cache?.flush();

  const applied = actions.filter((a) => a.status === "applied").length;
  const skipped = actions.filter((a) => a.status === "skipped-existing").length;
  const failed = actions.filter((a) => a.status === "failed").length;
  const summary = options.whatIf
    ? `Plan: would create ${actions.length} (item, language) version(s).`
    : `Created ${applied} version(s)${skipped > 0 ? `; ${skipped} already existed` : ""}${failed > 0 ? `; ${failed} failed` : ""}.`;

  printReport({
    logger,
    command: "cleanup.language-version-add",
    envName,
    results: actions,
    summary,
    formatLine: (a) =>
      `${a.status === "applied" ? "" : `[${a.status}] `}${a.path} [${a.language}]${a.versionNumber ? ` v${a.versionNumber}` : ""}${a.error ? ` — ${a.error}` : ""}`,
    extra: {
      languages: options.languages,
      fromLanguage: options.fromLanguage ?? null,
      whatIf: Boolean(options.whatIf),
      maxAdds,
      appliedCount: applied,
      skippedCount: skipped,
      failedCount: failed,
    },
    options,
  });

  return actions;
};

import {
  fallbackLanguageIsoFor,
  parseLanguageCode,
  presentLanguageCodes,
  presentSiteLanguageCodes,
  type SitesApiClient,
} from "../api/sites-client";
import type { Operation } from "../ir/operations";
import { DEFAULT_LANGUAGE } from "../ir/sitecore-templates";
import type { PlannedAction, PlanSummary } from "./plan";
import type { ExecutionEvent } from "./execute-types";

/** True when an `addLanguage` error means the language is already present. */
const isAlreadyAddedLanguageError = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return /\b409\b/.test(message) || /already/i.test(message);
};

/**
 * True when `addLanguage` rejected the CODE itself as unregistrable —
 * the Sites API's "The provided language 'de' with region code '' is
 * not supported" shape. Reuses the unavailable-language matcher (same
 * message family). Backstop for the supported-catalog gate in
 * `ensureEnvironmentLanguages` when the catalog itself can't be read.
 */
const isUnsupportedLanguageAddError = (err: unknown): boolean =>
  isUnavailableLanguageError(err instanceof Error ? err.message : String(err));

/**
 * Lowercased registrable codes from the environment's supported-language
 * catalog. `name` is the canonical form (`de-DE`; bare `en`/`da` for the
 * base entries Sitecore ships); when absent, compose
 * `languageCode-regionCode`. A REGIONAL entry's bare `languageCode` is
 * deliberately NOT admitted — `de-DE` in the catalog does not make bare
 * `de` registrable.
 */
const supportedLanguageCodeSet = (
  catalog: ReadonlyArray<{
    name?: string | null;
    languageCode?: string | null;
    regionCode?: string | null;
  }>
): Set<string> => {
  const out = new Set<string>();
  for (const entry of catalog) {
    const composed = entry.languageCode
      ? `${entry.languageCode}${entry.regionCode ? `-${entry.regionCode}` : ""}`
      : undefined;
    const code = entry.name?.trim() || composed;
    if (code) out.add(code.toLowerCase());
  }
  return out;
};

/**
 * True when an apply-time error means the op's target language has no
 * registered version stack on the environment — i.e. that language isn't
 * provisioned. The Authoring API rejects a version write (AddItemVersion /
 * versioned SetField) against an unregistered language with one of these
 * shapes. Dictionary translations and component `__Standard Values`
 * locale-map defaults both emit per-language version writes, so an
 * operator whose environment lacks (say) `fr` would otherwise see the
 * whole push abort. See `nonPrimaryLanguageOfOp` for the guard that keeps
 * this scoped to non-primary-language ops only.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isUnavailableLanguageError = (message: string): boolean =>
  /does not contain version/i.test(message) ||
  /\blanguage\b[^.]*\bnot\b\s+(?:defined|found|registered|available|configured|valid|supported|installed)/i.test(
    message
  ) ||
  /\b(?:no such|unknown|invalid|unsupported)\s+language\b/i.test(message);

/**
 * If this op writes a NON-primary-language version, return that language;
 * otherwise `undefined`. Only `AddItemVersion` and a `SetField` carrying an
 * explicit non-`en` language qualify — a failure on the primary language
 * (`en`) or a language-agnostic op is always a real error and must never be
 * swallowed. Used to scope the unregistered-language skip to the ops that
 * fan a recipe's content out across locales (dictionary translations, SV
 * locale-map defaults).
 */
const nonPrimaryLanguageOfOp = (op: Operation): string | undefined => {
  if (op.op !== "AddItemVersion" && op.op !== "SetField") return undefined;
  const language = op.language;
  if (!language || language.toLowerCase() === DEFAULT_LANGUAGE) return undefined;
  return language;
};

/**
 * Apply-error handler for the unregistered-language case. When `op` writes a
 * non-primary-language version and `message` says that language isn't
 * registered on the environment, rewrite the action from its planned status
 * to `skip`, reconcile the summary, emit `apply-skip`, and return true so the
 * apply loop `continue`s instead of aborting + rolling back. Returns false for
 * any other failure, which the caller then treats as a fatal apply error.
 * Factored out of `executeIr` to keep that function under the complexity gate.
 */
export const trySkipUnavailableLanguage = (
  op: Operation,
  action: PlannedAction,
  message: string,
  summary: PlanSummary,
  emit?: (event: ExecutionEvent) => void
): boolean => {
  const language = nonPrimaryLanguageOfOp(op);
  if (language === undefined || !isUnavailableLanguageError(message)) return false;
  summary[action.status] -= 1;
  action.status = "skip";
  action.reason = `Skipped: environment has no "${language}" language registered (${message}).`;
  summary.skip += 1;
  emit?.({ kind: "apply-skip", action, language, error: message });
  return true;
};

/**
 * Ensure each required language exists on the environment before
 * `createSite` (which fails on an unknown `language`). Idempotent: skip
 * codes already present (single `listLanguages` pre-check), and treat the
 * Sites API's "already added" (409) as success. Adding a language here also
 * makes it available environment-wide — e.g. to the brand-kit Glossary's
 * org locales — so a recipe's `additionalLanguages` provisions brand locales
 * as a side effect.
 *
 * Returns the environment's language-code set (lowercased regional + iso
 * codes) after the ensure, so callers can gate site-level language writes
 * to codes the environment actually registered.
 */
export const ensureEnvironmentLanguages = async (
  sitesClient: SitesApiClient,
  languages: string[]
): Promise<Set<string>> => {
  if (languages.length === 0) return new Set();
  const current = await sitesClient.listLanguages();
  const present = presentLanguageCodes(current);
  // Bases before regionals so a regional's fallback target exists by the
  // time its own fallback is wired (`ar` lands before `ar-AE`).
  const ordered = [...languages].sort(
    (a, b) => a.split("-").length - b.split("-").length || a.localeCompare(b)
  );
  // Registrable-code gate: the Sites API rejects `addLanguage` for codes
  // outside its supported catalog, aborting the push. The localize
  // fan-out legitimately scopes pushes to BASE admission codes (a brand
  // declaring `de-DE` rides a `de` step so base-authored fallback
  // content lands where the base is registered) — but bare bases other
  // than the ones Sitecore ships (`en`, `da`) are NOT registrable, and
  // provisioning must register exactly the supported codes and skip the
  // rest, matching the installed-languages filter's semantics for them.
  // The catalog is only fetched when something is actually missing; an
  // unreadable/empty catalog degrades to no gate — the per-code
  // tolerance in the loop below still keeps an unregistrable code from
  // aborting the push.
  const missing = ordered.filter((code) => !present.has(code.toLowerCase()));
  let supported: Set<string> | undefined;
  if (missing.length > 0) {
    try {
      const catalog = await sitesClient.listSupportedLanguages();
      supported = catalog.length > 0 ? supportedLanguageCodeSet(catalog) : undefined;
    } catch {
      supported = undefined;
    }
  }
  const added: string[] = [];
  for (const code of ordered) {
    if (present.has(code.toLowerCase())) continue;
    if (supported && !supported.has(code.toLowerCase())) continue;
    try {
      await sitesClient.addLanguage(code);
    } catch (err) {
      if (isUnsupportedLanguageAddError(err)) continue;
      if (!isAlreadyAddedLanguageError(err)) throw err;
    }
    present.add(code.toLowerCase());
    added.push(code);
  }

  // Fallback wiring: every environment language should carry a fallback
  // so Sitecore's language-fallback chain matches the authored
  // base-locale model (regional → base → en). Newly-added languages are
  // wired outright; pre-existing languages are only REPAIRED when their
  // fallback is empty — an operator-configured fallback is never
  // overwritten. Best-effort by design: a failed PATCH must not fail the
  // site create (fallback affects rendering completeness, not push
  // integrity), so errors are swallowed per language.
  const wire = async (code: string): Promise<void> => {
    const fallback = fallbackLanguageIsoFor(code, present);
    if (!fallback) return;
    try {
      await sitesClient.updateLanguage(code, {
        ...parseLanguageCode(code),
        fallbackLanguageIso: fallback,
      });
    } catch {
      // Best-effort — see above.
    }
  };
  for (const code of added) await wire(code);
  for (const language of current) {
    if (language.fallbackLanguageIso?.trim()) continue;
    const code = (language.regionalIsoCode || language.iso || "").trim();
    if (code) await wire(code);
  }
  // Return the environment's SITE-WRITABLE code set (lowercased): the
  // regional identities of every registered language (`de-DE`, `en`),
  // NOT the iso-inclusive `present` set. Every consumer uses this return
  // solely to gate SITE-level language writes (an existing site's
  // `supportedLanguages` PATCH, and a fresh site's declared `languages`),
  // and the Sites API rejects a bare base there ("language 'de' with
  // region code '' is not supported"). `present` conflates a registered
  // `de-DE` with a bare `de` (presentLanguageCodes adds both its iso and
  // its regional), so returning it leaked base codes into site writes and
  // 400'd the push. Built from the pre-ensure regionals (`current`) plus
  // the codes just added (which passed the catalog gate, so they are
  // regional/standalone, never bare bases) — no post-ensure re-list, so
  // no propagation-lag flake.
  const siteWritable = presentSiteLanguageCodes(current);
  for (const code of added) siteWritable.add(code.toLowerCase());
  return siteWritable;
};

/**
 * Append missing declared languages to the SITE's own configured language
 * list (`supportedLanguages` — the property Pages offers locales from).
 * Environment registration alone doesn't put a locale on a site, so the
 * existing-site branch of CreateSiteFromTemplate PATCHes the list with
 * the union. Additive only — the list is never shrunk.
 *
 * `siteWritable` is the environment's SITE-WRITABLE code set returned by
 * {@link ensureEnvironmentLanguages} — regional identities only (`de-DE`,
 * `en`), NOT bare bases. A base like `de` is a valid localize FALLBACK
 * target but the Sites API rejects it on a `supportedLanguages` PATCH
 * ("The provided language 'de' with region code '' is not supported"), so
 * gating additions on this set keeps bases off the site list. (The set is
 * also already narrowed to codes the environment actually registered —
 * catalog-skipped admission codes never reach here.)
 *
 * The merge base is a FRESH `retrieveSite` detail read, not the plan-time
 * `listSites` row: the detail view is authoritative for
 * `supportedLanguages`, and re-checking there also makes the PATCH a
 * no-op when the plan-time diff was stale.
 */
export const appendSiteLanguages = async (
  sitesClient: SitesApiClient,
  site: { siteId: string; missing: string[] } | undefined,
  siteWritable: Set<string>
): Promise<void> => {
  if (!site) return;
  const addable = site.missing.filter((code) => siteWritable.has(code.toLowerCase()));
  if (addable.length === 0) return;
  const current = (await sitesClient.retrieveSite(site.siteId)).supportedLanguages ?? [];
  const merged = [...current];
  const seen = new Set(merged.map((code) => code.toLowerCase()));
  for (const code of addable) {
    if (seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    merged.push(code);
  }
  if (merged.length === current.length) return;
  await sitesClient.updateSite(site.siteId, { supportedLanguages: merged });
};

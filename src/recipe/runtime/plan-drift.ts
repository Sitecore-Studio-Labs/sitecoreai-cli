import type { FieldValue, RefValue } from "../ir/operations";
import { LAYOUT_FIELDS } from "../ir/sitecore-templates";
import { type MediaFallback, renderRefValue, resolveRecipeRefs } from "../api/ref-encoding";
import {
  layoutXmlEquivalent,
  layoutXmlEquivalentFromParsed,
  parseLayoutXml,
  type ParsedLayout,
} from "../layout/parse";
import type { RemoteItem } from "../api/client";
import {
  type BaselineIndex,
  canonicaliseGuidList,
  hashFieldValueForBaseline,
  isGuidListValue,
} from "./baseline";
import { classifyPushDrift } from "./merge";
import type { FieldDiffEntry, PlanOptions } from "./plan-types";
import { lookupField } from "./plan-refs";

/**
 * Classify a single drift entry against the baseline (three-way merge).
 * Returns `undefined` when no baseline is loaded — the caller leaves
 * `FieldDiffEntry.classification` unset and the legacy recipe-wins
 * behaviour applies.
 *
 * Layout fields (`__Renderings` / `__Final Renderings`) classify the
 * same way as plain fields — the baseline hash for them uses
 * `hashFieldValueForBaseline`, which parses the XML through
 * `parseLayoutXml` and serialises to a deterministic JSON form before
 * hashing. That collapses canonical vs SXA-delta wire form differences
 * so push + read round-trip cleanly. `layoutXmlEquivalent` still
 * handles the "before/after" raw-XML structural compare for the diff
 * `before`/`after` strings.
 */
interface ClassifyAgainstBaselineOptions {
  itemRefKey: string | undefined;
  fieldId: string;
  fieldName: string | undefined;
  language: string | undefined;
  version: number | undefined;
  recipeHash: string;
  tenantHash: string;
  baselineIndex: BaselineIndex | undefined;
}

const classifyAgainstBaseline = ({
  itemRefKey,
  fieldId,
  fieldName,
  language,
  version,
  recipeHash,
  tenantHash,
  baselineIndex,
}: ClassifyAgainstBaselineOptions): FieldDiffEntry["classification"] | undefined => {
  if (!baselineIndex || itemRefKey === undefined) return undefined;
  // Delegate the actual recipe/tenant/baseline who-moved decision to the
  // shared three-way core (mirrors the pull-side `classifyPullField`).
  // This layer only owns the baseline lookup + the no-baseline guard.
  const baselineHash = baselineIndex.lookup(itemRefKey, fieldId, fieldName, language, version);
  return classifyPushDrift(recipeHash, tenantHash, baselineHash);
};

interface FieldDriftOptions {
  itemRefKey?: string;
  baselineIndex?: BaselineIndex;
  mediaFallbacks?: ReadonlyMap<string, MediaFallback>;
}

export const computeFieldDrift = (
  desired: FieldValue[],
  remote: RemoteItem,
  capturedItemIds: ReadonlyMap<string, string>,
  { itemRefKey, baselineIndex, mediaFallbacks }: FieldDriftOptions = {}
): FieldDiffEntry[] => {
  const drift: FieldDiffEntry[] = [];
  for (const field of desired) {
    const resolvedValue: RefValue = resolveRecipeRefs(field.value, capturedItemIds, mediaFallbacks);
    const want = renderRefValue(resolvedValue);
    const found = lookupField(
      remote,
      field.fieldId,
      field.fieldName,
      field.language,
      field.version
    );
    if (!found) {
      drift.push({
        fieldId: field.fieldId,
        before: null,
        after: want,
        language: field.language,
        version: field.version,
        ...(baselineIndex && itemRefKey !== undefined
          ? {
              classification: classifyAgainstBaseline({
                itemRefKey,
                fieldId: field.fieldId,
                fieldName: field.fieldName,
                language: field.language,
                version: field.version,
                recipeHash: hashFieldValueForBaseline(field.fieldId, want),
                // No tenant value → distinct from any hash → forces
                // recipe-change vs first-push purely on baseline presence.
                tenantHash: "",
                baselineIndex,
              }),
            }
          : {}),
      });
      continue;
    }
    // Layout fields (`__Renderings` / `__Final Renderings`) carry XML
    // that Sitecore's layout pipeline normalises on write (canonical →
    // SXA delta, plus baseline `<p:da>` directives). A raw string
    // compare would report a phantom update on every re-push, so diff
    // them structurally — same placements ⇒ no drift.
    //
    // Performance: parse each side ONCE per drift, then reuse the
    // parsed values for both the equivalence check AND the canonical
    // hash. Without dedup the drift path parses each value twice
    // (once in `layoutXmlEquivalent`, once in
    // `hashFieldValueForBaseline → canonicaliseLayoutXml`); for
    // multi-lang/multi-version Pages with many layout cells that 4×
    // parse cost compounded.
    const isLayoutField =
      field.fieldId === LAYOUT_FIELDS.RENDERINGS ||
      field.fieldId === LAYOUT_FIELDS.FINAL_RENDERINGS;
    let wantParsed: ParsedLayout | undefined;
    let foundParsed: ParsedLayout | undefined;
    if (isLayoutField) {
      try {
        wantParsed = parseLayoutXml(want);
        foundParsed = parseLayoutXml(found.value);
      } catch {
        // One side failed to parse — fall back to the slower path,
        // which itself catches + degrades to string equality.
      }
    }
    // GUID-list values (`__Masters`, `__Base template`, droplinks) get a
    // representation-insensitive compare (brace form / case; order still
    // meaningful) — the GUID-list analogue of the layout-XML structural
    // diff above. Raw byte compare reported phantom drift whenever the
    // tenant's stored form differed from scai's `toCurly` emission.
    const equal = isLayoutField
      ? wantParsed && foundParsed
        ? layoutXmlEquivalentFromParsed(wantParsed, foundParsed)
        : layoutXmlEquivalent(found.value, want)
      : found.value === want ||
        (isGuidListValue(want) &&
          isGuidListValue(found.value) &&
          canonicaliseGuidList(want) === canonicaliseGuidList(found.value));
    if (!equal) {
      const classification = classifyAgainstBaseline({
        itemRefKey,
        fieldId: field.fieldId,
        fieldName: field.fieldName,
        language: field.language,
        version: field.version,
        recipeHash: hashFieldValueForBaseline(field.fieldId, want, wantParsed),
        tenantHash: hashFieldValueForBaseline(field.fieldId, found.value, foundParsed),
        baselineIndex,
      });
      drift.push({
        fieldId: field.fieldId,
        before: found.value,
        after: want,
        language: field.language,
        version: field.version,
        ...(classification !== undefined && { classification }),
      });
    }
  }
  return drift;
};

/**
 * Reduce a drift array (with optional baseline classifications) to a
 * resolved status under the given conflict policy.
 *
 *   - No drift → `null` (caller emits the existing `"skip"` action).
 *   - No baseline → legacy `"update"` regardless of policy.
 *   - All drift is `recipe-change` or `first-push` → safe `"update"`.
 *   - Any drift is `conflict` → applies the policy:
 *       error → `"conflict"`; recipe-wins → `"update"`; cms-wins → `"skip"`.
 *   - Otherwise drift contains `cms-edit` (but no `conflict`):
 *       error → `"conflict"`; recipe-wins → `"update"`; cms-wins → `"skip"`.
 *     `cms-edit` flips to `"conflict"` under default policy because
 *     applying the recipe value WOULD overwrite the author's edit —
 *     even though the recipe value matches the baseline. (The recipe
 *     didn't change, but the tenant did; the operator should know.)
 *
 * The caller still owns mutation construction; this helper is purely
 * the status reducer.
 */
export const resolveConflictStatus = (
  drift: FieldDiffEntry[],
  conflictPolicy: PlanOptions["conflictPolicy"]
): { status: "update" | "conflict" | "skip"; reason?: string } => {
  const classifications = drift
    .map((d) => d.classification)
    .filter((c): c is NonNullable<FieldDiffEntry["classification"]> => c !== undefined);
  if (classifications.length === 0) {
    // No baseline classifications → legacy behaviour: every drift is
    // recipe-wins update.
    return { status: "update" };
  }
  const hasConflict = classifications.includes("conflict");
  const hasCmsEdit = classifications.includes("cms-edit");
  if (!hasConflict && !hasCmsEdit) {
    return { status: "update" };
  }
  const policy = conflictPolicy ?? "error";
  if (policy === "recipe-wins") {
    return {
      status: "update",
      reason: hasConflict
        ? "conflict resolved as recipe-wins (clobbering author edit AND recipe change)"
        : "cms-edit overridden as recipe-wins (clobbering author edit)",
    };
  }
  if (policy === "cms-wins") {
    return {
      status: "skip",
      reason: hasConflict
        ? "conflict resolved as cms-wins (preserving author edit; recipe change dropped)"
        : "cms-edit preserved as cms-wins (recipe value matches baseline; tenant ahead)",
    };
  }
  return {
    status: "conflict",
    reason: hasConflict
      ? "conflict: tenant and recipe both diverged from baseline — pass --conflict-policy=recipe-wins or =cms-wins to resolve"
      : "cms-edit: author edited tenant after last push; recipe would clobber. Pass --conflict-policy=recipe-wins or =cms-wins to resolve",
  };
};

/**
 * Brief-instance baseline — per-element + per-field SHA-256 hashes
 * captured after a successful push, replayed during the next push for
 * three-way merge classification.
 *
 * The brief recipe surfaces five top-level elements (`briefTypeName`,
 * `locale`, `status`, `isTemplate`, `fields`) plus the per-field map
 * inside `fields`. The baseline hashes each as one entry so the
 * planner can compare R/C/B per-cell:
 *
 *   R == B && C == B   → noop
 *   R != B && C == B   → recipe-change (safe update)
 *   R == B && C != B   → cms-edit (author edited the field in Sitecore AI)
 *   R != B && C != B   → conflict (both moved)
 *
 * See sibling docs in `src/sync/baseline.ts` for the
 * `FieldClassification` vocabulary.
 */
import { createHash } from "node:crypto";
import type { Baseline, FieldClassification } from "@/sync";
import type { BriefInstanceRecipe } from "./instance-schema";

const TOP_LEVEL_ELEMENTS = [
  "briefTypeName",
  "locale",
  "status",
  "isTemplate",
] as const;

type TopLevelKey = (typeof TOP_LEVEL_ELEMENTS)[number];

/**
 * Stable canonical JSON — sorted keys, no whitespace. Two structurally
 * equal values hash identical regardless of key order. The brief field
 * map is `Record<string, unknown>`, so values can be ProseMirror
 * documents, ISO date strings, numbers, etc. — all serialize through
 * this.
 */
export const stableStringify = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

const sha256 = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

/** Hash one recipe value (top-level or per-field) for baseline storage. */
export const hashBriefValue = (value: unknown): string => sha256(stableStringify(value));

/**
 * Brief baseline payload — per-element + per-field-name hash map.
 * Lives inside `Baseline.payload` so the envelope (`schemaVersion`,
 * `kind`, `recipeHandle`, `envName`, `capturedAt`) stays shared with
 * every other kind's baseline.
 */
export interface BriefBaselinePayload {
  /** Schema version for the brief baseline payload specifically. */
  schemaVersion: "1";
  /** Per-top-level-element hash. Absent → never written before. */
  elements: Partial<Record<TopLevelKey, string>>;
  /** Per-field hash, keyed by `BriefField.name` (Z fields). */
  fields: Record<string, string>;
}

export type BriefBaseline = Baseline<BriefBaselinePayload>;

/** Construct a baseline payload from a successfully applied recipe. */
export const captureBriefBaselinePayload = (
  recipe: BriefInstanceRecipe
): BriefBaselinePayload => ({
  schemaVersion: "1",
  elements: {
    briefTypeName: hashBriefValue(recipe.briefTypeName),
    locale: hashBriefValue(recipe.locale),
    status: hashBriefValue(recipe.status),
    isTemplate: hashBriefValue(recipe.isTemplate),
  },
  fields: Object.fromEntries(
    Object.entries(recipe.fields ?? {}).map(([name, value]) => [name, hashBriefValue(value)])
  ),
});

/**
 * Per-element three-way classification computed from desired (recipe),
 * current (tenant), and baseline hashes.
 *
 *   - desired and current agree, both match baseline → noop
 *   - desired differs from baseline, current matches baseline → recipe-change
 *   - desired matches baseline, current differs → cms-edit
 *   - both differ from baseline → conflict
 *   - no baseline entry → first-push (planner can't classify safely)
 */
export const classifyBriefValue = (
  desiredHash: string,
  currentHash: string,
  baselineHash: string | undefined
): FieldClassification => {
  if (baselineHash === undefined) return "first-push";
  const recipeUnchanged = desiredHash === baselineHash;
  const tenantUnchanged = currentHash === baselineHash;
  if (recipeUnchanged && tenantUnchanged) return "recipe-change"; // both equal baseline; treat as recipe-change with R==C → planner sees no-op via equality already
  if (!recipeUnchanged && tenantUnchanged) return "recipe-change";
  if (recipeUnchanged && !tenantUnchanged) return "cms-edit";
  return "conflict";
};

export { TOP_LEVEL_ELEMENTS };
export type { TopLevelKey };

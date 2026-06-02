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
import { classifyHashes, hashJsonValue, type Baseline, type FieldClassification } from "@/sync";
import type { BriefInstanceRecipe } from "./instance-schema";

const TOP_LEVEL_ELEMENTS = ["briefTypeName", "locale", "status", "isTemplate"] as const;

type TopLevelKey = (typeof TOP_LEVEL_ELEMENTS)[number];

/** Hash one recipe value (top-level or per-field) for baseline storage. */
export const hashBriefValue = (value: unknown): string => hashJsonValue(value);

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
export const captureBriefBaselinePayload = (recipe: BriefInstanceRecipe): BriefBaselinePayload => ({
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

/** Three-way classify one brief cell. Delegates to the shared helper. */
export const classifyBriefValue = (
  desiredHash: string,
  currentHash: string,
  baselineHash: string | undefined
): FieldClassification => classifyHashes(desiredHash, currentHash, baselineHash);

export { TOP_LEVEL_ELEMENTS };
export type { TopLevelKey };

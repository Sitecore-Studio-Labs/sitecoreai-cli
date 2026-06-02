/**
 * Brand-kit baseline — per-cell SHA-256 hashes for three-way merge
 * across the kit's metadata and its sections × fields grid.
 *
 * Cell-path scheme (flat namespace):
 *   - `kit.description`                       — kit-level scalar
 *   - `kit.industry`                          — kit-level scalar
 *   - `sections.<section>.<field>`            — per-field value
 *
 * The diff today emits writes only for fields (no kit-metadata update
 * endpoint is verified on the Brand Management API). Kit-level
 * classifications are informational; the meaningful three-way merge
 * surface is the per-field grid where `updateBrandKitField` writes
 * and the EnrichSections pipeline may concurrently author values.
 *
 * `documents[]` is input-only — it drives the ingestion pipeline at
 * apply time. It does not participate in compare and gets no baseline.
 */
import type { Baseline, FieldClassification } from "@/sync";
import { classifyCellHashMaps, hashJsonValue, resolveCellByPolicy } from "@/sync";
import type { BrandFieldValue, BrandKitRecipe } from "./schema";

export interface BrandBaselinePayload {
  schemaVersion: "1";
  cells: Record<string, string>;
}

export type BrandBaseline = Baseline<BrandBaselinePayload>;

const kitCellPath = (element: "description" | "industry"): string => `kit.${element}`;
const fieldCellPath = (section: string, field: string): string => `sections.${section}.${field}`;

/**
 * Walk a brand-kit recipe and emit per-cell hashes. `documents` is
 * deliberately omitted — it's input-only ingestion fuel, not a
 * write-back surface.
 */
export const hashBrandCells = (recipe: BrandKitRecipe): Record<string, string> => {
  const cells: Record<string, string> = {};
  cells[kitCellPath("description")] = hashJsonValue(recipe.description);
  cells[kitCellPath("industry")] = hashJsonValue(recipe.industry);
  for (const [section, fields] of Object.entries(recipe.sections)) {
    for (const [field, value] of Object.entries(fields)) {
      cells[fieldCellPath(section, field)] = hashJsonValue(value);
    }
  }
  return cells;
};

export const captureBrandBaselinePayload = (recipe: BrandKitRecipe): BrandBaselinePayload => ({
  schemaVersion: "1",
  cells: hashBrandCells(recipe),
});

/**
 * Three-way classify every cell across desired / current / baseline.
 * Cells present in only one side classify against `hashJsonValue(undefined)`
 * on the other.
 */
export const classifyBrandCells = (
  desired: BrandKitRecipe,
  current: BrandKitRecipe,
  baselinePayload: BrandBaselinePayload | undefined
): Record<string, FieldClassification> =>
  classifyCellHashMaps(hashBrandCells(desired), hashBrandCells(current), baselinePayload?.cells);

/**
 * Merge desired vs current per the policy and return a brand-kit
 * recipe whose `sections` carry policy-resolved values. Kit-level
 * metadata (description, industry) takes the policy-resolved choice
 * even though apply has no write path for it — keeps the in-memory
 * recipe coherent for downstream consumers (logs, registry persistence
 * after pull, etc.).
 */
export const mergeBrandByPolicy = (
  desired: BrandKitRecipe,
  current: BrandKitRecipe,
  classifications: Record<string, FieldClassification>,
  policy: "error" | "recipe-wins" | "cms-wins"
): {
  merged: BrandKitRecipe;
  policyErrors: Array<{ path: string; classification: FieldClassification }>;
} => {
  const policyErrors: Array<{ path: string; classification: FieldClassification }> = [];

  const pickKit = <K extends "description" | "industry">(element: K) => {
    const path = kitCellPath(element);
    const res = resolveCellByPolicy(classifications[path] ?? "first-push", policy);
    if (res === "policyError") {
      policyErrors.push({ path, classification: classifications[path] });
      return desired[element];
    }
    return res === "current" ? current[element] : desired[element];
  };

  // Build merged sections from the union of section names so a cms-wins
  // policy can preserve a tenant-only section value. Recipe-author
  // intent for the section/field SHAPE stays additive-only — we don't
  // pull tenant-only sections into the merged recipe unless the recipe
  // already declared the section (the recipe owns the section graph).
  const mergedSections: BrandKitRecipe["sections"] = {};
  const sectionNames = new Set([
    ...Object.keys(desired.sections),
    ...Object.keys(current.sections),
  ]);
  for (const section of sectionNames) {
    const desiredFields = desired.sections[section];
    if (!desiredFields) continue; // Recipe doesn't declare this section.
    const currentFields = current.sections[section] ?? {};
    const fieldNames = new Set([...Object.keys(desiredFields), ...Object.keys(currentFields)]);
    const mergedFields: Record<string, BrandFieldValue> = {};
    for (const field of fieldNames) {
      const inDesired = Object.prototype.hasOwnProperty.call(desiredFields, field);
      if (!inDesired) continue; // Tenant-only field; recipe didn't ask for it.
      const path = fieldCellPath(section, field);
      const res = resolveCellByPolicy(classifications[path] ?? "first-push", policy);
      if (res === "policyError") {
        policyErrors.push({ path, classification: classifications[path] });
        mergedFields[field] = desiredFields[field];
      } else if (res === "current" && currentFields[field] !== undefined) {
        mergedFields[field] = currentFields[field];
      } else {
        mergedFields[field] = desiredFields[field];
      }
    }
    if (Object.keys(mergedFields).length > 0) mergedSections[section] = mergedFields;
  }

  const merged: BrandKitRecipe = {
    name: desired.name,
    description: pickKit("description"),
    industry: pickKit("industry"),
    documents: desired.documents,
    sections: mergedSections,
  };

  return { merged, policyErrors };
};

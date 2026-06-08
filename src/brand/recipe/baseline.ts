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
  /**
   * Server UUID of the brand kit this baseline was captured against.
   * When present, apply prefers id-match via `getBrandKit(id)` before
   * falling back to name-based resolution. Survives a kit name edit
   * between pushes without orphaning the existing tenant row.
   */
  tenantId?: string;
}

export type BrandBaseline = Baseline<BrandBaselinePayload>;

const kitCellPath = (element: "description" | "industry"): string => `kit.${element}`;
const fieldCellPath = (section: string, field: string): string => `sections.${section}.${field}`;

/**
 * Walk a brand-kit recipe and emit per-cell hashes.
 *
 * `documents` is deliberately omitted — it's input-only ingestion fuel,
 * not a write-back surface.
 *
 * `description` and `industry` are ALSO omitted. They are Sitecore-owned
 * kit metadata: written once at `createBrandKit` time and never again by
 * the converge loop (there is no field-write path for them). But
 * `readCurrent` always populates them from the live kit, while a pushed
 * recipe omits them (the registry renders them read-only). Hashing them
 * here made `desired` (undefined) perpetually diverge from `current`
 * (live value), so the three-way merge classified both as a `cms-edit`
 * on every push — and under `--conflict-policy error` the planner
 * refuses before any writes, breaking push entirely for content that is
 * otherwise unchanged. They have no business in a write-back diff, so
 * keep them out of the merge surface.
 */
export const hashBrandCells = (recipe: BrandKitRecipe): Record<string, string> => {
  const cells: Record<string, string> = {};
  for (const [section, fields] of Object.entries(recipe.sections)) {
    for (const [field, value] of Object.entries(fields)) {
      cells[fieldCellPath(section, field)] = hashJsonValue(value);
    }
  }
  return cells;
};

export const captureBrandBaselinePayload = (
  recipe: BrandKitRecipe,
  tenantId?: string
): BrandBaselinePayload => ({
  schemaVersion: "1",
  cells: hashBrandCells(recipe),
  ...(tenantId ? { tenantId } : {}),
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
    // sectionProperties is not yet part of three-way classification —
    // pass through the recipe-author intent verbatim. When/if Sitecore
    // exposes a write path for `sourceLanguage`, classify by cell at
    // path `sectionProperties.<section>.sourceLanguage` and resolve here.
    sectionProperties: desired.sectionProperties,
  };

  return { merged, policyErrors };
};

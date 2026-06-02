/**
 * Brief-type baseline — per-cell SHA-256 hashes for three-way merge
 * across the type's metadata and its `fields[]` array.
 *
 * Cell-path scheme (flat namespace, mirrors brand-kit's
 * `BrandBaselinePayload.cells`):
 *
 *   - `name`                — top-level codename
 *   - `label`               — localized human label
 *   - `description`         — human description
 *   - `icon`                — mdi icon codepoint
 *   - `iconColor`           — hex/named color
 *   - `fields.<codename>`   — whole field-definition object, keyed by
 *                             `BriefField.name`
 *
 * Hashing the whole field-definition object per codename keeps the
 * cell count proportional to the field count without dragging in
 * per-property classifications — a localized-label edit on a single
 * field surfaces as a `fields.<codename>` cms-edit, not five separate
 * intra-field cells. That mirrors how the API converges a brief type:
 * the only write path is a whole-record PUT, so per-property cells
 * would not give the operator finer control anyway.
 *
 * `fields[]` is array-ordered on the wire; the API preserves display
 * order. Adds/removes/reorders show up as `first-push` (new codename),
 * cms-side delete (codename absent from desired, present in baseline +
 * current), or a position-only edit. Position changes alone don't
 * register because the cell hash is over the field object content,
 * not its index — that's intentional: registry-author intent is the
 * field-definition graph, position drift is noise.
 */
import { classifyCellHashMaps, hashJsonValue, type FieldClassification } from "@/sync";
import type { Baseline } from "@/sync";
import { resolveCellByPolicy } from "@/sync";
import type { BriefRecipeField, BriefTypeRecipe } from "./schema";

export interface BriefTypeBaselinePayload {
  schemaVersion: "1";
  /** Flat path → SHA-256 hash. See module doc for the path vocabulary. */
  cells: Record<string, string>;
}

export type BriefTypeBaseline = Baseline<BriefTypeBaselinePayload>;

/** The five top-level scalars that participate in three-way merge. */
const SCALAR_CELLS = ["name", "label", "description", "icon", "iconColor"] as const;
type ScalarCell = (typeof SCALAR_CELLS)[number];

const fieldCellPath = (codename: string): string => `fields.${codename}`;

/**
 * Walk a brief-type recipe and emit per-cell hashes. Each scalar is its
 * own cell; each field-definition is one cell keyed by its codename.
 */
export const hashBriefTypeCells = (recipe: BriefTypeRecipe): Record<string, string> => {
  const cells: Record<string, string> = {};
  for (const scalar of SCALAR_CELLS) {
    cells[scalar] = hashJsonValue(recipe[scalar]);
  }
  for (const field of recipe.fields ?? []) {
    cells[fieldCellPath(field.name)] = hashJsonValue(field);
  }
  return cells;
};

/** Construct a baseline payload from a successfully applied recipe. */
export const captureBriefTypeBaselinePayload = (
  recipe: BriefTypeRecipe
): BriefTypeBaselinePayload => ({
  schemaVersion: "1",
  cells: hashBriefTypeCells(recipe),
});

/**
 * Three-way classify every cell across desired / current / baseline.
 * Cells present in only one side classify against `hashJsonValue(undefined)`
 * on the other.
 */
export const classifyBriefTypeCells = (
  desired: BriefTypeRecipe,
  current: BriefTypeRecipe,
  baselinePayload: BriefTypeBaselinePayload | undefined
): Record<string, FieldClassification> =>
  classifyCellHashMaps(
    hashBriefTypeCells(desired),
    hashBriefTypeCells(current),
    baselinePayload?.cells
  );

/**
 * Merge desired vs current per the policy and return a brief-type
 * recipe whose scalars + `fields[]` carry policy-resolved values.
 *
 * Tenant-only fields (codename absent from desired) are NOT pulled
 * into the merged recipe even under `cms-wins` — the recipe author
 * owns the field graph, mirroring brand-kit's section-graph ownership.
 * A cms-side delete on a recipe-declared field IS preserved under
 * `cms-wins` only by skipping the recipe value, which doesn't model
 * well on a whole-record PUT — see the inline comment in the field
 * loop for the chosen behaviour.
 */
export const mergeBriefTypeByPolicy = (
  desired: BriefTypeRecipe,
  current: BriefTypeRecipe,
  classifications: Record<string, FieldClassification>,
  policy: "error" | "recipe-wins" | "cms-wins"
): {
  merged: BriefTypeRecipe;
  policyErrors: Array<{ path: string; classification: FieldClassification }>;
} => {
  const policyErrors: Array<{ path: string; classification: FieldClassification }> = [];

  const pickScalar = <K extends ScalarCell>(key: K): BriefTypeRecipe[K] => {
    const res = resolveCellByPolicy(classifications[key] ?? "first-push", policy);
    if (res === "policyError") {
      policyErrors.push({ path: key, classification: classifications[key] });
      return desired[key];
    }
    return res === "current" ? current[key] : desired[key];
  };

  // Build per-codename indexes so the merge walks one pass over the
  // union of names.
  const desiredByName = new Map<string, BriefRecipeField>();
  for (const field of desired.fields ?? []) desiredByName.set(field.name, field);
  const currentByName = new Map<string, BriefRecipeField>();
  for (const field of current.fields ?? []) currentByName.set(field.name, field);

  // Preserve the recipe-author's display order for codenames present
  // in desired; append codenames only present in current (which we
  // ultimately drop, per the field-ownership rule below) at the end so
  // classification tests can still iterate the union.
  const orderedNames: string[] = [];
  for (const field of desired.fields ?? []) orderedNames.push(field.name);
  for (const field of current.fields ?? []) {
    if (!desiredByName.has(field.name)) orderedNames.push(field.name);
  }

  const mergedFields: BriefRecipeField[] = [];
  for (const name of orderedNames) {
    const inDesired = desiredByName.has(name);
    if (!inDesired) {
      // Tenant-only field — the recipe author didn't ask for it. Drop
      // it from the merged recipe regardless of policy, mirroring
      // brand-kit's "recipe owns the field graph" rule. The
      // classification still surfaces on the plan so the operator sees
      // it (a delete of a tenant-only field is informational).
      continue;
    }
    const path = fieldCellPath(name);
    const cls = classifications[path] ?? "first-push";
    const res = resolveCellByPolicy(cls, policy);
    if (res === "policyError") {
      policyErrors.push({ path, classification: cls });
      mergedFields.push(desiredByName.get(name)!);
    } else if (res === "current") {
      // cms-wins on a cms-edit/conflict cell: keep the tenant's field
      // definition. If the tenant has DELETED the field (not present
      // in current), the cms-wins choice is "preserve the delete" — we
      // drop it from the merged recipe. The whole-record PUT then
      // omits the field, converging the type back to the tenant's
      // post-delete shape.
      const tenantField = currentByName.get(name);
      if (tenantField) mergedFields.push(tenantField);
      // else: cms-side delete preserved by omission.
    } else {
      mergedFields.push(desiredByName.get(name)!);
    }
  }

  const merged: BriefTypeRecipe = {
    name: pickScalar("name"),
    label: pickScalar("label"),
    description: pickScalar("description"),
    icon: pickScalar("icon"),
    iconColor: pickScalar("iconColor"),
    fields: mergedFields,
  };

  return { merged, policyErrors };
};

export { SCALAR_CELLS, fieldCellPath };
export type { ScalarCell };

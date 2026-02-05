import { FieldFilter } from "./types";

export type FieldFilterSet = {
  excludes: Set<string>;
};

export const createFieldFilterSet = (
  rootExcluded: FieldFilter[],
  moduleExcluded: FieldFilter[]
): FieldFilterSet => {
  const set = new Set<string>();
  for (const field of rootExcluded) {
    if (field.fieldId) {
      set.add(field.fieldId.toLowerCase());
    }
  }
  for (const field of moduleExcluded) {
    if (field.fieldId) {
      set.add(field.fieldId.toLowerCase());
    }
  }

  return { excludes: set };
};

export const filterFieldIds = (filterSet: FieldFilterSet): string[] =>
  Array.from(filterSet.excludes.values());

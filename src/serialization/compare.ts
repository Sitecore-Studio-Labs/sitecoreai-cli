import { ItemData, ItemFieldValue, ItemLanguage, ItemVersion } from "./types";

export type FieldComparisonResult = {
  leftField: ItemFieldValue | null;
  rightField: ItemFieldValue | null;
};

export type ItemLanguageComparisonResult = {
  language: ItemLanguage;
  changedFields: FieldComparisonResult[];
};

export type ItemVersionComparisonResult = {
  leftVersion: ItemVersion | null;
  rightVersion: ItemVersion | null;
  changedFields: FieldComparisonResult[];
  versionNumber: number;
  language: string;
};

export type ItemComparisonResult = {
  leftItem: ItemData;
  rightItem: ItemData;
  isRenamed: boolean;
  isMoved: boolean;
  isTemplateChanged: boolean;
  isBranchChanged: boolean;
  changedSharedFields: FieldComparisonResult[];
  changedUnversionedFields: ItemLanguageComparisonResult[];
  changedVersions: ItemVersionComparisonResult[];
};

const stripNewlines = (value: string): string => value.replace(/\r/g, "").replace(/\n/g, "");

const getFieldDifferences = (
  left: ItemFieldValue[],
  right: ItemFieldValue[]
): FieldComparisonResult[] => {
  const leftIndex = new Map(left.map((field) => [field.fieldId, field]));
  const rightIndex = new Map(right.map((field) => [field.fieldId, field]));

  const results: FieldComparisonResult[] = [];

  for (const [id, field] of leftIndex) {
    if (!rightIndex.has(id)) {
      results.push({ leftField: field, rightField: null });
    }
  }

  for (const [id, field] of rightIndex) {
    if (!leftIndex.has(id)) {
      results.push({ leftField: null, rightField: field });
    }
  }

  for (const [id, rightField] of rightIndex) {
    const leftField = leftIndex.get(id);
    if (!leftField) {
      continue;
    }

    const leftValue = leftField.value ?? "";
    const rightValue = rightField.value ?? "";
    const blobDifferent =
      leftField.blobId && rightField.blobId && leftField.blobId !== rightField.blobId;

    if (blobDifferent || stripNewlines(leftValue) !== stripNewlines(rightValue)) {
      results.push({ leftField, rightField });
    }
  }

  return results;
};

const getUnversionedDifferences = (
  left: ItemData,
  right: ItemData
): ItemLanguageComparisonResult[] => {
  const results: ItemLanguageComparisonResult[] = [];
  const leftIndex = new Map(
    left.unversionedFields.map((language) => [language.language, language])
  );
  const rightIndex = new Map(
    right.unversionedFields.map((language) => [language.language, language])
  );

  for (const [language, rightLanguage] of rightIndex) {
    if (!leftIndex.has(language)) {
      results.push({
        language: rightLanguage,
        changedFields: rightLanguage.fields.map((field) => ({
          leftField: null,
          rightField: field,
        })),
      });
    }
  }

  for (const [language, leftLanguage] of leftIndex) {
    if (!rightIndex.has(language)) {
      results.push({
        language: leftLanguage,
        changedFields: leftLanguage.fields.map((field) => ({ leftField: field, rightField: null })),
      });
    }
  }

  for (const [language, leftLanguage] of leftIndex) {
    const rightLanguage = rightIndex.get(language);
    if (!rightLanguage) {
      continue;
    }
    const changes = getFieldDifferences(leftLanguage.fields, rightLanguage.fields);
    if (changes.length > 0) {
      results.push({ language: leftLanguage, changedFields: changes });
    }
  }

  return results;
};

const getVersionDifferences = (left: ItemData, right: ItemData): ItemVersionComparisonResult[] => {
  const results: ItemVersionComparisonResult[] = [];
  const findVersion = (
    item: ItemData,
    language: string,
    version: number
  ): ItemVersion | undefined =>
    item.versions.find(
      (ver) => ver.language.toLowerCase() === language.toLowerCase() && ver.version === version
    );

  for (const rightVersion of right.versions) {
    if (!findVersion(left, rightVersion.language, rightVersion.version)) {
      results.push({
        leftVersion: null,
        rightVersion,
        changedFields: rightVersion.fields.map((field) => ({ leftField: null, rightField: field })),
        versionNumber: rightVersion.version,
        language: rightVersion.language,
      });
    }
  }

  for (const leftVersion of left.versions) {
    if (!findVersion(right, leftVersion.language, leftVersion.version)) {
      results.push({
        leftVersion,
        rightVersion: null,
        changedFields: leftVersion.fields.map((field) => ({ leftField: field, rightField: null })),
        versionNumber: leftVersion.version,
        language: leftVersion.language,
      });
    }
  }

  for (const leftVersion of left.versions) {
    const rightVersion = findVersion(right, leftVersion.language, leftVersion.version);
    if (!rightVersion) {
      continue;
    }
    const changedFields = getFieldDifferences(leftVersion.fields, rightVersion.fields);
    if (changedFields.length > 0) {
      results.push({
        leftVersion,
        rightVersion,
        changedFields,
        versionNumber: leftVersion.version,
        language: leftVersion.language,
      });
    }
  }

  return results;
};

export const compareItems = (left: ItemData, right: ItemData): ItemComparisonResult => {
  return {
    leftItem: left,
    rightItem: right,
    isRenamed: left.name !== right.name,
    isMoved: left.parentId !== right.parentId,
    isTemplateChanged: left.templateId !== right.templateId,
    isBranchChanged: (left.branchId ?? "") !== (right.branchId ?? ""),
    changedSharedFields: getFieldDifferences(left.sharedFields, right.sharedFields),
    changedUnversionedFields: getUnversionedDifferences(left, right),
    changedVersions: getVersionDifferences(left, right),
  };
};

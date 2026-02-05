import crypto from "node:crypto";
import { ItemData } from "./types";

const DEFAULT_EXCLUDED_FIELDS = new Set<string>([
  "B1E16562-F3F9-4DDD-84CA-6E099950ECC0", // LastRun
  "52807595-0F8F-4B20-8D2A-CB71D28C6103", // Owner
  "8CDC337E-A112-42FB-BBB4-4143751E123F", // Revision
  "D9CF14B1-FA16-4BA6-9288-E8A174D4D522", // Updated
  "BADD9CF9-53E0-4D0C-BCC0-2D784C282F6A", // UpdatedBy
  "001DD393-96C5-490B-924A-B0F25CD9EFD8", // Lock
]);

const stripNewLines = (value: string): string => value.replace(/\r/g, "").replace(/\n/g, "");

export const createDataSignatureBase = (item: ItemData, forceBlobRestore = false): string => {
  const basis: string[] = [item.templateId];

  const processField = (field: {
    fieldId: string;
    value: string;
    blobId?: string | null;
  }): void => {
    const fieldId = field.fieldId?.toUpperCase();
    if (!fieldId || DEFAULT_EXCLUDED_FIELDS.has(fieldId)) {
      return;
    }

    basis.push(fieldId);
    if (field.blobId) {
      basis.push(field.blobId.toString());
      if (forceBlobRestore) {
        basis.push(field.value || "blobNotExists");
      }
      return;
    }

    basis.push(stripNewLines(field.value ?? ""));
  };

  const shared = [...item.sharedFields].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  for (const field of shared) {
    processField(field);
  }

  const unversioned = [...item.unversionedFields].sort((a, b) =>
    a.language.localeCompare(b.language)
  );
  for (const language of unversioned) {
    basis.push(language.language);
    const fields = [...language.fields].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
    for (const field of fields) {
      processField(field);
    }
  }

  const versions = [...item.versions].sort((a, b) => {
    const lang = a.language.localeCompare(b.language);
    if (lang !== 0) {
      return lang;
    }
    return a.version - b.version;
  });
  for (const version of versions) {
    basis.push(version.language);
    basis.push(version.version.toString());
    const fields = [...version.fields].sort((a, b) => a.fieldId.localeCompare(b.fieldId));
    for (const field of fields) {
      processField(field);
    }
  }

  return basis.join("");
};

export const createSignature = (signatureBase: string | null): string | null => {
  if (!signatureBase) {
    return null;
  }

  const hash = crypto.createHash("sha256").update(signatureBase, "utf8").digest("base64");
  return hash;
};

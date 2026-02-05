import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createDataSignatureBase, createSignature } from "../../../src/serialization/signature";
import { ItemPath } from "../../../src/serialization/item-path";
import type { ItemData } from "../../../src/serialization/types";

describe("serialization signatures", () => {
  it("creates a stable signature hash", () => {
    const base = "template-idFIELD-1value";
    const expected = crypto.createHash("sha256").update(base, "utf8").digest("base64");
    expect(createSignature(base)).toBe(expected);
    expect(createSignature("")).toBeNull();
    expect(createSignature(null)).toBeNull();
  });

  it("builds data signature base and skips excluded fields", () => {
    const item: ItemData = {
      id: "item-1",
      parentId: "parent-1",
      templateId: "template-id",
      path: ItemPath.fromPathString("/sitecore/content/home"),
      name: "home",
      branchId: null,
      database: "master",
      sharedFields: [
        {
          fieldId: "B1E16562-F3F9-4DDD-84CA-6E099950ECC0",
          nameHint: "LastRun",
          value: "skip",
        },
        {
          fieldId: "field-0",
          nameHint: "Title",
          value: "alpha",
        },
        {
          fieldId: "field-1",
          nameHint: "Title",
          value: "line1\nline2",
        },
      ],
      unversionedFields: [
        {
          language: "da",
          fields: [
            {
              fieldId: "field-3",
              nameHint: "Subtitle",
              value: "delta",
            },
            {
              fieldId: "field-1",
              nameHint: "Subtitle",
              value: "alpha",
            },
          ],
        },
        {
          language: "en",
          fields: [
            {
              fieldId: "field-2",
              nameHint: "Subtitle",
              value: "value",
            },
            {
              fieldId: "field-4",
              nameHint: "Subtitle",
              value: "zulu",
            },
          ],
        },
      ],
      versions: [
        {
          language: "en",
          version: 2,
          fields: [
            {
              fieldId: "field-0",
              nameHint: "Versioned",
              value: "gamma",
            },
            {
              fieldId: "field-1",
              nameHint: "Versioned",
              value: "beta",
            },
          ],
        },
        {
          language: "en",
          version: 1,
          fields: [
            {
              fieldId: "field-blob",
              nameHint: "Blob",
              value: "blob-value",
              blobId: "blob-1",
            },
          ],
        },
      ],
      dataSignature: "",
    };

    const base = createDataSignatureBase(item);
    expect(base).toContain("template-id");
    expect(base).toContain("FIELD-1");
    expect(base).toContain("line1line2");
    expect(base).toContain("FIELD-2");
    expect(base).toContain("value");
    expect(base).toContain("blob-1");
    expect(base).not.toContain("skip");
    expect(base).not.toContain("blob-value");

    const withBlobRestore = createDataSignatureBase(item, true);
    expect(withBlobRestore).toContain("blob-value");
  });
});

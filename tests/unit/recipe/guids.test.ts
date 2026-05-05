import { describe, expect, it } from "vitest";
import {
  _deriveNamespaceRoot,
  contentItemId,
  enumerationFolderId,
  enumerationsFolderTemplateId,
  enumerationTemplateId,
  enumerationTemplateSectionId,
  enumerationTemplateValueFieldId,
  enumValueId,
  fieldId,
  NAMESPACE_CONTENT_ITEM,
  NAMESPACE_PAGE_DESIGN,
  NAMESPACE_PARTIAL_DESIGN,
  NAMESPACE_RENDERING,
  NAMESPACE_ROOT,
  NAMESPACE_SITE_BRANCH,
  NAMESPACE_TEMPLATE,
  pageDesignId,
  paramsTemplateId,
  partialDesignId,
  renderingId,
  sectionId,
  siteDataFolderId,
  standardValuesId,
  templateId,
} from "../../../src/recipe/guids";

const DEFAULT_SITE = "default";

describe("recipe guids — namespace constants are frozen", () => {
  it("NAMESPACE_ROOT matches its uuidv5(DNS, 'registry.sitecoreai.dev') derivation", () => {
    expect(NAMESPACE_ROOT).toBe(_deriveNamespaceRoot());
  });

  it("kind-namespaces are pinned to their derived values", () => {
    expect(NAMESPACE_TEMPLATE).toBe("8cdd8258-7af2-5b4c-b9e9-1ec13c9aa589");
    expect(NAMESPACE_RENDERING).toBe("415fee2b-be60-589c-ba7c-df0308759b7e");
    expect(NAMESPACE_PARTIAL_DESIGN).toBe("90066657-83e4-5cc5-83e2-f70e4dc62ed6");
    expect(NAMESPACE_PAGE_DESIGN).toBe("80443570-27d0-5729-be73-19a6a5827ab9");
    expect(NAMESPACE_SITE_BRANCH).toBe("ed6269d1-ac7c-53b7-aa23-b3edd92f3886");
    expect(NAMESPACE_CONTENT_ITEM).toBe("d798f8c5-24ee-55c4-afe0-f387a998521f");
  });
});

describe("recipe guids — partial-design and page-design derivation is deterministic", () => {
  it("partial-design ids are stable for a given (site, handle)", () => {
    expect(partialDesignId(DEFAULT_SITE, "standard-header@1")).toBe(
      "10e13dd1-25c5-53eb-bbe3-58415aa8ad75"
    );
    expect(partialDesignId(DEFAULT_SITE, "standard-footer@1")).toBe(
      "94145d77-f6fe-5ada-beca-23a8840f8317"
    );
    expect(partialDesignId(DEFAULT_SITE, "article-byline@1")).toBe(
      "328743f4-325d-5138-b197-451256e239b5"
    );
  });

  it("page-design ids are stable for a given (site, handle)", () => {
    expect(pageDesignId(DEFAULT_SITE, "default-page-design@1")).toBe(
      "b9f426ed-1192-5bdc-bf3c-78fcb6ec3baa"
    );
    expect(pageDesignId(DEFAULT_SITE, "landing-design@1")).toBe(
      "93a16cb8-f491-59b1-a1f5-aa775c32e30c"
    );
    expect(pageDesignId(DEFAULT_SITE, "article-design@1")).toBe(
      "a2ad7919-19bf-5bf7-912a-b9b4ba4697a5"
    );
  });

  it("partial-design ids and page-design ids are namespaced separately", () => {
    expect(partialDesignId(DEFAULT_SITE, "standard-header@1")).not.toBe(
      pageDesignId(DEFAULT_SITE, "standard-header@1")
    );
  });

  it("composition-kind ids are namespaced separately from template ids", () => {
    expect(partialDesignId(DEFAULT_SITE, "standard-header@1")).not.toBe(
      templateId(DEFAULT_SITE, "standard-header@1")
    );
    expect(pageDesignId(DEFAULT_SITE, "landing-design@1")).not.toBe(
      templateId(DEFAULT_SITE, "landing-design@1")
    );
  });
});

describe("recipe guids — content-item derivation is deterministic", () => {
  it("content-item ids are stable for a given (site, handle)", () => {
    expect(contentItemId(DEFAULT_SITE, "site-logo-content@1")).toBe(
      "2f61a896-3c2f-5bf2-9dd0-cd995b244d6c"
    );
    expect(contentItemId(DEFAULT_SITE, "primary-nav-content@1")).toBe(
      "7da4312f-74c1-5a3c-b5b7-402a3774ba9e"
    );
  });

  it("content-item ids are namespaced separately from template ids", () => {
    expect(contentItemId(DEFAULT_SITE, "site-logo-content@1")).not.toBe(
      templateId(DEFAULT_SITE, "site-logo-content@1")
    );
  });

  it("different content-item handles yield different ids", () => {
    expect(contentItemId(DEFAULT_SITE, "site-logo-content@1")).not.toBe(
      contentItemId(DEFAULT_SITE, "site-logo-content@2")
    );
    expect(contentItemId(DEFAULT_SITE, "site-logo-content@1")).not.toBe(
      contentItemId(DEFAULT_SITE, "primary-nav-content@1")
    );
  });
});

describe("recipe guids — derivation is deterministic", () => {
  const handle = "cta-button@1";

  it("template ids are stable for a given (site, handle)", () => {
    expect(templateId(DEFAULT_SITE, handle)).toBe("939faa17-a0ba-5f2b-bdd9-03e198837890");
  });

  it("rendering ids are stable for a given (site, handle)", () => {
    expect(renderingId(DEFAULT_SITE, handle)).toBe("d91aafbe-28dc-5ad4-ad49-9c44657b9b56");
  });

  it("section ids are stable for a given (site, handle, section name)", () => {
    expect(sectionId(DEFAULT_SITE, handle, "Content")).toBe("fa3b53c3-7d41-5af0-8f4f-6edd86594f89");
  });

  it("field ids are stable for a given (site, handle, field name)", () => {
    expect(fieldId(DEFAULT_SITE, handle, "Label")).toBe("f7e579df-34b0-5c25-8010-9c7f14b181cd");
    expect(fieldId(DEFAULT_SITE, handle, "Link")).toBe("09e85795-ff91-5ac8-8a49-0f874954fb0d");
  });

  it("standard-values ids are stable for a given (site, handle)", () => {
    expect(standardValuesId(DEFAULT_SITE, handle)).toBe("fc9a4937-094f-5489-a112-74a64bcbb7a0");
  });

  it("params template ids segregate from regular template ids", () => {
    expect(paramsTemplateId(DEFAULT_SITE, handle)).not.toBe(templateId(DEFAULT_SITE, handle));
  });

  it("different handles yield different template ids", () => {
    expect(templateId(DEFAULT_SITE, "cta-button@1")).not.toBe(
      templateId(DEFAULT_SITE, "cta-button@2")
    );
    expect(templateId(DEFAULT_SITE, "cta-button@1")).not.toBe(
      templateId(DEFAULT_SITE, "card-block@1")
    );
  });

  it("different field names under the same (site, handle) yield different field ids", () => {
    expect(fieldId(DEFAULT_SITE, handle, "Label")).not.toBe(fieldId(DEFAULT_SITE, handle, "Link"));
  });
});

/**
 * Snapshot every handle currently in `example/recipes/`, scoped under the
 * `default` site. Once a recipe has been pushed to a real tenant under a
 * given site, these GUIDs become that (site, recipe) pair's identity
 * forever — any change here means the recipe re-points to a different
 * Sitecore item under that site and the prior items become orphans. This
 * test catches that loudly, before someone re-pushes against the sandbox.
 *
 * Per-site identity: pushing the same recipe under a different `site`
 * intentionally yields a *different* GUID set (covered by the
 * "site-scoping" suite below).
 */
describe("recipe guids — snapshots for all registry handles (site=default)", () => {
  const SNAPSHOTS = {
    "cta-button@1": {
      template: "939faa17-a0ba-5f2b-bdd9-03e198837890",
      rendering: "d91aafbe-28dc-5ad4-ad49-9c44657b9b56",
      paramsTemplate: "4394eb73-3f01-5b5d-82ec-ea2cd747f3d5",
      standardValues: "fc9a4937-094f-5489-a112-74a64bcbb7a0",
    },
    "badge-block@1": {
      template: "f727da45-8a7b-5ca3-a741-470a5e756fb6",
      rendering: "99070cbb-aee9-52c5-ae86-f0b91e6c2ab6",
      paramsTemplate: "500fdff1-40fc-5813-a7c0-f1d4d0d84460",
      standardValues: "c6f19465-3a8d-5bc4-b5d2-9cbccd10b8bf",
    },
    "card-block@1": {
      template: "a5038964-b551-5140-9d5c-5935809db093",
      rendering: "2c7d89a2-2a3c-5770-a31a-0fa7a48411e0",
      paramsTemplate: "4d3bc0aa-c3ec-582f-a2a8-f153756c14bf",
      standardValues: "af5866f6-4f2a-5c03-b2a9-b948a3cd886f",
    },
    "rich-text-block@1": {
      template: "5e6ef05a-4f68-5862-bb6b-edef6df45341",
      rendering: "8220019a-b0cb-5eb0-8d34-23b294ddd3a0",
      paramsTemplate: "033b7f43-ad2e-57c8-a7b9-b30729c5c771",
      standardValues: "d78dcc4d-7908-5565-9889-029d836a9e3e",
    },
    "accordion-item@1": {
      template: "40fa74c6-d7d0-5551-9d60-70f3ac58aaa2",
      rendering: "d9208a94-8c66-5a79-96db-b4587725c3b6",
      paramsTemplate: "519b5495-0a5b-51dd-a595-91eae3c2ee11",
      standardValues: "fb677a73-4c58-5f49-ab71-95e07e3bed80",
    },
    "accordion-block@1": {
      template: "fc80e90a-8841-564f-9820-5f67602ff5f3",
      rendering: "d9834dd5-1e0f-52a3-8bd5-ec5e6b938a3e",
      paramsTemplate: "b2bc027c-8228-53a5-a226-c00275881f8a",
      standardValues: "27329961-2640-5ce8-a9e8-9c19b81c32ac",
    },
    "avatar-block@1": {
      template: "188691e3-00b4-5794-ab4f-3cb5bc64b999",
      rendering: "7923bd96-72e6-5a38-ab40-cc6f51639e3d",
      paramsTemplate: "b88149f9-3a1e-5338-ae34-d98e6f50939e",
      standardValues: "85824e43-90fb-555f-a7f8-adbc9f28f494",
    },
  } as const;

  it.each(Object.entries(SNAPSHOTS))(
    "%s — template / rendering / params / SV are pinned",
    (handle, expected) => {
      expect(templateId(DEFAULT_SITE, handle)).toBe(expected.template);
      expect(renderingId(DEFAULT_SITE, handle)).toBe(expected.rendering);
      expect(paramsTemplateId(DEFAULT_SITE, handle)).toBe(expected.paramsTemplate);
      expect(standardValuesId(DEFAULT_SITE, handle)).toBe(expected.standardValues);
    }
  );
});

/**
 * Per-site GUID scoping — the same handle pushed under two different
 * sites produces two distinct sets of items. This is the invariant that
 * lets the same recipe set materialise into multiple sites under one
 * tenant without colliding on Sitecore's globally-unique GUID constraint.
 */
describe("recipe guids — site-scoping yields distinct ids per site", () => {
  const SNAPSHOTS_E2E = {
    "cta-button@1": {
      template: "63f86073-d77e-56e7-8bcf-aeec9820e1b8",
      rendering: "1246a4d0-2e86-5720-92ec-de948e361ad8",
      paramsTemplate: "0a710272-ec8c-5aca-bca3-333deda4a2d4",
      standardValues: "e07b1a1c-ce14-56f0-9c6f-06eb5d107a3a",
    },
    "badge-block@1": {
      template: "dd3010d7-115f-54bd-87ef-369a20ba210f",
      rendering: "3fbcb4ec-4236-5910-bc1a-8af2acbf2c40",
      paramsTemplate: "844c7071-cc68-58f1-b76c-3f2d8517f0cf",
      standardValues: "3bb06920-dc66-5dd5-961e-f04879b4cd9c",
    },
    "card-block@1": {
      template: "57486e9e-348b-521f-8cdd-d21ad7e40ebd",
      rendering: "9d175a94-bed7-54a8-b310-be7ef19f8a8b",
      paramsTemplate: "72b47859-bd59-5829-b17d-98cda95946ff",
      standardValues: "2fcfe917-2eb6-5189-950a-d3fcf90f1fe3",
    },
    "rich-text-block@1": {
      template: "d6987550-5aa4-5d20-8a42-d719f155fa8e",
      rendering: "ffb3f452-2825-5181-8171-f53a0ed100f9",
      paramsTemplate: "97634b9a-8fb6-5cda-8fc9-3493137aaa3b",
      standardValues: "bfd6cc88-3134-55ba-b912-0f9475b91dae",
    },
    "accordion-item@1": {
      template: "2bb86983-5e61-5ea1-ac98-d31d2783484e",
      rendering: "8e2fe048-11d2-5225-8416-e642959961c5",
      paramsTemplate: "27d70c36-884c-50ea-880b-49ab7468edec",
      standardValues: "a726bd67-e9f6-5cf4-8b61-6c9c3271d31b",
    },
    "accordion-block@1": {
      template: "ef78bd6b-1793-5476-8a87-e16e1e5d6bc1",
      rendering: "6f22d6fd-d80c-5540-b77d-d427e52970c8",
      paramsTemplate: "723a9780-0d96-502e-85dd-40c4a6900c51",
      standardValues: "d9b05009-4375-5b3e-b15a-d7ac089aa6ab",
    },
    "avatar-block@1": {
      template: "1a105964-2b4b-582c-9d49-12275c743220",
      rendering: "b98b43c6-0be2-55c6-9650-42036f3ffb0e",
      paramsTemplate: "a752f9ee-2179-5587-93c3-cecfc4a02c3b",
      standardValues: "4bb6e03a-dc58-5689-ba67-d2e6b304f219",
    },
  } as const;

  it.each(Object.entries(SNAPSHOTS_E2E))(
    "%s under site='e2e' — template / rendering / params / SV are pinned and distinct from site='default'",
    (handle, expected) => {
      expect(templateId("e2e", handle)).toBe(expected.template);
      expect(renderingId("e2e", handle)).toBe(expected.rendering);
      expect(paramsTemplateId("e2e", handle)).toBe(expected.paramsTemplate);
      expect(standardValuesId("e2e", handle)).toBe(expected.standardValues);

      // And: the e2e ids must not collide with the default ones.
      expect(templateId("e2e", handle)).not.toBe(templateId(DEFAULT_SITE, handle));
      expect(renderingId("e2e", handle)).not.toBe(renderingId(DEFAULT_SITE, handle));
      expect(paramsTemplateId("e2e", handle)).not.toBe(paramsTemplateId(DEFAULT_SITE, handle));
      expect(standardValuesId("e2e", handle)).not.toBe(standardValuesId(DEFAULT_SITE, handle));
    }
  );

  it("section/field ids also differ across sites for the same (handle, name)", () => {
    expect(sectionId("e2e", "cta-button@1", "Content")).not.toBe(
      sectionId(DEFAULT_SITE, "cta-button@1", "Content")
    );
    expect(fieldId("e2e", "cta-button@1", "Label")).not.toBe(
      fieldId(DEFAULT_SITE, "cta-button@1", "Label")
    );
  });
});

/**
 * Enumeration folder + value derivations. Once an enumeration recipe
 * has been pushed to a tenant under a given site, the folder GUID and
 * each value GUID become that (site, handle, value) triple's identity
 * forever — flipping any of them strands the tenant's existing items
 * and orphans every datasource SV default that referenced the old GUID.
 *
 * The cross-site comparison proves enums are site-scoped (same as
 * templates / renderings); the cross-context comparison proves the
 * inline-vs-shared parent scoping yields distinct GUIDs even when the
 * value name (`primary`) repeats across enums and across usage modes.
 */
describe("recipe guids — enumeration ids are deterministic and site-scoped", () => {
  it("enumerationFolderId is stable for a given (site, handle)", () => {
    expect(enumerationFolderId(DEFAULT_SITE, "color-scheme@1")).toBe(
      "2d3f1bf9-0adc-5b4c-b651-5a9b705af19c"
    );
  });

  it("enumerationFolderId is site-scoped — same handle, different sites yield distinct GUIDs", () => {
    expect(enumerationFolderId("e2e", "color-scheme@1")).toBe(
      "ef2c19fc-bf36-5eae-bd92-ca03f9814f21"
    );
    expect(enumerationFolderId("e2e", "color-scheme@1")).not.toBe(
      enumerationFolderId(DEFAULT_SITE, "color-scheme@1")
    );
  });

  it("enumValueId scoped under a shared-enum folder is stable", () => {
    const folder = enumerationFolderId(DEFAULT_SITE, "color-scheme@1");
    expect(enumValueId(folder, "primary")).toBe("7c279fba-1b67-5e1f-9d0d-243b098e43c8");
  });

  it("siteDataFolderId is stable for a given (site, subfolder) and site-scoped", () => {
    expect(siteDataFolderId(DEFAULT_SITE, "Badges")).toBe("1c5292fc-55fd-581a-aed4-c5b6aab1ee88");
    expect(siteDataFolderId(DEFAULT_SITE, "Shared")).toBe("67aa0552-4c51-5724-b300-a4677a9dab0e");
    expect(siteDataFolderId("e2e", "Badges")).not.toBe(siteDataFolderId(DEFAULT_SITE, "Badges"));
  });

  it("enumValueId scoped under a field-definition refKey (inline enum) is distinct from the same-named shared-enum value", () => {
    const fieldRef = fieldId(DEFAULT_SITE, "cta-button@1", "ColorScheme");
    const inlinePrimary = enumValueId(fieldRef, "primary");
    expect(inlinePrimary).toBe("3c771955-486c-513c-bb0c-e93cfdee886d");

    // The same value name `primary` under a different parent (a shared
    // enum's folder) yields a different GUID — this is the property
    // that lets two different enums use the same value name without
    // colliding on Sitecore's globally-unique GUID constraint.
    const sharedPrimary = enumValueId(
      enumerationFolderId(DEFAULT_SITE, "color-scheme@1"),
      "primary"
    );
    expect(inlinePrimary).not.toBe(sharedPrimary);
  });

  it("enumerationTemplateSectionId / enumerationTemplateValueFieldId scope under the per-site Enumeration template", () => {
    const sectionDefault = enumerationTemplateSectionId(DEFAULT_SITE);
    const sectionE2e = enumerationTemplateSectionId("e2e");
    const valueFieldDefault = enumerationTemplateValueFieldId(DEFAULT_SITE);
    const valueFieldE2e = enumerationTemplateValueFieldId("e2e");

    // Site-scoped (different sites yield different GUIDs).
    expect(sectionDefault).not.toBe(sectionE2e);
    expect(valueFieldDefault).not.toBe(valueFieldE2e);

    // Distinct from the parent Enumeration template's own GUID and from
    // the sibling Enumerations Folder template — the three live in the
    // same namespace family but the seed differentiates them.
    expect(sectionDefault).not.toBe(enumerationTemplateId(DEFAULT_SITE));
    expect(valueFieldDefault).not.toBe(enumerationTemplateId(DEFAULT_SITE));
    expect(sectionDefault).not.toBe(valueFieldDefault);
    expect(sectionDefault).not.toBe(enumerationsFolderTemplateId(DEFAULT_SITE));
  });
});

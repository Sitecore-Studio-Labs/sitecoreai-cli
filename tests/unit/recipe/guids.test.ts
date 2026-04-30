import { describe, expect, it } from "vitest";
import {
  _deriveNamespaceRoot,
  contentItemId,
  fieldId,
  NAMESPACE_CONTENT_ITEM,
  NAMESPACE_PAGE_DESIGN,
  NAMESPACE_RENDERING,
  NAMESPACE_ROOT,
  NAMESPACE_SITE_BRANCH,
  NAMESPACE_TEMPLATE,
  paramsTemplateId,
  renderingId,
  sectionId,
  standardValuesId,
  templateId,
} from "../../../src/recipe/guids";

describe("recipe guids — namespace constants are frozen", () => {
  it("NAMESPACE_ROOT matches its uuidv5(DNS, 'registry.sitecoreai.dev') derivation", () => {
    expect(NAMESPACE_ROOT).toBe(_deriveNamespaceRoot());
  });

  it("kind-namespaces are pinned to their derived values", () => {
    expect(NAMESPACE_TEMPLATE).toBe("8cdd8258-7af2-5b4c-b9e9-1ec13c9aa589");
    expect(NAMESPACE_RENDERING).toBe("415fee2b-be60-589c-ba7c-df0308759b7e");
    expect(NAMESPACE_PAGE_DESIGN).toBe("80443570-27d0-5729-be73-19a6a5827ab9");
    expect(NAMESPACE_SITE_BRANCH).toBe("ed6269d1-ac7c-53b7-aa23-b3edd92f3886");
    expect(NAMESPACE_CONTENT_ITEM).toBe("d798f8c5-24ee-55c4-afe0-f387a998521f");
  });
});

describe("recipe guids — content-item derivation is deterministic", () => {
  it("content-item ids are stable for a given handle", () => {
    expect(contentItemId("site-logo-content@1")).toBe("bdd465b4-58a9-5f50-8c87-cf61d50b3965");
    expect(contentItemId("primary-nav-content@1")).toBe("70ecf4d2-92ba-54d9-bb49-c517e44a741f");
  });

  it("content-item ids are namespaced separately from template ids", () => {
    expect(contentItemId("site-logo-content@1")).not.toBe(templateId("site-logo-content@1"));
  });

  it("different content-item handles yield different ids", () => {
    expect(contentItemId("site-logo-content@1")).not.toBe(contentItemId("site-logo-content@2"));
    expect(contentItemId("site-logo-content@1")).not.toBe(contentItemId("primary-nav-content@1"));
  });
});

describe("recipe guids — derivation is deterministic", () => {
  const handle = "cta-button@1";

  it("template ids are stable for a given handle", () => {
    expect(templateId(handle)).toBe("603df982-441a-5e9c-82d0-2c4e016f0f7b");
  });

  it("rendering ids are stable for a given handle", () => {
    expect(renderingId(handle)).toBe("f6a4e7fd-2b2e-5347-88b6-6e653ae579c8");
  });

  it("section ids are stable for a given handle + section name", () => {
    expect(sectionId(handle, "Content")).toBe("bd0a988e-5f09-545c-93ea-d3dbce86b0ac");
  });

  it("field ids are stable for a given handle + field name", () => {
    expect(fieldId(handle, "Label")).toBe("daae9752-0d5d-5926-a0c3-6cfb2a7ed074");
    expect(fieldId(handle, "Link")).toBe("fb1d166b-1020-5d61-8472-00affab6a726");
  });

  it("standard-values ids are stable for a given handle", () => {
    expect(standardValuesId(handle)).toBe("a1ba1ae5-507f-5a7e-935f-7c3396ead953");
  });

  it("params template ids segregate from regular template ids", () => {
    expect(paramsTemplateId(handle)).not.toBe(templateId(handle));
  });

  it("different handles yield different template ids", () => {
    expect(templateId("cta-button@1")).not.toBe(templateId("cta-button@2"));
    expect(templateId("cta-button@1")).not.toBe(templateId("card-block@1"));
  });

  it("different field names under the same handle yield different field ids", () => {
    expect(fieldId(handle, "Label")).not.toBe(fieldId(handle, "Link"));
  });
});

/**
 * Snapshot every handle currently in `example/recipes/`. Once a recipe has
 * been pushed to a real tenant, these GUIDs become its identity forever —
 * any change here means the recipe re-points to a different Sitecore item
 * and the prior tenant's items become orphans. This test catches that
 * loudly, before someone re-pushes against the sandbox.
 */
describe("recipe guids — snapshots for all registry handles", () => {
  const SNAPSHOTS = {
    "cta-button@1": {
      template: "603df982-441a-5e9c-82d0-2c4e016f0f7b",
      rendering: "f6a4e7fd-2b2e-5347-88b6-6e653ae579c8",
      paramsTemplate: "7de0a37a-2aaf-5b36-ab98-3b9a0e79a92b",
      standardValues: "a1ba1ae5-507f-5a7e-935f-7c3396ead953",
    },
    "badge-block@1": {
      template: "5d034663-961b-5fef-a6c3-819f41bd78e1",
      rendering: "cb5324ab-c4a6-5daf-83c7-2407ffe86f10",
      paramsTemplate: "61ae8bb6-38a0-5934-a3ad-ac1cd936a5e2",
      standardValues: "5efc5946-8e00-5f87-9a4d-17fed7ff2c4f",
    },
    "card-block@1": {
      template: "624553d8-502f-5b4d-a2e7-dd30c7a6a784",
      rendering: "a101e10e-63a2-539b-91d0-39885b64b6b4",
      paramsTemplate: "47bb1167-00e5-5d98-94c8-db090224c3ca",
      standardValues: "befbb2ec-9b36-5267-a092-3ae6df7b8e1c",
    },
    "rich-text-block@1": {
      template: "f151e51c-3667-5d60-ab3a-f0c0beffafa2",
      rendering: "28009070-2d42-5c24-8452-04d12190bfa9",
      paramsTemplate: "2981a3dd-8137-5c0e-81a6-83278da16e85",
      standardValues: "b236ee59-ef85-52f0-8582-eec0724bffd5",
    },
    "accordion-item@1": {
      template: "6823cd8b-ab68-5d48-a3f1-49e85ea725b2",
      rendering: "c7e72397-5cb5-589f-afda-190c4ae8b212",
      paramsTemplate: "3400b92a-0f69-55c1-a730-ee9d5e0d5ed5",
      standardValues: "c6b3a22a-9c4b-5c60-987a-7899e48f805c",
    },
    "accordion-block@1": {
      template: "e213797a-0460-5064-a896-c14d0a559588",
      rendering: "0cd5389a-5da8-5ea5-a395-56734a8f0556",
      paramsTemplate: "b6739172-8f12-5cd6-8e8a-5262eb0d2906",
      standardValues: "8c2ab358-a179-562d-85f0-f69be83cb020",
    },
    "avatar-block@1": {
      template: "4ea5eae5-71f3-571d-b1e4-d0a899394690",
      rendering: "67c9e4d9-e91c-5dea-bd2d-732c2e516406",
      paramsTemplate: "c53534af-ab29-5669-8852-8782ab95bf09",
      standardValues: "88a4c968-cd89-5b6c-b5b2-d1cf312c64c8",
    },
  } as const;

  it.each(Object.entries(SNAPSHOTS))(
    "%s — template / rendering / params / SV are pinned",
    (handle, expected) => {
      expect(templateId(handle)).toBe(expected.template);
      expect(renderingId(handle)).toBe(expected.rendering);
      expect(paramsTemplateId(handle)).toBe(expected.paramsTemplate);
      expect(standardValuesId(handle)).toBe(expected.standardValues);
    }
  );
});

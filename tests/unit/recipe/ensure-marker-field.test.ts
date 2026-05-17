/**
 * Unit tests for the `Scai Handle` marker-field bootstrap
 * (`src/recipe/ensure-marker-field.ts`).
 *
 * Backed by the in-memory `MockAuthoringClient` — `ensureMarkerField` reads
 * the Standard Template's sections/fields and creates the missing ones, so
 * the assertions check both the idempotent read path and the create path.
 */
import { describe, expect, it } from "vitest";
import type { RemoteItem } from "../../../src/recipe/api/client";
import { ensureMarkerField, SCAI_SECTION_NAME } from "../../../src/recipe/ensure-marker-field";
import { SCAI_HANDLE_FIELD_NAME } from "../../../src/recipe/marker";
import {
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import { sitecoreFieldTypeLabel } from "../../../src/recipe/schema/field-types";
import { MockAuthoringClient } from "./_fixtures/mock-client";

const STANDARD_TEMPLATE_PATH = "/sitecore/templates/System/Templates/Standard template";

/** Terse `RemoteItem` builder. */
const mkItem = (over: Partial<RemoteItem> & Pick<RemoteItem, "itemId" | "name">): RemoteItem => ({
  templateId: SITECORE_TEMPLATES.TEMPLATE,
  parentId: "00000000-0000-0000-0000-000000000000",
  path: `/${over.name}`,
  fields: [],
  ...over,
});

const standardTemplate = (): RemoteItem =>
  mkItem({
    itemId: STANDARD_TEMPLATE_ID,
    name: "Standard template",
    path: STANDARD_TEMPLATE_PATH,
  });

describe("ensureMarkerField", () => {
  it("creates the Scai section and the Scai Handle field on a fresh template", async () => {
    const client = new MockAuthoringClient();
    client.preload(standardTemplate());

    const result = await ensureMarkerField(client);

    expect(result.status).toBe("created");
    // Two creates, in order: the section, then the field under it.
    expect(client.creates).toHaveLength(2);
    const [sectionCreate, fieldCreate] = client.creates;
    expect(sectionCreate).toMatchObject({
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      name: SCAI_SECTION_NAME,
      parent: STANDARD_TEMPLATE_ID,
    });
    expect(fieldCreate).toMatchObject({
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: SCAI_HANDLE_FIELD_NAME,
      parent: result.sectionItemId,
    });
    // The field is defined as a shared Single-Line Text field.
    const typeField = fieldCreate.fields.find((f) => f.fieldId === TEMPLATE_FIELD_FIELDS.TYPE);
    expect(typeField?.value).toEqual({
      kind: "string",
      value: sitecoreFieldTypeLabel("single-line-text"),
    });
    const sharedField = fieldCreate.fields.find((f) => f.fieldId === TEMPLATE_FIELD_FIELDS.SHARED);
    expect(sharedField?.value).toEqual({ kind: "string", value: "1" });
  });

  it("is idempotent — finds an existing marker field and creates nothing", async () => {
    const client = new MockAuthoringClient();
    client.preload(standardTemplate());
    const section = mkItem({
      itemId: "sec-1",
      name: SCAI_SECTION_NAME,
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: STANDARD_TEMPLATE_ID,
      path: `${STANDARD_TEMPLATE_PATH}/${SCAI_SECTION_NAME}`,
    });
    const field = mkItem({
      itemId: "fld-1",
      name: SCAI_HANDLE_FIELD_NAME,
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: "sec-1",
      path: `${section.path}/${SCAI_HANDLE_FIELD_NAME}`,
    });
    client.preload(section);
    client.preload(field);

    const result = await ensureMarkerField(client);

    expect(result).toEqual({
      status: "already-present",
      fieldItemId: "fld-1",
      sectionItemId: "sec-1",
    });
    expect(client.creates).toHaveLength(0);
  });

  it("reuses an existing Scai section when only the field is missing", async () => {
    const client = new MockAuthoringClient();
    client.preload(standardTemplate());
    client.preload(
      mkItem({
        itemId: "sec-existing",
        name: SCAI_SECTION_NAME,
        templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
        parentId: STANDARD_TEMPLATE_ID,
        path: `${STANDARD_TEMPLATE_PATH}/${SCAI_SECTION_NAME}`,
      })
    );

    const result = await ensureMarkerField(client);

    expect(result.status).toBe("created");
    expect(result.sectionItemId).toBe("sec-existing");
    // Only the field is created — the section is reused.
    expect(client.creates).toHaveLength(1);
    expect(client.creates[0]).toMatchObject({
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      name: SCAI_HANDLE_FIELD_NAME,
      parent: "sec-existing",
    });
  });

  it("finds the marker field even under a differently-named section", async () => {
    const client = new MockAuthoringClient();
    client.preload(standardTemplate());
    // A prior bootstrap (or a hand edit) parked the field under `Advanced`.
    client.preload(
      mkItem({
        itemId: "sec-adv",
        name: "Advanced",
        templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
        parentId: STANDARD_TEMPLATE_ID,
        path: `${STANDARD_TEMPLATE_PATH}/Advanced`,
      })
    );
    client.preload(
      mkItem({
        itemId: "fld-adv",
        name: SCAI_HANDLE_FIELD_NAME,
        templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
        parentId: "sec-adv",
        path: `${STANDARD_TEMPLATE_PATH}/Advanced/${SCAI_HANDLE_FIELD_NAME}`,
      })
    );

    const result = await ensureMarkerField(client);

    expect(result).toEqual({
      status: "already-present",
      fieldItemId: "fld-adv",
      sectionItemId: "sec-adv",
    });
    expect(client.creates).toHaveLength(0);
  });

  it("throws a clear error when the Standard Template cannot be resolved", async () => {
    const client = new MockAuthoringClient(); // nothing preloaded
    await expect(ensureMarkerField(client)).rejects.toThrow(/Standard Template/);
  });
});

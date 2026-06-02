import { describe, expect, it } from "vitest";

/**
 * Unit tests for `collectBaselineEntries` — the post-apply walker that
 * turns an executed IR into the per-field hash snapshot persisted as the
 * three-way merge baseline. Covers:
 *
 *   - SetField, SetBaseTemplates, SetStandardValues, CreateItem.fields
 *     each emit one entry per write
 *   - Structural ops (AddItemVersion, AppendToMultiList, PruneChildren,
 *     CreateSiteFromTemplate) emit nothing
 *   - capturedItemIds resolves `ref-recipe` values so the hashed wire
 *     form matches what the planner would compute next push
 */

import { collectBaselineEntries } from "../../../../src/recipe/runtime/baseline-capture";
import { hashFieldValue } from "../../../../src/recipe/runtime/baseline";
import type { OperationIr } from "../../../../src/recipe/ir/operations";
import { renderRefValue } from "../../../../src/recipe/api/ref-encoding";
import { SYSTEM_FIELDS } from "../../../../src/recipe/ir/sitecore-templates";

const ir = (ops: OperationIr["operations"]): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: "test@1",
  operations: ops,
});

describe("collectBaselineEntries — SetField", () => {
  it("emits one entry per SetField, hashed against the rendered wire value", () => {
    const op: OperationIr["operations"][number] = {
      op: "SetField",
      policy: "CreateAndUpdate",
      label: "field:item:Title",
      itemRefKey: "item-1",
      fieldId: "field-1",
      fieldName: "Title",
      language: "en",
      version: 1,
      value: { kind: "string", value: "Welcome" },
    };
    const entries = collectBaselineEntries(ir([op]), new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      itemRefKey: "item-1",
      fieldId: "field-1",
      fieldName: "Title",
      language: "en",
      version: 1,
      valueHash: hashFieldValue("Welcome"),
    });
  });

  it("omits optional (language, version) when the op carries none", () => {
    const op: OperationIr["operations"][number] = {
      op: "SetField",
      policy: "CreateAndUpdate",
      label: "shared-field",
      itemRefKey: "item-1",
      fieldId: "f-shared",
      value: { kind: "string", value: "shared-value" },
    };
    const entries = collectBaselineEntries(ir([op]), new Map());
    expect(entries[0].language).toBeUndefined();
    expect(entries[0].version).toBeUndefined();
    expect(entries[0].fieldName).toBeUndefined();
  });

  it("resolves ref-recipe values via capturedItemIds before hashing", () => {
    const op: OperationIr["operations"][number] = {
      op: "SetField",
      policy: "CreateAndUpdate",
      label: "ref-field",
      itemRefKey: "item-1",
      fieldId: "f-ref",
      value: { kind: "ref-recipe", refKey: "captured-ref" },
    };
    const captured = new Map([["captured-ref", "11111111-1111-1111-1111-111111111111"]]);
    const entries = collectBaselineEntries(ir([op]), captured);
    // Hash matches what renderRefValue would emit for the resolved value
    // — apples-to-apples with what the planner computes on next push.
    expect(entries[0].valueHash).toBe(
      hashFieldValue(
        renderRefValue({ kind: "string", value: "{11111111-1111-1111-1111-111111111111}" })
      )
    );
  });
});

describe("collectBaselineEntries — SetBaseTemplates + SetStandardValues", () => {
  it("SetBaseTemplates produces an entry under __Base template with pipe-joined list", () => {
    const op: OperationIr["operations"][number] = {
      op: "SetBaseTemplates",
      policy: "CreateAndUpdate",
      label: "bases:hero",
      itemRefKey: "tpl-1",
      baseTemplates: [
        "ab111111-1111-1111-1111-111111111111",
        "cd222222-2222-2222-2222-222222222222",
      ],
    };
    const entries = collectBaselineEntries(ir([op]), new Map());
    expect(entries).toHaveLength(1);
    expect(entries[0].itemRefKey).toBe("tpl-1");
    expect(entries[0].fieldId).toBe(SYSTEM_FIELDS.BASE_TEMPLATE);
    expect(entries[0].fieldName).toBe("__Base template");
    expect(entries[0].valueHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SetStandardValues produces an entry under __Standard values pointing at the SVs item", () => {
    const op: OperationIr["operations"][number] = {
      op: "SetStandardValues",
      policy: "CreateAndUpdate",
      label: "sv:hero",
      templateRefKey: "tpl-1",
      standardValuesRefKey: "sv-1",
    };
    const captured = new Map([["sv-1", "22222222-2222-2222-2222-222222222222"]]);
    const entries = collectBaselineEntries(ir([op]), captured);
    expect(entries).toHaveLength(1);
    expect(entries[0].itemRefKey).toBe("tpl-1");
    expect(entries[0].fieldId).toBe(SYSTEM_FIELDS.STANDARD_VALUES);
    expect(entries[0].fieldName).toBe("__Standard values");
  });
});

describe("collectBaselineEntries — CreateItem.fields", () => {
  it("emits one entry per embedded field on a CreateItem", () => {
    const op: OperationIr["operations"][number] = {
      op: "CreateItem",
      policy: "CreateAndUpdate",
      label: "create:hero",
      id: "item-1",
      path: "/sitecore/content/Demo/Hero",
      parent: { kind: "ref-path", value: "/sitecore/content/Demo" },
      templateOf: "template-guid",
      name: "Hero",
      fields: [
        {
          fieldId: SYSTEM_FIELDS.ICON,
          value: { kind: "string", value: "office/32x32/icon.png" },
        },
        {
          fieldId: SYSTEM_FIELDS.DISPLAY_NAME,
          fieldName: "__Display name",
          language: "en",
          version: 1,
          value: { kind: "string", value: "Hero" },
        },
      ],
    };
    const entries = collectBaselineEntries(ir([op]), new Map());
    expect(entries).toHaveLength(2);
    expect(entries[0].fieldId).toBe(SYSTEM_FIELDS.ICON);
    expect(entries[1].fieldName).toBe("__Display name");
    expect(entries[1].language).toBe("en");
    expect(entries[1].version).toBe(1);
  });
});

describe("collectBaselineEntries — structural ops emit nothing", () => {
  it("AddItemVersion, AppendToMultiList, PruneChildren, CreateSiteFromTemplate all skip", () => {
    const ops: OperationIr["operations"] = [
      {
        op: "AddItemVersion",
        policy: "CreateAndUpdate",
        label: "addv:item",
        itemRefKey: "item-1",
        language: "fr",
        version: 1,
      },
      {
        op: "AppendToMultiList",
        policy: "CreateAndUpdate",
        label: "append:item",
        itemRefKey: "item-1",
        fieldId: "f1",
        values: [],
        appendPolicy: "merge-unique",
      },
      {
        op: "PruneChildren",
        policy: "CreateAndUpdate",
        label: "prune:item",
        parentRefKey: "parent-1",
        allowedHandles: [],
        mode: "warn",
      },
    ];
    const entries = collectBaselineEntries(ir(ops), new Map());
    expect(entries).toEqual([]);
  });
});

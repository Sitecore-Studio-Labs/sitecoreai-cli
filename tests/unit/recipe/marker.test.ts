import { describe, expect, it } from "vitest";
import { injectHandleMarker, SCAI_HANDLE_FIELD_NAME } from "../../../src/recipe/marker";
import type {
  CreateItemOp,
  FieldValue,
  Operation,
  OperationIr,
} from "../../../src/recipe/ir/operations";

const GUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const createOp = (id: string, fields: FieldValue[] = []): CreateItemOp => ({
  op: "CreateItem",
  policy: "CreateAndUpdate",
  label: `create ${id}`,
  id,
  path: "/sitecore/templates/Demo",
  parent: { kind: "ref-path", value: "/sitecore/templates" },
  templateOf: "11111111-1111-1111-1111-111111111111",
  fields,
});

const ir = (operations: Operation[], recipeHandle = "cta-button@1"): OperationIr => ({
  schemaVersion: "1",
  recipeHandle,
  operations,
});

const markerOf = (op: Operation): FieldValue | undefined =>
  op.op === "CreateItem"
    ? op.fields.find((field) => field.fieldName === SCAI_HANDLE_FIELD_NAME)
    : undefined;

describe("injectHandleMarker", () => {
  it("adds the Scai Handle marker to every CreateItem op", () => {
    const result = injectHandleMarker(ir([createOp(GUID_A), createOp(GUID_B)]));
    for (const op of result.operations) {
      expect(markerOf(op)?.value).toEqual({ kind: "string", value: "cta-button@1" });
    }
  });

  it("uses the IR's recipeHandle as the marker value", () => {
    const result = injectHandleMarker(ir([createOp(GUID_A)], "hero@2"));
    expect(markerOf(result.operations[0])?.value).toEqual({ kind: "string", value: "hero@2" });
  });

  it("leaves non-CreateItem ops untouched", () => {
    const setField = { op: "SetField", label: "set x" } as unknown as Operation;
    const result = injectHandleMarker(ir([setField]));
    expect(result.operations[0]).toBe(setField);
  });

  it("is idempotent — does not double-add the marker", () => {
    const once = injectHandleMarker(ir([createOp(GUID_A)]));
    const twice = injectHandleMarker(once);
    const op = twice.operations[0] as CreateItemOp;
    expect(op.fields.filter((field) => field.fieldName === SCAI_HANDLE_FIELD_NAME)).toHaveLength(1);
  });

  it("preserves a CreateItem op's existing fields", () => {
    const existing: FieldValue = {
      fieldId: "22222222-2222-2222-2222-222222222222",
      fieldName: "componentName",
      value: { kind: "string", value: "CtaButton" },
    };
    const result = injectHandleMarker(ir([createOp(GUID_A, [existing])]));
    const op = result.operations[0] as CreateItemOp;
    expect(op.fields).toHaveLength(2);
    expect(op.fields[0]).toEqual(existing);
  });
});

import { describe, expect, it, vi } from "vitest";
import { removeRef } from "../../../../src/scripting/helpers/multilist";
import type { ScaiClient } from "../../../../src/scripting/connect";

/**
 * Unit tests for the multilist field helper. `multilist.ts` is a pure
 * helper module — only `removeRef` is exported. Every branch is covered:
 * input validation, item-not-found, field-not-found, the no-op /
 * dry-run / apply forks, GUID brace/case tolerance, and the
 * pipe-delimited parse edge cases (empty entries, trailing pipe).
 *
 * The `ScaiClient.hygiene` surface is mocked — no network, no real
 * Authoring API call.
 */

type FieldRecord = { fieldId: string; name: string; value: string };

const makeClient = (opts: {
  fields: FieldRecord[] | null;
  updateImpl?: ReturnType<typeof vi.fn>;
}): {
  client: ScaiClient;
  getItemFields: ReturnType<typeof vi.fn>;
  updateItemFields: ReturnType<typeof vi.fn>;
} => {
  const getItemFields = vi.fn().mockResolvedValue(opts.fields);
  const updateItemFields = opts.updateImpl ?? vi.fn().mockResolvedValue(undefined);
  const client = {
    hygiene: { getItemFields, updateItemFields },
  } as unknown as ScaiClient;
  return { client, getItemFields, updateItemFields };
};

describe("removeRef — input validation", () => {
  it("throws INPUT_INVALID when itemId is missing", async () => {
    const { client } = makeClient({ fields: [] });
    await expect(
      removeRef(client, {
        itemId: "",
        fieldName: "Related",
        refToRemove: "{11111111-1111-1111-1111-111111111111}",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when fieldName is missing", async () => {
    const { client } = makeClient({ fields: [] });
    await expect(
      removeRef(client, {
        itemId: "item-1",
        fieldName: "",
        refToRemove: "{11111111-1111-1111-1111-111111111111}",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when refToRemove is missing", async () => {
    const { client } = makeClient({ fields: [] });
    await expect(
      removeRef(client, { itemId: "item-1", fieldName: "Related", refToRemove: "" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("removeRef — item / field resolution", () => {
  it("throws INPUT_INVALID when the item is not found (null fields)", async () => {
    const { client, getItemFields } = makeClient({ fields: null });
    await expect(
      removeRef(client, {
        itemId: "missing",
        fieldName: "Related",
        refToRemove: "{11111111-1111-1111-1111-111111111111}",
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("not found"),
    });
    expect(getItemFields).toHaveBeenCalledWith({ itemId: "missing" });
  });

  it("throws INPUT_INVALID with an available-fields hint when the field is absent", async () => {
    const { client } = makeClient({
      fields: [
        { fieldId: "f1", name: "Title", value: "Hello" },
        { fieldId: "f2", name: "Body", value: "World" },
      ],
    });
    const error = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{11111111-1111-1111-1111-111111111111}",
    }).catch((e) => e as { code: string; hint?: string });
    expect(error.code).toBe("INPUT_INVALID");
    expect(error.hint).toContain("Title");
    expect(error.hint).toContain("Body");
  });
});

describe("removeRef — no-op (ref absent)", () => {
  it("returns changed:false applied:false when the GUID is not in the list", async () => {
    const { client, updateItemFields } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          value: "{22222222-2222-2222-2222-222222222222}",
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{11111111-1111-1111-1111-111111111111}",
      allowWrite: true,
    });
    expect(result).toEqual({
      changed: false,
      before: "{22222222-2222-2222-2222-222222222222}",
      after: "{22222222-2222-2222-2222-222222222222}",
      applied: false,
    });
    // Even with allowWrite:true, a no-op never reaches the wire.
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  it("treats a null field value as an empty list (no-op)", async () => {
    const { client } = makeClient({
      fields: [{ fieldId: "f1", name: "Related", value: null as unknown as string }],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{11111111-1111-1111-1111-111111111111}",
    });
    expect(result).toEqual({ changed: false, before: "", after: "", applied: false });
  });
});

describe("removeRef — dry-run (allowWrite false / default)", () => {
  it("returns changed:true applied:false without calling updateItemFields", async () => {
    const { client, updateItemFields } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          value: "{11111111-1111-1111-1111-111111111111}|{22222222-2222-2222-2222-222222222222}",
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{11111111-1111-1111-1111-111111111111}",
    });
    expect(result.changed).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.after).toBe("{22222222-2222-2222-2222-222222222222}");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  it("dry-run still reports the diff when allowWrite is explicitly false", async () => {
    const { client, updateItemFields } = makeClient({
      fields: [{ fieldId: "f1", name: "Related", value: "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}" }],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}",
      allowWrite: false,
    });
    expect(result).toMatchObject({ changed: true, applied: false, after: "" });
    expect(updateItemFields).not.toHaveBeenCalled();
  });
});

describe("removeRef — apply (allowWrite true)", () => {
  it("writes the rejoined value and returns applied:true", async () => {
    const { client, updateItemFields } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          value:
            "{11111111-1111-1111-1111-111111111111}|{22222222-2222-2222-2222-222222222222}|{33333333-3333-3333-3333-333333333333}",
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{22222222-2222-2222-2222-222222222222}",
      allowWrite: true,
    });
    expect(result.applied).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.after).toBe(
      "{11111111-1111-1111-1111-111111111111}|{33333333-3333-3333-3333-333333333333}"
    );
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: "item-1",
      fields: [{ name: "Related", value: result.after }],
    });
  });

  it("matches case-insensitively and tolerates braces (target without braces, list with)", async () => {
    const { client, updateItemFields } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          value: "{ABCDEF12-3456-7890-ABCD-EF1234567890}",
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      // No braces, lowercase — must still match the braced uppercase entry.
      refToRemove: "abcdef12-3456-7890-abcd-ef1234567890",
      allowWrite: true,
    });
    expect(result.applied).toBe(true);
    expect(result.after).toBe("");
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: "item-1",
      fields: [{ name: "Related", value: "" }],
    });
  });

  it("removes every matching entry (dedup) when the GUID appears more than once", async () => {
    const guid = "{11111111-1111-1111-1111-111111111111}";
    const { client } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          value: `${guid}|{22222222-2222-2222-2222-222222222222}|${guid}`,
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: guid,
      allowWrite: true,
    });
    expect(result.after).toBe("{22222222-2222-2222-2222-222222222222}");
  });

  it("ignores malformed entries — empty segments and surrounding whitespace are dropped from the parse", async () => {
    const { client } = makeClient({
      fields: [
        {
          fieldId: "f1",
          name: "Related",
          // Leading pipe, doubled pipe, whitespace around entries, trailing pipe.
          value:
            "| {11111111-1111-1111-1111-111111111111} || {22222222-2222-2222-2222-222222222222} |",
        },
      ],
    });
    const result = await removeRef(client, {
      itemId: "item-1",
      fieldName: "Related",
      refToRemove: "{11111111-1111-1111-1111-111111111111}",
      allowWrite: true,
    });
    // Empty segments dropped, entries trimmed, only the survivor remains.
    expect(result.after).toBe("{22222222-2222-2222-2222-222222222222}");
    expect(result.before).toContain("||");
  });
});

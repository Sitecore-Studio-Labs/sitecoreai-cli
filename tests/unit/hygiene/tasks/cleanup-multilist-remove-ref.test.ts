/**
 * Unit coverage for `cleanup multilist remove-ref` — the single-item
 * primitive that removes one GUID from a pipe-list multilist field on
 * one item. Pairs with the bulk `cleanup field-set --mode remove` verb.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupMultilistRemoveRef } from "../../../../src/hygiene/tasks/cleanup/multilist-remove-ref";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (opts: {
  itemFields?: Array<{ fieldId: string; name: string; value: string }> | null;
  allowWrite?: boolean;
}) => {
  const env = {
    name: "sandbox",
    host: "h",
    allowWrite: opts.allowWrite ?? true,
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const updateItemFields = vi.fn().mockResolvedValue(undefined);
  const client = {
    getItemFields: vi.fn().mockResolvedValue(opts.itemFields),
    updateItemFields,
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return { client, updateItemFields };
};

describe("runCleanupMultilistRemoveRef — input validation", () => {
  it("throws INPUT_INVALID when itemId is missing", async () => {
    setup({});
    await expect(
      runCleanupMultilistRemoveRef({
        environmentName: "sandbox",
        itemId: "",
        fieldName: "F",
        refToRemove: "{aaa}",
      })
    ).rejects.toThrow(/itemId/i);
  });

  it("throws INPUT_INVALID when fieldName is missing", async () => {
    setup({});
    await expect(
      runCleanupMultilistRemoveRef({
        environmentName: "sandbox",
        itemId: "{item}",
        fieldName: "",
        refToRemove: "{aaa}",
      })
    ).rejects.toThrow(/fieldName/i);
  });

  it("throws INPUT_INVALID when refToRemove is missing", async () => {
    setup({});
    await expect(
      runCleanupMultilistRemoveRef({
        environmentName: "sandbox",
        itemId: "{item}",
        fieldName: "F",
        refToRemove: "",
      })
    ).rejects.toThrow(/refToRemove/i);
  });
});

describe("runCleanupMultilistRemoveRef — lookup failures", () => {
  it("throws INPUT_INVALID when the item is not found", async () => {
    setup({ itemFields: null });
    await expect(
      runCleanupMultilistRemoveRef({
        environmentName: "sandbox",
        itemId: "{item}",
        fieldName: "F",
        refToRemove: "{aaa}",
      })
    ).rejects.toThrow(/not found/i);
  });

  it("throws INPUT_INVALID when the named field is not present", async () => {
    setup({
      itemFields: [{ fieldId: "f-other", name: "OtherField", value: "" }],
    });
    await expect(
      runCleanupMultilistRemoveRef({
        environmentName: "sandbox",
        itemId: "{item}",
        fieldName: "MissingField",
        refToRemove: "{aaa}",
      })
    ).rejects.toThrow(/MissingField.*not found/i);
  });
});

describe("runCleanupMultilistRemoveRef — no-op + would-change + change", () => {
  // GUID absent from the multilist → no-op, no write. Field name match
  // is case-insensitive (verified via fixture casing).
  it("no-op when the GUID is absent from the field value (case-insensitive match)", async () => {
    const { updateItemFields } = setup({
      itemFields: [
        {
          fieldId: "f-list",
          name: "MyList",
          value: "{aaa}|{bbb}",
        },
      ],
    });
    const result = await runCleanupMultilistRemoveRef({
      environmentName: "sandbox",
      itemId: "{item}",
      fieldName: "mylist", // lowercase — match still works
      refToRemove: "{ccc}",
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("no-op");
    expect(result[0].before).toBe("{aaa}|{bbb}");
    expect(result[0].after).toBe("{aaa}|{bbb}");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  // --what-if + present GUID → would-change, no write.
  it("would-change in --what-if mode and skips the write", async () => {
    const { updateItemFields } = setup({
      itemFields: [{ fieldId: "f-list", name: "MyList", value: "{aaa}|{bbb}" }],
    });
    const result = await runCleanupMultilistRemoveRef({
      environmentName: "sandbox",
      itemId: "{item}",
      fieldName: "MyList",
      refToRemove: "{AAA}", // case-insensitive + brace-tolerant
      whatIf: true,
    });
    expect(result[0].status).toBe("would-change");
    expect(result[0].after).toBe("{bbb}");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  // Apply mode → changed, writes the filtered pipe-list.
  it("changed when the GUID is removed and apply mode writes the filtered list", async () => {
    const { updateItemFields } = setup({
      itemFields: [{ fieldId: "f-list", name: "MyList", value: "{aaa}|{bbb}|{ccc}" }],
    });
    const result = await runCleanupMultilistRemoveRef({
      environmentName: "sandbox",
      itemId: "{item}",
      fieldName: "MyList",
      refToRemove: "bbb", // no braces — normalize strips both sides
      allowWrite: true,
    });
    expect(result[0].status).toBe("changed");
    expect(result[0].before).toBe("{aaa}|{bbb}|{ccc}");
    expect(result[0].after).toBe("{aaa}|{ccc}");
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: "{item}",
      fields: [{ name: "MyList", value: "{aaa}|{ccc}" }],
    });
  });

  // Empty field value parses as zero entries — no-op, no write.
  it("no-op when the field value is empty (no entries to remove)", async () => {
    const { updateItemFields } = setup({
      itemFields: [{ fieldId: "f-list", name: "MyList", value: "" }],
    });
    const result = await runCleanupMultilistRemoveRef({
      environmentName: "sandbox",
      itemId: "{item}",
      fieldName: "MyList",
      refToRemove: "{aaa}",
    });
    expect(result[0].status).toBe("no-op");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  // Removing the only entry leaves an empty string in `after`.
  it("removes the only entry, leaving the field empty", async () => {
    const { updateItemFields } = setup({
      itemFields: [{ fieldId: "f-list", name: "MyList", value: "{aaa}" }],
    });
    const result = await runCleanupMultilistRemoveRef({
      environmentName: "sandbox",
      itemId: "{item}",
      fieldName: "MyList",
      refToRemove: "{aaa}",
      allowWrite: true,
    });
    expect(result[0].after).toBe("");
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: "{item}",
      fields: [{ name: "MyList", value: "" }],
    });
  });
});

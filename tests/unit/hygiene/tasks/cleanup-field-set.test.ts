/**
 * Branch coverage for `cleanup field-set` — the bulk single-field editor.
 *
 * Exercises every mode (replace / add / remove / clear), the safety
 * rails (`--field` / `--value` validation, `__`-prefixed field guard,
 * `--what-if`, allowWrite gate, `--max-mutations` cap), and the
 * shape-guard / no-change / failure skip statuses.
 *
 * Mirrors `cleanup-duplicates.test.ts` / `cleanup-find-replace.test.ts`:
 * `resolveEnvironment` + `createHygieneApiClient` are mocked, the real
 * `../shared` (scanItemsAndFields etc.) runs against a stubbed client.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupFieldSet } from "../../../../src/hygiene/tasks/cleanup/field-set";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface ItemSpec {
  id: string;
  templateName?: string;
  fields: Array<{ name: string; value: string }>;
}

const setup = (opts: { items: ItemSpec[]; allowWrite?: boolean }) => {
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
  const fieldsMap = new Map(
    opts.items.map((it) => [it.id, it.fields.map((f) => ({ fieldId: `fid-${f.name}`, ...f }))])
  );
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of opts.items) {
        yield {
          itemId: it.id,
          path: `/sitecore/content/${it.id}`,
          name: it.id,
          templateName: it.templateName ?? "Page",
          language: { name: "en" },
          version: 1,
        };
      }
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, fieldsMap.get(id) ?? null);
      return Promise.resolve(m);
    }),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn().mockResolvedValue(undefined),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const GUID_A = "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}";
const GUID_B = "{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}";

describe("cleanup field-set — input validation", () => {
  it("throws INPUT_INVALID when --field is missing", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFieldSet({ field: "", value: "x", json: true, quiet: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when --field is whitespace only", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFieldSet({ field: "   ", value: "x", json: true, quiet: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when --value is missing for a non-clear mode", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFieldSet({ field: "Title", mode: "replace", json: true, quiet: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects writing a `__`-prefixed system field without --include-system-fields", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFieldSet({
        field: "__Renderings",
        value: "x",
        json: true,
        quiet: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("allows a `__`-prefixed field when --include-system-fields is set", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "__Renderings", value: "old" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "__Renderings",
      value: "new",
      includeSystemFields: true,
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("applied");
    expect(client.updateItemFields).toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when add mode value contains no valid GUID", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFieldSet({
        field: "Tags",
        value: "not-a-guid,also-bad",
        mode: "add",
        json: true,
        quiet: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup field-set — replace mode", () => {
  it("writes the value verbatim and reports applied", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Title", value: "old" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "Brand New",
      mode: "replace",
      json: true,
      quiet: true,
    } as never);
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe("applied");
    expect(actions[0].newValue).toBe("Brand New");
    expect(client.updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Title", value: "Brand New" }],
    });
  });

  it("skips an item where the new value equals the old value (skipped-no-change)", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Title", value: "same" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "same",
      mode: "replace",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-no-change");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("ignores items whose template does not match --template-pattern", async () => {
    const client = setup({
      items: [
        { id: "i1", templateName: "Article", fields: [{ name: "Title", value: "a" }] },
        { id: "i2", templateName: "Page", fields: [{ name: "Title", value: "b" }] },
      ],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "X",
      templatePattern: "^Article$",
      json: true,
      quiet: true,
    } as never);
    expect(actions).toHaveLength(1);
    expect(actions[0].path).toContain("i1");
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
  });

  it("skips items whose current value fails --where-current-matches", async () => {
    const client = setup({
      items: [
        { id: "i1", fields: [{ name: "Title", value: "draft-x" }] },
        { id: "i2", fields: [{ name: "Title", value: "live-y" }] },
      ],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "Updated",
      whereCurrentMatches: "^draft-",
      json: true,
      quiet: true,
    } as never);
    expect(actions).toHaveLength(1);
    expect(actions[0].path).toContain("i1");
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
  });

  it("does not produce an action for an item missing the target field", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "OtherField", value: "v" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "X",
      json: true,
      quiet: true,
    } as never);
    expect(actions).toEqual([]);
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });
});

describe("cleanup field-set — clear mode", () => {
  it("wipes the field and does not require --value", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Summary", value: "stale text" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Summary",
      mode: "clear",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("applied");
    expect(actions[0].newValue).toBe("");
    expect(client.updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Summary", value: "" }],
    });
  });

  it("skips clear when the field is already empty", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Summary", value: "" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Summary",
      mode: "clear",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-no-change");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });
});

describe("cleanup field-set — add mode", () => {
  it("unions a GUID into an existing pipe-delimited list", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: GUID_A }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_B,
      mode: "add",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("applied");
    expect(actions[0].newValue).toContain(GUID_A.toLowerCase());
    expect(actions[0].newValue).toContain(GUID_B.toLowerCase());
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
  });

  it("adds a GUID to an empty multilist field", async () => {
    setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: "" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_A,
      mode: "add",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("applied");
    expect(actions[0].newValue).toBe(GUID_A.toLowerCase());
  });

  it("is a no-change skip when the GUID is already present", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: GUID_A }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_A,
      mode: "add",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-no-change");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("skips an item whose current value is not a pipe-delimited GUID list (skipped-shape)", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: "free text, not guids" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_A,
      mode: "add",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-shape");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("parses a comma-separated multi-GUID value", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: "" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: `${GUID_A},${GUID_B}`,
      mode: "add",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].newValue.split("|")).toHaveLength(2);
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup field-set — remove mode", () => {
  it("subtracts a GUID from an existing list", async () => {
    setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: `${GUID_A}|${GUID_B}` }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_B,
      mode: "remove",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("applied");
    expect(actions[0].newValue).toBe(GUID_A.toLowerCase());
  });

  it("is a no-change skip when the GUID is not in the list", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: GUID_A }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_B,
      mode: "remove",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-no-change");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("skips an incompatible-shape value (skipped-shape)", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Tags", value: "plain string value" }] }],
    });
    const actions = await runCleanupFieldSet({
      field: "Tags",
      value: GUID_A,
      mode: "remove",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("skipped-shape");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });
});

describe("cleanup field-set — what-if + allowWrite gate", () => {
  it("--what-if reports a what-if action and never writes", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Title", value: "old" }] }],
      allowWrite: false,
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "new",
      whatIf: true,
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("what-if");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("requires allowWrite outside --what-if", async () => {
    setup({
      items: [{ id: "i1", fields: [{ name: "Title", value: "old" }] }],
      allowWrite: false,
    });
    await expect(
      runCleanupFieldSet({
        field: "Title",
        value: "new",
        json: true,
        quiet: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup field-set — failure + cap", () => {
  it("captures an updateItemFields failure as a failed status", async () => {
    const client = setup({
      items: [{ id: "i1", fields: [{ name: "Title", value: "old" }] }],
    });
    (client.updateItemFields as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("field locked")
    );
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "new",
      json: true,
      quiet: true,
    } as never);
    expect(actions[0].status).toBe("failed");
    expect(actions[0].error).toContain("field locked");
  });

  it("stops planning once --max-mutations is hit", async () => {
    const client = setup({
      items: [
        { id: "i1", fields: [{ name: "Title", value: "a" }] },
        { id: "i2", fields: [{ name: "Title", value: "b" }] },
        { id: "i3", fields: [{ name: "Title", value: "c" }] },
      ],
    });
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "Z",
      maxMutations: 2,
      json: true,
      quiet: true,
    } as never);
    // The cap stops the plan loop once 2 mutating plans accumulate.
    expect(actions.filter((a) => a.status === "applied").length).toBeLessThanOrEqual(2);
    expect(client.updateItemFields).toHaveBeenCalledTimes(actions.length);
    expect(actions.length).toBeLessThan(3);
  });
});

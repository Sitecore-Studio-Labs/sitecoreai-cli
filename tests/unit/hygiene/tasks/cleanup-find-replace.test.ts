import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupFindReplace } from "../../../../src/hygiene/tasks/cleanup/find-replace";

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
  items: Array<{ id: string; fields: Array<{ name: string; value: string }> }>;
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
  const fieldsMap = new Map(
    opts.items.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
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
  } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup find-replace — safety rails", () => {
  it("rejects missing --pattern", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFindReplace({ pattern: "", replacement: "y", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects missing --replacement", async () => {
    setup({ items: [] });
    await expect(
      runCleanupFindReplace({ pattern: "x", replacement: undefined, json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite (env or --allow-write) when not --what-if", async () => {
    setup({
      items: [{ id: "a", fields: [{ name: "Title", value: "Hello" }] }],
      allowWrite: false,
    });
    await expect(
      runCleanupFindReplace({
        pattern: "Hello",
        replacement: "World",
        literal: true,
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup find-replace — mutation logic", () => {
  it("applies replacement and calls updateItemFields per matched item", async () => {
    const client = setup({
      items: [{ id: "a", fields: [{ name: "Title", value: "old text old" }] }],
    });
    const result = await runCleanupFindReplace({
      pattern: "old",
      replacement: "new",
      literal: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("applied");
    expect(result[0].fieldsChanged[0].matchCount).toBe(2);
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
    expect(client.updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Title", value: "new text new" }],
    });
  });

  it("--what-if reports plan but does not mutate", async () => {
    const client = setup({
      items: [{ id: "a", fields: [{ name: "Title", value: "Hello" }] }],
      allowWrite: false,
    });
    const result = await runCleanupFindReplace({
      pattern: "Hello",
      replacement: "Hi",
      literal: true,
      whatIf: true,
      json: true,
    } as never);
    expect(result[0].status).toBe("what-if");
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });

  it("respects --max-mutations cap", async () => {
    setup({
      items: [
        { id: "a", fields: [{ name: "Title", value: "x" }] },
        { id: "b", fields: [{ name: "Title", value: "x" }] },
        { id: "c", fields: [{ name: "Title", value: "x" }] },
      ],
    });
    const result = await runCleanupFindReplace({
      pattern: "x",
      replacement: "y",
      literal: true,
      maxMutations: 2,
      whatIf: true,
      json: true,
    } as never);
    expect(result).toHaveLength(2);
  });

  it("supports regex backreferences in replacement", async () => {
    const client = setup({
      items: [{ id: "a", fields: [{ name: "Title", value: "v1.2.3" }] }],
    });
    await runCleanupFindReplace({
      pattern: "v(\\d+)\\.(\\d+)\\.(\\d+)",
      replacement: "$1.$2.$3",
      json: true,
    } as never);
    expect(client.updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Title", value: "1.2.3" }],
    });
  });

  it("skips items where pattern matches but replacement equals original", async () => {
    const client = setup({
      items: [{ id: "a", fields: [{ name: "Title", value: "Hello" }] }],
    });
    const result = await runCleanupFindReplace({
      pattern: "Hello",
      replacement: "Hello",
      literal: true,
      json: true,
    } as never);
    expect(result).toHaveLength(0);
    expect(client.updateItemFields).not.toHaveBeenCalled();
  });
});

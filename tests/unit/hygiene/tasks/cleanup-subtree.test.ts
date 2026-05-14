import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
vi.mock("../../../../src/shared/allow-write", () => ({ ensureAllowWrite: vi.fn() }));

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupSubtree } from "../../../../src/hygiene/tasks/cleanup-subtree";

const SUBTREE_PATH = "/sitecore/content/Site/Old";
const ROOT_ID = "11111111111111111111111111111111";
const CHILD_ID = "22222222222222222222222222222222";
const GRANDCHILD_ID = "33333333333333333333333333333333";
const EXTERNAL_ID = "44444444444444444444444444444444";

const setup = (params: {
  /** Items to return when the scan walks `--scan-root` looking for inbound refs. */
  scannedItems?: Array<{
    id: string;
    path?: string;
    fields: Array<{ name: string; value: string }>;
  }>;
  /** Descendant ids returned by the subtree-enumeration search. */
  descendants?: string[];
  /** Override subtree root path for tests that probe missing-root. */
  rootMissing?: boolean;
  allowWrite?: boolean;
}) => {
  const env = { name: "sandbox", host: "h", allowWrite: params.allowWrite ?? true } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });

  const scannedItems = params.scannedItems ?? [];
  const fieldsMap = new Map(
    scannedItems.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const descendants = params.descendants ?? [];

  const client = {
    search: vi.fn().mockImplementation((input: { searchStatement?: unknown }) => {
      const stmt = input.searchStatement as
        | { criteria?: { field?: string; value?: string } }
        | undefined;
      const field = stmt?.criteria?.field;
      const value = stmt?.criteria?.value;
      if (field === "_fullpath") {
        // Subtree root resolution OR scanItemsAndFields' scan-root resolution.
        if (value === SUBTREE_PATH.toLowerCase()) {
          if (params.rootMissing) return Promise.resolve({ totalCount: 0, results: [] });
          return Promise.resolve({
            totalCount: 1,
            results: [{ itemId: ROOT_ID, path: SUBTREE_PATH }],
          });
        }
        return Promise.resolve({
          totalCount: 1,
          results: [{ itemId: "scanrootid", path: value }],
        });
      }
      if (field === "_path") {
        // Not used here — the cleanup uses searchAll for descendant
        // enumeration via buildPathFilterStatement. Return empty.
        return Promise.resolve({ totalCount: 0, results: [] });
      }
      return Promise.resolve({ totalCount: 0, results: [] });
    }),
    searchAll: vi.fn().mockImplementation(async function* (
      query: { searchStatement?: { criteria?: { field?: string; value?: string } } }
    ) {
      const stmt = query.searchStatement;
      const field = stmt?.criteria?.field;
      const value = stmt?.criteria?.value;
      // Differentiate the two _path-filtered iterators by the ancestor
      // itemId in the criteria value: the subtree walker passes ROOT_ID,
      // the scanItemsAndFields walker passes the scan-root id (here
      // "scanrootid" from the _fullpath mock above).
      if (field === "_path" && value === ROOT_ID) {
        for (const id of descendants) {
          yield {
            itemId: id,
            path: `${SUBTREE_PATH}/${id.slice(0, 6)}`,
            name: id.slice(0, 6),
            templateName: "Page",
            language: { name: "en" },
            version: 1,
          };
        }
        return;
      }
      if (field === "_path") {
        // scanItemsAndFields enumeration for the inbound-ref scan.
        for (const it of scannedItems) {
          yield {
            itemId: it.id,
            path: it.path ?? `/sitecore/content/Other/${it.id.slice(0, 6)}`,
            name: it.id.slice(0, 6),
            templateName: "Page",
            language: { name: "en" },
            version: 1,
          };
        }
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
    deleteItem: vi.fn().mockResolvedValue(undefined),
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

describe("cleanup subtree — safety rails", () => {
  it("throws when --path is missing", async () => {
    setup({});
    await expect(runCleanupSubtree({ json: true } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("refuses protected roots without --force", async () => {
    setup({});
    await expect(
      runCleanupSubtree({
        path: "/sitecore/system/Workflows",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("--force allows protected roots", async () => {
    setup({ descendants: [] });
    await expect(
      runCleanupSubtree({
        path: "/sitecore/system/Workflows",
        force: true,
        whatIf: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("refuses when --path is not under --scan-root", async () => {
    setup({});
    await expect(
      runCleanupSubtree({
        path: SUBTREE_PATH,
        scanRoot: "/sitecore/templates",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("errors when the subtree root doesn't exist", async () => {
    setup({ rootMissing: true });
    await expect(
      runCleanupSubtree({ path: SUBTREE_PATH, json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("enforces --max-deletions", async () => {
    setup({ descendants: [CHILD_ID, GRANDCHILD_ID] });
    await expect(
      runCleanupSubtree({
        path: SUBTREE_PATH,
        maxDeletions: 1,
        whatIf: true,
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup subtree — hard-block default", () => {
  it("refuses to delete when external items reference the subtree", async () => {
    setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          // External item's Link field references the subtree's child.
          fields: [{ name: "Link", value: `{${dashed(CHILD_ID).toUpperCase()}}` }],
        },
      ],
    });

    await expect(
      runCleanupSubtree({
        path: SUBTREE_PATH,
        whatIf: true,
        json: true,
      } as never)
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("external reference"),
    });
  });

  it("self-references inside the subtree are NOT blockers", async () => {
    const client = setup({
      descendants: [CHILD_ID, GRANDCHILD_ID],
      // Make scanItemsAndFields surface the subtree items themselves
      // (would happen on a tenant where scan-root encompasses the
      // subtree). The cleanup must skip them when checking blockers.
      scannedItems: [
        {
          id: CHILD_ID,
          // Child references grandchild — internal ref, doomed anyway.
          fields: [{ name: "Link", value: dashed(GRANDCHILD_ID) }],
        },
        {
          id: GRANDCHILD_ID,
          fields: [],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      whatIf: true,
      json: true,
    } as never);

    expect(result.blockers).toEqual([]);
    expect(result.deletions.every((d) => d.status === "what-if")).toBe(true);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });
});

describe("cleanup subtree — orphan-external-refs clear", () => {
  it("clears referring fields then deletes the subtree", async () => {
    const client = setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          fields: [{ name: "Link", value: dashed(CHILD_ID) }],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "clear",
      allowWrite: true,
      json: true,
    } as never);

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].cleared).toBe(true);
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
    expect(client.updateItemFields).toHaveBeenCalledWith({
      itemId: EXTERNAL_ID,
      fields: [{ name: "Link", value: "" }],
    });
    // Root + 1 descendant deleted.
    expect(client.deleteItem).toHaveBeenCalledTimes(2);
    expect(result.deletions.every((d) => d.status === "deleted")).toBe(true);
  });

  it("what-if reports the planned clear + delete without mutating", async () => {
    const client = setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          fields: [{ name: "Link", value: dashed(CHILD_ID) }],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "clear",
      whatIf: true,
      json: true,
    } as never);

    expect(result.blockers).toHaveLength(1);
    // No mutations in what-if mode.
    expect(client.updateItemFields).not.toHaveBeenCalled();
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(result.deletions.every((d) => d.status === "what-if")).toBe(true);
  });

  it("groups multiple targets in the same field into one update", async () => {
    const client = setup({
      descendants: [CHILD_ID, GRANDCHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          // Multi-list field with TWO refs into the subtree.
          fields: [
            {
              name: "Items",
              value: `{${dashed(CHILD_ID).toUpperCase()}}|{${dashed(GRANDCHILD_ID).toUpperCase()}}`,
            },
          ],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "clear",
      allowWrite: true,
      json: true,
    } as never);

    expect(result.blockers).toHaveLength(2);
    // Two blockers, one update (grouped by referrer + field).
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup subtree — bottom-up order", () => {
  it("deletes deeper paths before shallower ones", async () => {
    const deletes: string[] = [];
    const client = setup({
      descendants: [CHILD_ID, GRANDCHILD_ID],
    });
    (client.deleteItem as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { itemId: string }) => {
        deletes.push(input.itemId);
      }
    );

    await runCleanupSubtree({
      path: SUBTREE_PATH,
      allowWrite: true,
      json: true,
    } as never);

    // The mock builds child paths as `${SUBTREE_PATH}/${id.slice(0,6)}`,
    // so descendants have longer paths than the root. Bottom-up means
    // the root (shortest path) is deleted LAST.
    expect(deletes[deletes.length - 1]).toBe(ROOT_ID);
  });
});

const dashed = (flat: string): string =>
  `${flat.slice(0, 8)}-${flat.slice(8, 12)}-${flat.slice(12, 16)}-${flat.slice(16, 20)}-${flat.slice(20)}`;

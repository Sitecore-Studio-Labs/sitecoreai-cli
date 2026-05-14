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
  const env = {
    name: "sandbox",
    host: "h",
    allowWrite: params.allowWrite ?? true,
  } as EnvironmentConfiguration;
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
    searchAll: vi.fn().mockImplementation(async function* (query: {
      searchStatement?: { criteria?: { field?: string; value?: string } };
    }) {
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

describe("cleanup subtree — orphan-external-refs prune", () => {
  it("prunes a multi-list field, preserving sibling entries", async () => {
    const client = setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          fields: [
            {
              name: "Items",
              // Multi-list with the subtree target + a survivor.
              value: `{${dashed(CHILD_ID).toUpperCase()}}|{11111111-2222-3333-4444-555555555555}`,
            },
          ],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "prune",
      allowWrite: true,
      json: true,
    } as never);

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].cleared).toBe(true);
    // updateItemFields called with the pruned value — survivor kept.
    expect(client.updateItemFields).toHaveBeenCalledTimes(1);
    const [updateCall] = (client.updateItemFields as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCall[0].fields[0].value).toBe("{11111111-2222-3333-4444-555555555555}");
    expect(updateCall[0].fields[0].value).not.toContain(CHILD_ID.toUpperCase());
  });

  it("prunes a renderings-XML field, preserving non-target renderings", async () => {
    const xml =
      `<r xmlns:xsd="x" xmlns:xsi="y">` +
      `<d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}">` +
      `<r id="{${dashed(CHILD_ID).toUpperCase()}}" placeh="/header" uid="{aaa11111-1111-1111-1111-111111111111}" />` +
      `<r id="{99999999-8888-7777-6666-555555555555}" placeh="/main" uid="{bbb22222-2222-2222-2222-222222222222}" />` +
      `</d></r>`;

    const client = setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          fields: [{ name: "__Renderings", value: xml }],
        },
      ],
    });

    const result = await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "prune",
      allowWrite: true,
      json: true,
    } as never);

    expect(result.blockers).toHaveLength(1);
    const [updateCall] = (client.updateItemFields as ReturnType<typeof vi.fn>).mock.calls;
    const written: string = updateCall[0].fields[0].value;
    expect(written).not.toContain(CHILD_ID.toUpperCase());
    // Surviving rendering preserved.
    expect(written).toContain("99999999-8888-7777-6666-555555555555");
    // Outer <r>/<d> wrapper preserved.
    expect(written).toContain('xmlns:xsd="x"');
  });

  it("falls back to clear when the field value isn't a known multi-shape", async () => {
    const client = setup({
      descendants: [CHILD_ID],
      scannedItems: [
        {
          id: EXTERNAL_ID,
          path: "/sitecore/content/Other/Page",
          // Single-value droplist storing a bare GUID — pruning a
          // single-value field has nothing to preserve, so it should
          // clear like `clear` mode.
          fields: [{ name: "Link", value: dashed(CHILD_ID) }],
        },
      ],
    });

    await runCleanupSubtree({
      path: SUBTREE_PATH,
      orphanExternalRefs: "prune",
      allowWrite: true,
      json: true,
    } as never);

    const [updateCall] = (client.updateItemFields as ReturnType<typeof vi.fn>).mock.calls;
    // A single-GUID multi-list IS a valid multi-list — pruner returns
    // an empty string. Same as clear in this case.
    expect(updateCall[0].fields[0].value).toBe("");
  });
});

describe("cleanup subtree — orphan-external-refs leave", () => {
  it("skips the inbound-ref scan and deletes even when refs exist on the tenant", async () => {
    const client = setup({
      descendants: [CHILD_ID],
      // External item with a real reference into the subtree. In `block`
      // mode this would refuse; in `leave` it should be ignored.
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
      orphanExternalRefs: "leave",
      allowWrite: true,
      json: true,
    } as never);

    // No blockers surfaced (scan didn't run), no field updates issued,
    // subtree still deleted bottom-up.
    expect(result.blockers).toEqual([]);
    expect(client.updateItemFields).not.toHaveBeenCalled();
    expect(client.deleteItem).toHaveBeenCalledTimes(2);
    expect(result.deletions.every((d) => d.status === "deleted")).toBe(true);
    expect(result.policy).toBe("leave");
  });

  it("waives the path-under-scan-root invariant (scan doesn't run)", async () => {
    setup({ descendants: [] });
    // In any non-leave mode this combination throws; leave should be
    // tolerant since it doesn't scan.
    await expect(
      runCleanupSubtree({
        path: SUBTREE_PATH,
        scanRoot: "/sitecore/templates",
        orphanExternalRefs: "leave",
        whatIf: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("what-if reports the planned deletions without scanning", async () => {
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
      orphanExternalRefs: "leave",
      whatIf: true,
      json: true,
    } as never);

    expect(result.blockers).toEqual([]);
    expect(result.deletions.every((d) => d.status === "what-if")).toBe(true);
    expect(client.deleteItem).not.toHaveBeenCalled();
    // The scanItemsAndFields getItemFieldsBatch should not have been
    // hit — its `searchAll` for the scan-root wouldn't fire either,
    // but assert on the more visible field-fetch call.
    expect(client.getItemFieldsBatch).not.toHaveBeenCalled();
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

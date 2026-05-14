import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupDuplicates } from "../../../../src/hygiene/tasks/cleanup-duplicates";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const mkItems = (specs: Array<{ id: string; path: string; created?: string }>) =>
  specs.map((s) => ({
    itemId: s.id,
    path: s.path,
    name: s.path.split("/").pop()!,
    language: { name: "en" },
    version: 1,
    createdDate: s.created ?? "2026-01-01T00:00:00Z",
    updatedDate: "2026-01-02T00:00:00Z",
    templateName: "Generic",
  }));

const setup = (opts: {
  items: ReturnType<typeof mkItems>;
  identicalFields?: boolean;
  allowWrite?: boolean;
}) => {
  const env = {
    name: "sandbox",
    host: "h",
    allowWrite: opts.allowWrite ?? true,
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });

  const identical = opts.identicalFields !== false;
  const fieldsMap = new Map<string, Array<{ fieldId: string; name: string; value: string }>>();
  for (const item of opts.items) {
    fieldsMap.set(item.itemId, [
      { fieldId: "f1", name: "Title", value: identical ? "Hello" : item.path },
    ]);
  }

  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/Root" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of opts.items) yield it;
    }),
    getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
      const out = new Map();
      for (const id of ids) out.set(id, fieldsMap.get(id) ?? null);
      return Promise.resolve(out);
    }),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    getItemFields: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
  } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup duplicates — keep-rule strategies", () => {
  it("oldest: keeps the earliest createdDate, deletes the rest", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A", created: "2026-03-01T00:00:00Z" },
      { id: "b", path: "/sitecore/content/Root/B", created: "2026-01-01T00:00:00Z" }, // oldest
      { id: "c", path: "/sitecore/content/Root/C", created: "2026-02-01T00:00:00Z" },
    ]);
    const client = setup({ items });
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe("b");
    expect(result[0].deleted.map((d) => d.itemId).sort()).toEqual(["a", "c"]);
    expect(client.deleteItem).toHaveBeenCalledTimes(2);
  });

  it("newest: keeps the latest updatedDate, deletes the rest", async () => {
    const base = mkItems([
      { id: "a", path: "/sitecore/content/Root/A" },
      { id: "b", path: "/sitecore/content/Root/B" },
    ]);
    base[0].updatedDate = "2026-01-01T00:00:00Z";
    base[1].updatedDate = "2026-06-01T00:00:00Z"; // newer
    setup({ items: base });
    const result = await runCleanupDuplicates({
      keepRule: "newest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("b");
  });

  it("shortest-path: keeps the shortest path", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/very/deep/path/A" },
      { id: "b", path: "/sitecore/content/Root/B" }, // shortest
      { id: "c", path: "/sitecore/content/Root/path/C" },
    ]);
    setup({ items });
    const result = await runCleanupDuplicates({
      keepRule: "shortest-path",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("b");
  });

  it("rejects interactive mode under --non-interactive", async () => {
    setup({ items: mkItems([{ id: "a", path: "/x" }]) });
    await expect(
      runCleanupDuplicates({
        keepRule: "interactive",
        root: "/sitecore/content/Root",
        json: true,
        nonInteractive: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup duplicates — what-if + safety", () => {
  it("--what-if reports the plan but does not delete", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A" },
      { id: "b", path: "/sitecore/content/Root/B" },
    ]);
    const client = setup({ items, allowWrite: false });
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      whatIf: true,
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].deleted.every((d) => d.status === "what-if")).toBe(true);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });
});

describe("cleanup duplicates — inbound-reference pre-flight", () => {
  const GUID_A = "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const GUID_B = "bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const GUID_C = "cccccccccccc4ccc8ccccccccccccccc";

  it("blocks delete when a content field references the dupe (default pre-flight)", async () => {
    // A (older) and B are dupes (same Title="Hello"); C is a distinct
    // item with a Link field referencing B. Keep-rule "oldest" keeps A;
    // B becomes the deletion candidate, and the pre-flight finds C's
    // ref to B — the action should be blocked.
    const items = mkItems([
      { id: GUID_A, path: "/sitecore/content/Root/A", created: "2026-01-01T00:00:00Z" },
      { id: GUID_B, path: "/sitecore/content/Root/B", created: "2026-02-01T00:00:00Z" },
      { id: GUID_C, path: "/sitecore/content/Root/C" },
    ]);
    const env = {
      name: "sandbox",
      host: "h",
      allowWrite: true,
    } as EnvironmentConfiguration;
    vi.mocked(resolveEnvironment).mockReturnValue({
      envName: env.name!,
      environment: env,
      root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
      timeoutMs: undefined,
    });

    const fieldsByItemId = new Map<string, Array<{ fieldId: string; name: string; value: string }>>(
      [
        [GUID_A, [{ fieldId: "f1", name: "Title", value: "Hello" }]],
        [GUID_B, [{ fieldId: "f1", name: "Title", value: "Hello" }]],
        // C is NOT a dupe (different Title) and references B in a Link field.
        [
          GUID_C,
          [
            { fieldId: "f1", name: "Title", value: "Unique" },
            { fieldId: "f2", name: "Link", value: `{${GUID_B.toUpperCase()}}` },
          ],
        ],
      ]
    );
    const client = {
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/Root" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        for (const it of items) yield it;
      }),
      getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
        const out = new Map();
        for (const id of ids) out.set(id, fieldsByItemId.get(id) ?? null);
        return Promise.resolve(out);
      }),
      deleteItem: vi.fn().mockResolvedValue(undefined),
      getItemFields: vi.fn(),
      itemExists: vi.fn(),
      itemsExistBatch: vi.fn(),
      getItemVersions: vi.fn(),
      getItemWorkflow: vi.fn(),
      listArchivedItems: vi.fn(),
      deleteItemVersion: vi.fn(),
      deleteItemTemplate: vi.fn(),
      deleteArchivedItem: vi.fn(),
      archiveVersion: vi.fn(),
      listItemTemplates: vi.fn(),
      getChildren: vi.fn(),
    } as HygieneApiClient;
    vi.mocked(createHygieneApiClient).mockReturnValue(client);

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe(GUID_A);
    const bDeletion = result[0].deleted.find((d) => d.itemId === GUID_B);
    expect(bDeletion?.status).toBe("blocked");
    expect(bDeletion?.blockers).toBeDefined();
    expect(bDeletion?.blockers?.length ?? 0).toBeGreaterThan(0);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("--skip-ref-check bypasses the pre-flight", async () => {
    const items = mkItems([
      { id: GUID_A, path: "/sitecore/content/Root/A" },
      { id: GUID_B, path: "/sitecore/content/Root/B" },
    ]);
    const client = setup({ items });
    await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      skipRefCheck: true,
      json: true,
      quiet: true,
    } as never);
    expect(client.deleteItem).toHaveBeenCalled();
  });

  it("--force bypasses the pre-flight even when refs exist", async () => {
    const items = mkItems([
      { id: GUID_A, path: "/sitecore/content/Root/A" },
      { id: GUID_B, path: "/sitecore/content/Root/B" },
    ]);
    const client = setup({ items });
    await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      force: true,
      json: true,
      quiet: true,
    } as never);
    expect(client.deleteItem).toHaveBeenCalled();
  });
});

describe("cleanup duplicates — pre-computed groups (--from-stdin path)", () => {
  const GUID_X = "11111111111111111111111111111111";
  const GUID_Y = "22222222222222222222222222222222";

  it("skips the internal audit when preComputedGroups is supplied", async () => {
    // Make sure setup() exists; do not yield any dupe items via the audit
    // — searchAll yields nothing. If the cleanup ran the internal audit,
    // it would find zero groups; with preComputedGroups, it sees ours.
    const env = {
      name: "sandbox",
      host: "h",
      allowWrite: true,
    } as EnvironmentConfiguration;
    vi.mocked(resolveEnvironment).mockReturnValue({
      envName: env.name!,
      environment: env,
      root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
      timeoutMs: undefined,
    });

    const searchAll = vi.fn().mockImplementation(async function* () {
      // Yield nothing — proves the cleanup didn't fall back to the audit.
    });
    const client = {
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/Root" }],
      }),
      searchAll,
      getItemFieldsBatch: vi.fn().mockResolvedValue(
        new Map([
          [GUID_X, []],
          [GUID_Y, []],
        ])
      ),
      deleteItem: vi.fn().mockResolvedValue(undefined),
      getItemFields: vi.fn(),
      itemExists: vi.fn(),
      itemsExistBatch: vi.fn(),
      getItemVersions: vi.fn(),
      getItemWorkflow: vi.fn(),
      listArchivedItems: vi.fn(),
      deleteItemVersion: vi.fn(),
      deleteItemTemplate: vi.fn(),
      deleteArchivedItem: vi.fn(),
      archiveVersion: vi.fn(),
      listItemTemplates: vi.fn(),
      getChildren: vi.fn(),
    } as HygieneApiClient;
    vi.mocked(createHygieneApiClient).mockReturnValue(client);

    const preComputedGroups = [
      {
        contentHash: "hash-1",
        count: 2,
        members: [
          {
            itemId: GUID_X,
            path: "/sitecore/content/Root/X",
            name: "X",
            language: { name: "en" },
            version: 1,
            createdDate: "2026-01-01T00:00:00Z",
            updatedDate: "2026-01-02T00:00:00Z",
            templateName: "Generic",
          },
          {
            itemId: GUID_Y,
            path: "/sitecore/content/Root/Y",
            name: "Y",
            language: { name: "en" },
            version: 1,
            createdDate: "2026-02-01T00:00:00Z",
            updatedDate: "2026-02-02T00:00:00Z",
            templateName: "Generic",
          },
        ],
      },
    ];

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups,
      skipRefCheck: true,
      json: true,
      quiet: true,
    } as never);

    expect(searchAll).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe(GUID_X);
    expect(result[0].deleted).toHaveLength(1);
    expect(result[0].deleted[0].itemId).toBe(GUID_Y);
  });
});

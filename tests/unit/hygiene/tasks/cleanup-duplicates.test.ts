import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupDuplicates } from "../../../../src/hygiene/tasks/cleanup/duplicates";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
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

  it("shortest-path: keeps the shortest path (cross-parent grouping via groupBy)", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/very/deep/path/A" },
      { id: "b", path: "/sitecore/content/Root/B" }, // shortest
      { id: "c", path: "/sitecore/content/Root/path/C" },
    ]);
    setup({ items });
    // Items at different parents would NOT group together under the
    // default (contentHash, templateId, parentPath) key — that's the
    // 2026-05-14 safety fix. Opt into the looser contentHash-only key
    // to exercise the cross-parent dedup path that this test covers.
    const result = await runCleanupDuplicates({
      keepRule: "shortest-path",
      root: "/sitecore/content/Root",
      groupBy: ["contentHash"],
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

  it("requires allowWrite outside --what-if", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A" },
      { id: "b", path: "/sitecore/content/Root/B" },
    ]);
    setup({ items, allowWrite: false });
    await expect(
      runCleanupDuplicates({
        keepRule: "oldest",
        root: "/sitecore/content/Root",
        json: true,
        quiet: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("returns an empty action list when no duplicate groups are found", async () => {
    // identicalFields:false → each item gets a unique field value, so
    // no two items share a content hash → no groups.
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A" },
      { id: "b", path: "/sitecore/content/Root/B" },
    ]);
    const client = setup({ items, identicalFields: false });
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toEqual([]);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });
});

describe("cleanup duplicates — keep-rule date edge cases", () => {
  it("oldest: items missing createdDate sort last (kept item has a date)", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A", created: "2026-05-01T00:00:00Z" },
      { id: "b", path: "/sitecore/content/Root/B", created: "2026-02-01T00:00:00Z" },
    ]);
    // Strip createdDate from item A — it should sort to the end
    // (POSITIVE_INFINITY), leaving B (Feb) as the survivor.
    (items[0] as { createdDate?: string }).createdDate = undefined;
    const client = setup({ items });
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("b");
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
  });

  it("shortest-path tie-break falls back to lexical order", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/Zeta" },
      { id: "b", path: "/sitecore/content/Root/Beta" },
    ]);
    setup({ items });
    // Both paths are the same length → tie broken lexically: Beta < Zeta.
    const result = await runCleanupDuplicates({
      keepRule: "shortest-path",
      root: "/sitecore/content/Root",
      groupBy: ["contentHash"],
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("b");
  });
});

describe("cleanup duplicates — delete failures", () => {
  it("captures a deleteItem failure as a failed status without aborting", async () => {
    const items = mkItems([
      { id: "a", path: "/sitecore/content/Root/A", created: "2026-01-01T00:00:00Z" },
      { id: "b", path: "/sitecore/content/Root/B", created: "2026-02-01T00:00:00Z" },
    ]);
    const client = setup({ items });
    (client.deleteItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("delete blocked by lock")
    );
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      skipRefCheck: true,
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("a");
    expect(result[0].deleted[0].status).toBe("failed");
    expect(result[0].deleted[0].error).toContain("delete blocked by lock");
  });
});

describe("cleanup duplicates — interactive prompt", () => {
  const withTty = async (fn: () => Promise<void>): Promise<void> => {
    const original = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      await fn();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: original, configurable: true });
    }
  };

  it("keeps the operator-selected member in interactive mode", async () => {
    const items = mkItems([
      { id: "aaa", path: "/sitecore/content/Root/A" },
      { id: "bbb", path: "/sitecore/content/Root/B" },
      { id: "ccc", path: "/sitecore/content/Root/C" },
    ]);
    const client = setup({ items });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const readline = await import("node:readline");
    const rlSpy = vi.spyOn(readline.default, "createInterface").mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb("2"),
      close: vi.fn(),
    } as never);
    try {
      await withTty(async () => {
        const result = await runCleanupDuplicates({
          keepRule: "interactive",
          root: "/sitecore/content/Root",
          json: true,
          quiet: true,
        } as never);
        // Answer "2" → keep the second member (bbb).
        expect(result[0].kept.itemId).toBe("bbb");
        expect(result[0].deleted.map((d) => d.itemId).sort()).toEqual(["aaa", "ccc"]);
        expect(client.deleteItem).toHaveBeenCalledTimes(2);
      });
    } finally {
      rlSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });

  it("leaves a group untouched when the operator answers 's'", async () => {
    const items = mkItems([
      { id: "aaa", path: "/sitecore/content/Root/A" },
      { id: "bbb", path: "/sitecore/content/Root/B" },
    ]);
    const client = setup({ items });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const readline = await import("node:readline");
    const rlSpy = vi.spyOn(readline.default, "createInterface").mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb("s"),
      close: vi.fn(),
    } as never);
    try {
      await withTty(async () => {
        const result = await runCleanupDuplicates({
          keepRule: "interactive",
          root: "/sitecore/content/Root",
          json: true,
          quiet: true,
        } as never);
        // "s" skip → no deletions for the group.
        expect(result[0].deleted).toEqual([]);
        expect(client.deleteItem).not.toHaveBeenCalled();
      });
    } finally {
      rlSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });

  it("rejects an out-of-range interactive selection with INPUT_INVALID", async () => {
    const items = mkItems([
      { id: "aaa", path: "/sitecore/content/Root/A" },
      { id: "bbb", path: "/sitecore/content/Root/B" },
    ]);
    setup({ items });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const readline = await import("node:readline");
    const rlSpy = vi.spyOn(readline.default, "createInterface").mockReturnValue({
      question: (_q: string, cb: (a: string) => void) => cb("99"),
      close: vi.fn(),
    } as never);
    try {
      await withTty(async () => {
        await expect(
          runCleanupDuplicates({
            keepRule: "interactive",
            root: "/sitecore/content/Root",
            json: true,
            quiet: true,
          } as never)
        ).rejects.toMatchObject({ code: "INPUT_INVALID" });
      });
    } finally {
      rlSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});

describe("cleanup duplicates — preComputedGroups", () => {
  const mkGroup = () => ({
    contentHash: "hash-deadbeef",
    count: 2,
    members: [
      {
        itemId: "11111111111111111111111111111111",
        path: "/sitecore/content/Root/Keep",
        name: "Keep",
        createdDate: "2026-01-01T00:00:00Z",
        updatedDate: "2026-01-02T00:00:00Z",
        language: "en",
        version: 1,
        templateName: "Generic",
      },
      {
        itemId: "22222222222222222222222222222222",
        path: "/sitecore/content/Root/Dupe",
        name: "Dupe",
        createdDate: "2026-03-01T00:00:00Z",
        updatedDate: "2026-03-02T00:00:00Z",
        language: "en",
        version: 1,
        templateName: "Generic",
      },
    ],
  });

  it("uses the supplied groups and skips internal audit discovery", async () => {
    const client = setup({ items: mkItems([]) });
    // searchAll yields nothing → if runAuditDuplicates ran it would
    // produce no groups. The preComputedGroups path bypasses it.
    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups: [mkGroup()],
      skipRefCheck: true,
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe("11111111111111111111111111111111");
    expect(result[0].deleted).toHaveLength(1);
    expect(result[0].deleted[0].status).toBe("deleted");
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
  });

  it("blocks a dupe delete when the ref-check finds inbound references", async () => {
    // searchAll yields an item whose field value embeds the dupe's
    // itemId — runAuditReferences will surface it as a blocker.
    const client = setup({ items: mkItems([]) });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield {
        itemId: "99999999999999999999999999999999",
        path: "/sitecore/content/Root/Referrer",
        name: "Referrer",
        templateName: "Page",
        language: { name: "en" },
        version: 1,
        updatedDate: "2026-01-01T00:00:00Z",
      };
    });
    (client.getItemFieldsBatch as ReturnType<typeof vi.fn>).mockImplementation((ids: string[]) => {
      const out = new Map();
      for (const id of ids) {
        out.set(id, [
          {
            fieldId: "f1",
            name: "RelatedItem",
            // Contains the Dupe's itemId → an inbound reference.
            value: "{22222222-2222-2222-2222-222222222222}",
          },
        ]);
      }
      return Promise.resolve(out);
    });

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups: [mkGroup()],
      json: true,
      quiet: true,
    } as never);

    expect(result[0].deleted[0].status).toBe("blocked");
    expect(result[0].deleted[0].blockers?.length).toBeGreaterThan(0);
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("--force bypasses the ref-check and deletes despite inbound refs", async () => {
    const client = setup({ items: mkItems([]) });
    const searchAllSpy = vi.fn().mockImplementation(async function* () {
      yield {
        itemId: "99999999999999999999999999999999",
        path: "/sitecore/content/Root/Referrer",
        name: "Referrer",
        templateName: "Page",
        language: { name: "en" },
        version: 1,
        updatedDate: "2026-01-01T00:00:00Z",
      };
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(searchAllSpy);

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups: [mkGroup()],
      force: true,
      json: true,
      quiet: true,
    } as never);

    expect(result[0].deleted[0].status).toBe("deleted");
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
    // --force skips the ref-check scan entirely.
    expect(searchAllSpy).not.toHaveBeenCalled();
  });

  it("--skip-ref-check deletes without scanning for inbound refs", async () => {
    const client = setup({ items: mkItems([]) });
    const searchAllSpy = vi.fn().mockImplementation(async function* () {});
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(searchAllSpy);

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups: [mkGroup()],
      skipRefCheck: true,
      json: true,
      quiet: true,
    } as never);

    expect(result[0].deleted[0].status).toBe("deleted");
    expect(searchAllSpy).not.toHaveBeenCalled();
  });

  it("--what-if skips both the ref-check and the delete", async () => {
    const client = setup({ items: mkItems([]) });
    const searchAllSpy = vi.fn().mockImplementation(async function* () {});
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(searchAllSpy);

    const result = await runCleanupDuplicates({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      preComputedGroups: [mkGroup()],
      whatIf: true,
      json: true,
      quiet: true,
    } as never);

    expect(result[0].deleted[0].status).toBe("what-if");
    expect(client.deleteItem).not.toHaveBeenCalled();
    // What-if disables the ref-check (runRefCheck = false when whatIf).
    expect(searchAllSpy).not.toHaveBeenCalled();
  });
});

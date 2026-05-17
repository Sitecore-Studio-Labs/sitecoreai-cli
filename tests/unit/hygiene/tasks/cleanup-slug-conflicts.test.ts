import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupSlugConflicts } from "../../../../src/hygiene/tasks/cleanup/slug-conflicts";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
// Mock `runAuditReferences` so the ref-check tests stay focused on the
// slug-conflicts logic instead of recreating audit field-fetch fixtures.
// The mocked impl reads counts from a per-test Map keyed by itemId.
const refCountsByItemId = new Map<string, number>();
vi.mock("../../../../src/hygiene/tasks/audit/references", () => ({
  runAuditReferences: vi.fn(async (opts: { to?: string }) => {
    const flat = (opts.to ?? "").replace(/[-{}]/g, "").toLowerCase();
    const count = refCountsByItemId.get(flat) ?? 0;
    return Array.from({ length: count }, (_, i) => ({
      itemId: `referrer-${i}`,
      path: `/sitecore/content/Referrer/${i}`,
      templateName: "Page",
      language: "en",
      matches: [],
    }));
  }),
}));

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

// Build a sibling-pair under the same parent with the same name (case-insensitive).
// Each spec is a distinct itemId — that's the conflict signal.
const mkSiblings = (parentPath: string, name: string, ids: string[]) =>
  ids.map((id) => ({
    itemId: id,
    path: `${parentPath}/${name}`,
    name,
    language: { name: "en" },
    version: 1,
    templateName: "Page",
  }));

const setup = (opts: {
  items: ReturnType<typeof mkSiblings>;
  allowWrite?: boolean;
  rootItemId?: string;
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

  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: opts.rootItemId ?? "rootid", path: "/sitecore/content/Root" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of opts.items) yield it;
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockResolvedValue(new Map()),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    renameItem: vi.fn().mockResolvedValue(undefined),
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
    updateItemFields: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup slug-conflicts — keep-rule strategies", () => {
  it("oldest (itemId-stable): keeps the smallest itemId, deletes the rest", async () => {
    const items = mkSiblings("/sitecore/content/Root", "Page", ["bbb", "aaa", "ccc"]);
    const client = setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe("aaa");
    expect(result[0].resolved.map((r) => r.itemId).sort()).toEqual(["bbb", "ccc"]);
    expect(client.deleteItem).toHaveBeenCalledTimes(2);
  });

  it("newest (itemId-stable): keeps the largest itemId", async () => {
    const items = mkSiblings("/sitecore/content/Root", "Page", ["bbb", "ccc", "aaa"]);
    setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "newest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result[0].kept.itemId).toBe("ccc");
  });

  it("rejects interactive mode under --non-interactive", async () => {
    setup({ items: mkSiblings("/sitecore/content/Root", "X", ["a", "b"]) });
    await expect(
      runCleanupSlugConflicts({
        keepRule: "interactive",
        root: "/sitecore/content/Root",
        json: true,
        nonInteractive: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup slug-conflicts — action: rename", () => {
  it("renames losers with the default suffix template (-{shortId})", async () => {
    const items = mkSiblings("/sitecore/content/Root", "Page", [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // shortId aaaaaaaa
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", // shortId bbbbbbbb
    ]);
    const client = setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      action: "rename",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(client.renameItem).toHaveBeenCalledTimes(1);
    expect(result[0].resolved).toHaveLength(1);
    expect(result[0].resolved[0].action).toBe("rename");
    expect(result[0].resolved[0].newName).toBe("Page-bbbbbbbb");
    expect(result[0].resolved[0].status).toBe("applied");
  });

  it("honors a custom rename-suffix template", async () => {
    const items = mkSiblings("/sitecore/content/Root", "Page", [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
    const client = setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      action: "rename",
      renameSuffix: "_dup_{shortId}",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result[0].resolved[0].newName).toBe("Page_dup_bbbbbbbb");
    expect(client.renameItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Page_dup_bbbbbbbb" })
    );
  });
});

describe("cleanup slug-conflicts — what-if + safety", () => {
  it("--what-if reports the plan but does not delete or rename", async () => {
    const items = mkSiblings("/sitecore/content/Root", "Page", ["a", "b"]);
    const client = setup({ items, allowWrite: false });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      whatIf: true,
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].resolved.every((r) => r.status === "what-if")).toBe(true);
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(client.renameItem).not.toHaveBeenCalled();
  });

  it("does nothing when there are no conflicts (single sibling under a parent)", async () => {
    setup({ items: mkSiblings("/sitecore/content/Root", "Solo", ["only"]) });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(0);
  });
});

describe("cleanup slug-conflicts — --check-refs", () => {
  // Reset the per-test mock map so values don't leak between tests.
  const reset = () => refCountsByItemId.clear();

  it("preview (whatIf): attaches inboundRefs counts to each resolved row, never aborts", async () => {
    reset();
    const items = mkSiblings("/sitecore/content/Root", "Page", ["aaa", "bbb"]);
    // Loser "bbb" has 7 inbound refs; the survivor "aaa" is never scanned.
    refCountsByItemId.set("bbb", 7);
    const client = setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      checkRefs: true,
      whatIf: true,
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].kept.itemId).toBe("aaa");
    expect(result[0].resolved).toHaveLength(1);
    expect(result[0].resolved[0].itemId).toBe("bbb");
    expect(result[0].resolved[0].inboundRefs).toBe(7);
    expect(result[0].resolved[0].status).toBe("what-if");
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("apply: aborts INPUT_INVALID when any loser has positive count", async () => {
    reset();
    const items = mkSiblings("/sitecore/content/Root", "Page", ["aaa", "bbb", "ccc"]);
    refCountsByItemId.set("bbb", 3);
    refCountsByItemId.set("ccc", 0);
    const client = setup({ items });
    await expect(
      runCleanupSlugConflicts({
        keepRule: "oldest",
        checkRefs: true,
        root: "/sitecore/content/Root",
        json: true,
        quiet: true,
      } as never)
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("--check-refs gate"),
    });
    // Gate fires BEFORE any mutation runs.
    expect(client.deleteItem).not.toHaveBeenCalled();
    expect(client.renameItem).not.toHaveBeenCalled();
  });

  it("apply: proceeds with mutation when every loser has zero count", async () => {
    reset();
    const items = mkSiblings("/sitecore/content/Root", "Page", ["aaa", "bbb"]);
    refCountsByItemId.set("bbb", 0);
    const client = setup({ items });
    const result = await runCleanupSlugConflicts({
      keepRule: "oldest",
      checkRefs: true,
      root: "/sitecore/content/Root",
      json: true,
      quiet: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].resolved[0].status).toBe("applied");
    expect(result[0].resolved[0].inboundRefs).toBe(0);
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
  });
});

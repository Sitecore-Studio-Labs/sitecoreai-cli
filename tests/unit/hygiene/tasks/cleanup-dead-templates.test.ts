import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupDeadTemplates } from "../../../../src/hygiene/tasks/cleanup/dead-templates";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});
// The cleanup re-runs the audit to discover candidates; mock the audit so
// these tests stay focused on the cleanup logic.
vi.mock("../../../../src/hygiene/tasks/audit/dead-templates", () => ({
  runAuditDeadTemplates: vi.fn(),
}));

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditDeadTemplates } from "../../../../src/hygiene/tasks/audit/dead-templates";

const setup = (allowWrite = true): EnvironmentConfiguration => {
  const env = { name: "sandbox", host: "h", allowWrite } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const stub = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    // Default to an empty search result so the new `audit template-dependencies`
    // pre-flight in `cleanup-dead-templates` finds no blockers and existing
    // tests can stay focused on delete behavior. Tests that exercise the
    // blocker path override `search` with a populated result.
    search: vi.fn().mockResolvedValue({ results: [] }),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    deleteItemTemplate: vi.fn().mockResolvedValue(undefined),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn().mockResolvedValue([]),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
    deleteUser: vi.fn(),
    deleteRole: vi.fn(),
    executeWorkflowCommand: vi.fn(),
    getWorkflowCommandsForItem: vi.fn(),
  };
  const client = { ...base, ...overrides } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup dead-templates — safety rails", () => {
  it("refuses /sitecore/templates/System without --force", async () => {
    setup();
    stub({});
    await expect(
      runCleanupDeadTemplates({
        root: "/sitecore/templates/System",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("allows protected roots when --force is set", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    stub({});
    await expect(
      runCleanupDeadTemplates({
        root: "/sitecore/templates/System",
        force: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stub({});
    await expect(runCleanupDeadTemplates({ json: true } as never)).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("--what-if bypasses allowWrite enforcement", async () => {
    setup(false);
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    stub({});
    await expect(
      runCleanupDeadTemplates({ whatIf: true, json: true } as never)
    ).resolves.toBeDefined();
  });
});

describe("cleanup dead-templates — purge logic", () => {
  it("deletes every template the audit returns", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
      { templateId: "t2", name: "T2", fullName: "/sitecore/templates/Project/T2" },
    ] as never);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toHaveLength(2);
    expect(result.templates.every((t) => t.status === "purged")).toBe(true);
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(2);
  });

  it("--what-if reports the plan without calling deleteItemTemplate", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
    ] as never);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ whatIf: true, json: true } as never);

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].status).toBe("what-if");
    expect(client.deleteItemTemplate).not.toHaveBeenCalled();
  });

  it("captures per-template failures without aborting the run", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
      { templateId: "t2", name: "T2", fullName: null },
    ] as never);
    const client = stub({
      deleteItemTemplate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("still used as base template")),
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toHaveLength(2);
    expect(result.templates[0].status).toBe("purged");
    expect(result.templates[1].status).toBe("failed");
    expect(result.templates[1].error).toContain("still used");
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(2);
  });

  it("skips empty-folder cleanup when cleanupEmptyFolders=false", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const client = stub({
      getChildren: vi.fn(),
    });

    const result = await runCleanupDeadTemplates({
      json: true,
      cleanupEmptyFolders: false,
    } as never);

    expect(result.folders).toEqual([]);
    expect(client.getChildren).not.toHaveBeenCalled();
  });

  it("skips empty-folder cleanup entirely when no templates were purged", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([]);
    const client = stub({});

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toEqual([]);
    expect(result.folders).toEqual([]);
    expect(client.getChildren).not.toHaveBeenCalled();
  });
});

describe("cleanup dead-templates — pre-flight blocker check", () => {
  it("blocks delete when `audit template-dependencies` returns inbound refs", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t-blocked", name: "Blocked", fullName: "/sitecore/templates/Project/Blocked" },
    ] as never);
    // First search call (primary-template, EXACT) returns the inheritor;
    // subsequent kinds return empty. The pre-flight aggregates across kinds
    // and reports each blocker with its referenceKind.
    const client = stub({
      search: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              itemId: "inheritor-1",
              path: "/sitecore/templates/Project/Inheritor",
              name: "Inheritor",
              templateId: null,
              templateName: null,
            },
          ],
        })
        .mockResolvedValue({ results: [] }),
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].status).toBe("blocked");
    expect(result.templates[0].blockers).toHaveLength(1);
    expect(result.templates[0].blockers?.[0].referenceKind).toBe("primary-template");
    expect(client.deleteItemTemplate).not.toHaveBeenCalled();
  });

  it("--force bypasses the pre-flight and attempts the delete", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const searchSpy = vi.fn().mockResolvedValue({ results: [] });
    const client = stub({
      search: searchSpy,
    });

    const result = await runCleanupDeadTemplates({ force: true, json: true } as never);

    expect(result.templates[0].status).toBe("purged");
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(1);
    // The pre-flight is skipped entirely when --force is set; search must
    // not be invoked for the dependency check.
    expect(searchSpy).not.toHaveBeenCalled();
  });
});

describe("cleanup dead-templates — empty-folder cleanup walk", () => {
  it("deletes a folder that ends up empty after the purge", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
    ] as never);
    // The folder walk: root has one child folder which itself has no children.
    const client = stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].status).toBe("deleted");
    expect(result.folders[0].path).toBe("/sitecore/templates/Project/EmptyFolder");
    // deleteItem with permanently:true is called on the empty folder.
    expect(client.deleteItem).toHaveBeenCalledWith({
      itemId: "empty-folder",
      permanently: true,
    });
  });

  it("keeps a parent folder when a child folder's delete fails", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    // Root → OuterFolder → InnerFolder (empty). InnerFolder's delete
    // fails, so the walk reports OuterFolder as still-non-empty and
    // never attempts to delete it.
    const client = stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "outer-folder",
              name: "OuterFolder",
              path: "/sitecore/templates/Project/OuterFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        if (path === "/sitecore/templates/Project/OuterFolder") {
          return Promise.resolve([
            {
              itemId: "inner-folder",
              name: "InnerFolder",
              path: "/sitecore/templates/Project/OuterFolder/InnerFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
      deleteItem: vi.fn().mockImplementation(({ itemId }: { itemId: string }) => {
        if (itemId === "inner-folder") return Promise.reject(new Error("inner is locked"));
        return Promise.resolve(undefined);
      }),
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    // Only the failed inner-folder action is recorded; OuterFolder is
    // never deleted because its child did not end up empty.
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].itemId).toBe("inner-folder");
    expect(result.folders[0].status).toBe("failed");
    expect(client.deleteItem).toHaveBeenCalledTimes(1);
  });

  it("reports folder deletions as what-if without calling deleteItem", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const client = stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
    });

    const result = await runCleanupDeadTemplates({ whatIf: true, json: true } as never);

    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].status).toBe("what-if");
    expect(client.deleteItem).not.toHaveBeenCalled();
  });

  it("captures a folder-delete failure without aborting", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const client = stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
      deleteItem: vi.fn().mockRejectedValue(new Error("folder is locked")),
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.folders).toHaveLength(1);
    expect(result.folders[0].status).toBe("failed");
    expect(result.folders[0].error).toContain("folder is locked");
    expect(client.deleteItemTemplate).toHaveBeenCalledTimes(1);
  });

  it("deletes nested empty folders bottom-up", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const client = stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "outer",
              name: "Outer",
              path: "/sitecore/templates/Project/Outer",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        if (path === "/sitecore/templates/Project/Outer") {
          return Promise.resolve([
            {
              itemId: "inner",
              name: "Inner",
              path: "/sitecore/templates/Project/Outer/Inner",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        // Inner folder is empty.
        return Promise.resolve([]);
      }) as never,
    });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    // Inner deleted first, then Outer becomes empty and is deleted too.
    expect(result.folders.map((f) => f.path).sort()).toEqual([
      "/sitecore/templates/Project/Outer",
      "/sitecore/templates/Project/Outer/Inner",
    ]);
    expect(client.deleteItem).toHaveBeenCalledTimes(2);
  });
});

describe("cleanup dead-templates — template-cache lag retry", () => {
  it("retries a delete that 4xxes with a 'dependent' message and then succeeds", async () => {
    vi.useFakeTimers();
    try {
      setup();
      vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
        { templateId: "t1", name: "T1", fullName: null },
      ] as never);
      const deleteSpy = vi
        .fn()
        .mockRejectedValueOnce(new Error("template still has dependent items"))
        .mockResolvedValueOnce(undefined);
      stub({ deleteItemTemplate: deleteSpy });

      const promise = runCleanupDeadTemplates({ json: true } as never);
      // Advance past the first retry delay (4000ms) so the retry fires.
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.templates[0].status).toBe("purged");
      expect(deleteSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a non-lag delete error immediately without retrying", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    const deleteSpy = vi.fn().mockRejectedValue(new Error("permission denied"));
    stub({ deleteItemTemplate: deleteSpy });

    const result = await runCleanupDeadTemplates({ json: true } as never);

    expect(result.templates[0].status).toBe("failed");
    expect(result.templates[0].error).toContain("permission denied");
    // A non-transient error is surfaced on the first attempt — no retry.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting all retry attempts on a persistent lag error", async () => {
    vi.useFakeTimers();
    try {
      setup();
      vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
        { templateId: "t1", name: "T1", fullName: null },
      ] as never);
      const deleteSpy = vi.fn().mockRejectedValue(new Error("template is used by other items"));
      stub({ deleteItemTemplate: deleteSpy });

      const promise = runCleanupDeadTemplates({ json: true } as never);
      // 3 retry delays: 4s + 10s + 25s = 39s.
      await vi.advanceTimersByTimeAsync(40_000);
      const result = await promise;

      expect(result.templates[0].status).toBe("failed");
      // 1 initial attempt + 3 retries.
      expect(deleteSpy).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cleanup dead-templates — non-JSON report formatting", () => {
  const suppressStdout = () => vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  it("prints the what-if banner and plan summary in non-JSON mode", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
    ] as never);
    stub({});
    const writeSpy = suppressStdout();
    try {
      const result = await runCleanupDeadTemplates({ whatIf: true } as never);
      expect(result.templates[0].status).toBe("what-if");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("formats purged, failed, and folder lines in non-JSON mode", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: "/sitecore/templates/Project/T1" },
      { templateId: "t2", name: "T2", fullName: null },
    ] as never);
    const client = stub({
      deleteItemTemplate: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("base template in use")),
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
    });
    const writeSpy = suppressStdout();
    try {
      const result = await runCleanupDeadTemplates({});
      expect(result.templates[0].status).toBe("purged");
      expect(result.templates[1].status).toBe("failed");
      expect(result.folders[0].status).toBe("deleted");
      expect(client.deleteItemTemplate).toHaveBeenCalledTimes(2);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("formats blocked template lines with blocker detail in non-JSON mode", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t-blocked", name: "Blocked", fullName: "/sitecore/templates/Project/Blocked" },
    ] as never);
    const client = stub({
      search: vi
        .fn()
        .mockResolvedValueOnce({
          results: [
            {
              itemId: "inheritor-1",
              path: "/sitecore/templates/Project/Inheritor",
              name: "Inheritor",
              templateId: null,
              templateName: null,
            },
          ],
        })
        .mockResolvedValue({ results: [] }),
    });
    const writeSpy = suppressStdout();
    try {
      const result = await runCleanupDeadTemplates({});
      expect(result.templates[0].status).toBe("blocked");
      expect(client.deleteItemTemplate).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("formats what-if folder lines in non-JSON mode", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
    });
    const writeSpy = suppressStdout();
    try {
      const result = await runCleanupDeadTemplates({ whatIf: true });
      expect(result.folders[0].status).toBe("what-if");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("formats failed folder lines in non-JSON mode", async () => {
    setup();
    vi.mocked(runAuditDeadTemplates).mockResolvedValueOnce([
      { templateId: "t1", name: "T1", fullName: null },
    ] as never);
    stub({
      getChildren: vi.fn().mockImplementation(({ path }: { path?: string }) => {
        if (path === "/sitecore/templates/Project") {
          return Promise.resolve([
            {
              itemId: "empty-folder",
              name: "EmptyFolder",
              path: "/sitecore/templates/Project/EmptyFolder",
              templateId: null,
              templateName: "Template folder",
            },
          ]);
        }
        return Promise.resolve([]);
      }) as never,
      deleteItem: vi.fn().mockRejectedValue(new Error("folder locked")),
    });
    const writeSpy = suppressStdout();
    try {
      const result = await runCleanupDeadTemplates({});
      expect(result.folders[0].status).toBe("failed");
    } finally {
      writeSpy.mockRestore();
    }
  });
});

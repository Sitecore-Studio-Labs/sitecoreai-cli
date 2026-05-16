import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient, ItemVersion, SearchPage } from "../../../../src/hygiene/api/client";
import { runCleanupVersionsArchive } from "../../../../src/hygiene/tasks/cleanup/versions-archive";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (allowWrite = true) => {
  const env = { name: "sandbox", host: "h", allowWrite } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

const stub = (overrides: Partial<HygieneApiClient>): HygieneApiClient => {
  const base = {
    search: vi.fn().mockResolvedValue({ totalCount: 0, results: [] } as SearchPage),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn().mockResolvedValue([]),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn().mockResolvedValue({ archiveVersionId: "av-1" }),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
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

const buildVersions = (count: number, lang = "en"): ItemVersion[] =>
  Array.from({ length: count }, (_, i) => ({
    itemId: "item-1",
    version: i + 1,
    versionName: null,
    language: { name: lang },
  }));

describe("cleanup versions archive — safety rails", () => {
  it("rejects missing --root", async () => {
    setup();
    stub({});
    await expect(
      runCleanupVersionsArchive({ keep: 1, root: "", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects --keep < 1", async () => {
    setup();
    stub({});
    await expect(
      runCleanupVersionsArchive({
        keep: 0,
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("refuses protected roots without --force", async () => {
    setup();
    stub({});
    await expect(
      runCleanupVersionsArchive({
        keep: 1,
        root: "/sitecore/system",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite outside --what-if", async () => {
    setup(false);
    stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
    });
    await expect(
      runCleanupVersionsArchive({
        keep: 1,
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects unknown --root (search returns zero results)", async () => {
    setup();
    stub({
      search: vi.fn().mockResolvedValue({ totalCount: 0, results: [] }),
    });
    await expect(
      runCleanupVersionsArchive({
        keep: 1,
        root: "/sitecore/content/Missing",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup versions archive — archive logic", () => {
  it("archives oldest versions via archiveVersion (not delete)", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "item-1",
          path: "/sitecore/content/MySite/Page",
          name: "Page",
          language: { name: "en" },
          version: 5,
        };
      }),
      getItemVersions: vi.fn().mockResolvedValue(buildVersions(4)),
    });

    const result = await runCleanupVersionsArchive({
      keep: 2,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].archivedVersions).toEqual([2, 1]);
    expect(result[0].versionsAfter).toBe(2);
    expect(client.archiveVersion).toHaveBeenCalledTimes(2);
    expect(client.deleteItemVersion).not.toHaveBeenCalled();
  });

  it("forwards --archive-name to archiveVersion", async () => {
    setup();
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "item-1",
          path: "/sitecore/content/MySite/Page",
          name: "Page",
          language: { name: "en" },
          version: 3,
        };
      }),
      getItemVersions: vi.fn().mockResolvedValue(buildVersions(3)),
    });

    await runCleanupVersionsArchive({
      keep: 1,
      root: "/sitecore/content/MySite",
      archiveName: "cli-driven",
      json: true,
    } as never);

    const calls = (client.archiveVersion as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].archiveName).toBe("cli-driven");
  });

  it("--what-if reports the plan without calling archiveVersion", async () => {
    setup(false);
    const client = stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "item-1",
          path: "/sitecore/content/MySite/Page",
          name: "Page",
          language: { name: "en" },
          version: 3,
        };
      }),
      getItemVersions: vi.fn().mockResolvedValue(buildVersions(3)),
    });

    const result = await runCleanupVersionsArchive({
      keep: 1,
      root: "/sitecore/content/MySite",
      whatIf: true,
      json: true,
    } as never);

    expect(result[0].archivedVersions).toEqual([2, 1]);
    expect(client.archiveVersion).not.toHaveBeenCalled();
  });

  it("collects per-version errors without aborting the run", async () => {
    setup();
    stub({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "item-1",
          path: "/sitecore/content/MySite/Page",
          name: "Page",
          language: { name: "en" },
          version: 1,
        };
      }),
      getItemVersions: vi.fn().mockResolvedValue(buildVersions(3)),
      archiveVersion: vi
        .fn()
        .mockResolvedValueOnce({ archiveVersionId: "av-1" })
        .mockRejectedValueOnce(new Error("archive bucket locked")),
    });

    const result = await runCleanupVersionsArchive({
      keep: 1,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result[0].archivedVersions).toEqual([2]);
    expect(result[0].errors[0]).toContain("archive bucket locked");
  });
});

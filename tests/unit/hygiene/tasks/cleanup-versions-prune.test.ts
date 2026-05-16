import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient, SearchPage, ItemVersion } from "../../../../src/hygiene/api/client";
import { runCleanupVersionsPrune } from "../../../../src/hygiene/tasks/cleanup/versions-prune";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const resolveEnvironmentMock = vi.mocked(resolveEnvironment);
const createHygieneApiClientMock = vi.mocked(createHygieneApiClient);

const mkEnv = (allowWrite = false): EnvironmentConfiguration =>
  ({
    name: "sandbox",
    host: "test.sitecorecloud.io",
    allowWrite,
  }) as EnvironmentConfiguration;

const mkRoot = (env: EnvironmentConfiguration): RootConfiguration =>
  ({
    physicalPath: "/tmp/sitecoreai.cli.json",
    environments: { [env.name]: env },
  }) as unknown as RootConfiguration;

const mkClient = (overrides: Partial<HygieneApiClient> = {}): HygieneApiClient =>
  ({
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
    ...overrides,
  }) as HygieneApiClient;

const setup = (overrides: { allowWrite?: boolean; client?: HygieneApiClient } = {}) => {
  const env = mkEnv(overrides.allowWrite);
  const root = mkRoot(env);
  resolveEnvironmentMock.mockReturnValue({
    envName: env.name!,
    environment: env,
    root,
    timeoutMs: undefined,
  });
  const client = overrides.client ?? mkClient();
  createHygieneApiClientMock.mockReturnValue(client);
  return { env, root, client };
};

describe("cleanup versions prune — safety rails", () => {
  it("rejects missing --root with INPUT_INVALID", async () => {
    setup();
    await expect(
      runCleanupVersionsPrune({ keep: 1, root: "", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects --keep < 1", async () => {
    setup();
    await expect(
      runCleanupVersionsPrune({
        keep: 0,
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("refuses protected paths without --force", async () => {
    setup();
    await expect(
      runCleanupVersionsPrune({
        keep: 1,
        root: "/sitecore/system",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("allows protected paths when --force is set (still requires --allow-write to mutate)", async () => {
    const { client } = setup({ allowWrite: true });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "root", path: "/sitecore/system" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      // empty — no items to process
    });
    await expect(
      runCleanupVersionsPrune({
        keep: 1,
        root: "/sitecore/system",
        force: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("requires allowWrite (env or --allow-write) when not --what-if", async () => {
    const { client } = setup({ allowWrite: false });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "root", path: "/sitecore/content/MySite" }],
    });
    await expect(
      runCleanupVersionsPrune({
        keep: 1,
        root: "/sitecore/content/MySite",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("--what-if bypasses allowWrite enforcement", async () => {
    const { client } = setup({ allowWrite: false });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {});
    await expect(
      runCleanupVersionsPrune({
        keep: 1,
        root: "/sitecore/content/MySite",
        whatIf: true,
        json: true,
      } as never)
    ).resolves.toBeDefined();
  });

  it("rejects unknown --root (search resolves to zero results)", async () => {
    const { client } = setup({ allowWrite: true });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 0,
      results: [],
    });
    await expect(
      runCleanupVersionsPrune({
        keep: 1,
        root: "/sitecore/content/Nonexistent",
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup versions prune — pruning logic", () => {
  const buildVersions = (count: number, lang = "en"): ItemVersion[] =>
    Array.from({ length: count }, (_, i) => ({
      itemId: "item-1",
      version: i + 1,
      versionName: null,
      language: { name: lang },
    }));

  it("deletes oldest versions, keeping the top N most recent", async () => {
    const { client } = setup({ allowWrite: true });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield {
        itemId: "item-1",
        path: "/sitecore/content/MySite/Page",
        name: "Page",
        language: { name: "en" },
        version: 5,
      };
    });
    (client.getItemVersions as ReturnType<typeof vi.fn>).mockResolvedValue(buildVersions(5));
    (client.deleteItemVersion as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await runCleanupVersionsPrune({
      keep: 2,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].versionsBefore).toBe(5);
    expect(result[0].versionsAfter).toBe(2);
    expect(result[0].deletedVersions).toEqual([3, 2, 1]); // sorted desc → drop oldest
    // 5 versions, keep 2 → delete 3 (versions 1, 2, 3 — the oldest)
    expect(client.deleteItemVersion).toHaveBeenCalledTimes(3);
  });

  it("does nothing for items where versions <= keep", async () => {
    const { client } = setup({ allowWrite: true });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield {
        itemId: "item-1",
        path: "/sitecore/content/MySite/Page",
        name: "Page",
        language: { name: "en" },
        version: 1,
      };
    });
    (client.getItemVersions as ReturnType<typeof vi.fn>).mockResolvedValue(buildVersions(2));

    const result = await runCleanupVersionsPrune({
      keep: 3,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(0);
    expect(client.deleteItemVersion).not.toHaveBeenCalled();
  });

  it("--what-if reports the plan without calling deleteItemVersion", async () => {
    const { client } = setup({ allowWrite: false });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield {
        itemId: "item-1",
        path: "/sitecore/content/MySite/Page",
        name: "Page",
        language: { name: "en" },
        version: 3,
      };
    });
    (client.getItemVersions as ReturnType<typeof vi.fn>).mockResolvedValue(buildVersions(3));

    const result = await runCleanupVersionsPrune({
      keep: 1,
      root: "/sitecore/content/MySite",
      whatIf: true,
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].deletedVersions).toEqual([2, 1]);
    expect(client.deleteItemVersion).not.toHaveBeenCalled();
  });

  it("collects errors per item without aborting the run", async () => {
    const { client } = setup({ allowWrite: true });
    (client.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/MySite" }],
    });
    (client.searchAll as ReturnType<typeof vi.fn>).mockImplementation(async function* () {
      yield {
        itemId: "item-1",
        path: "/sitecore/content/MySite/Page",
        name: "Page",
        language: { name: "en" },
        version: 1,
      };
    });
    (client.getItemVersions as ReturnType<typeof vi.fn>).mockResolvedValue(buildVersions(3));
    (client.deleteItemVersion as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("transient failure"));

    const result = await runCleanupVersionsPrune({
      keep: 1,
      root: "/sitecore/content/MySite",
      json: true,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0].deletedVersions).toEqual([2]);
    expect(result[0].errors[0]).toContain("transient failure");
  });
});

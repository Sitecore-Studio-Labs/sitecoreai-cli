import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupArchivePurge } from "../../../../src/hygiene/tasks/cleanup/archive-purge";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (overrides: { allowWrite?: boolean; client?: Partial<HygieneApiClient> } = {}) => {
  const env = {
    name: "sandbox",
    host: "h",
    allowWrite: overrides.allowWrite ?? false,
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const client = {
    listArchivedItems: vi.fn().mockResolvedValue([]),
    deleteArchivedItem: vi.fn().mockResolvedValue(undefined),
    search: vi.fn(),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    ...overrides.client,
  } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("cleanup archive purge — safety rails", () => {
  it("rejects --older-than-days < 0", async () => {
    setup();
    await expect(
      runCleanupArchivePurge({ olderThanDays: -1, json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires allowWrite (env or --allow-write) when not --what-if", async () => {
    setup({
      allowWrite: false,
      client: {
        listArchivedItems: vi.fn().mockResolvedValue([
          {
            archivalId: "a1",
            itemId: "i1",
            name: "x",
            originalLocation: "/x",
            archivedBy: null,
            archivedDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            parentId: null,
          },
        ]),
      },
    });
    await expect(
      runCleanupArchivePurge({ olderThanDays: 30, json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup archive purge — what-if mode", () => {
  it("reports plan but does not call deleteArchivedItem", async () => {
    const client = setup({
      allowWrite: false,
      client: {
        listArchivedItems: vi.fn().mockResolvedValue([
          {
            archivalId: "a1",
            itemId: "i1",
            name: "Old",
            originalLocation: "/x",
            archivedBy: null,
            archivedDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            parentId: null,
          },
        ]),
        deleteArchivedItem: vi.fn(),
      },
    });
    const result = await runCleanupArchivePurge({
      olderThanDays: 30,
      whatIf: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("what-if");
    expect(client.deleteArchivedItem).not.toHaveBeenCalled();
  });
});

describe("cleanup archive purge — pruning logic", () => {
  it("skips items younger than the threshold", async () => {
    const client = setup({
      allowWrite: true,
      client: {
        listArchivedItems: vi.fn().mockResolvedValue([
          {
            archivalId: "a1",
            itemId: "i1",
            name: "Young",
            originalLocation: "/x",
            archivedBy: null,
            archivedDate: new Date().toISOString(), // today — younger than 30 days
            parentId: null,
          },
        ]),
        deleteArchivedItem: vi.fn().mockResolvedValue(undefined),
      },
    });
    const result = await runCleanupArchivePurge({
      olderThanDays: 30,
      json: true,
    } as never);
    expect(result).toHaveLength(0);
    expect(client.deleteArchivedItem).not.toHaveBeenCalled();
  });

  it("captures errors per record without aborting", async () => {
    setup({
      allowWrite: true,
      client: {
        listArchivedItems: vi.fn().mockResolvedValue([
          {
            archivalId: "a1",
            itemId: "i1",
            name: "A",
            originalLocation: "/x",
            archivedDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            archivedBy: null,
            parentId: null,
          },
          {
            archivalId: "a2",
            itemId: "i2",
            name: "B",
            originalLocation: "/y",
            archivedDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            archivedBy: null,
            parentId: null,
          },
        ]),
        deleteArchivedItem: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("transient")),
      },
    });
    const result = await runCleanupArchivePurge({
      olderThanDays: 30,
      json: true,
    } as never);
    expect(result).toHaveLength(2);
    const statuses = result.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "purged"]);
  });
});

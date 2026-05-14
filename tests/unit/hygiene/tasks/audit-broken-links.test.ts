import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditBrokenLinks } from "../../../../src/hygiene/tasks/audit-broken-links";

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

const setup = (client: Partial<HygieneApiClient>): HygieneApiClient => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  resolveEnvironmentMock.mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fullClient = {
    search: vi.fn().mockResolvedValue({ totalCount: 0, results: [] }),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockResolvedValue(new Map()),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn().mockResolvedValue(new Map()),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    ...client,
  } as HygieneApiClient;
  createHygieneApiClientMock.mockReturnValue(fullClient);
  return fullClient;
};

describe("audit broken-links — report shape", () => {
  it("returns empty report when no items reference missing items", async () => {
    setup({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content" }],
      }) as never,
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "item-a",
          path: "/sitecore/content/A",
          name: "A",
        };
      }) as never,
      getItemFieldsBatch: vi
        .fn()
        .mockResolvedValue(
          new Map([["item-a", [{ fieldId: "f1", name: "Title", value: "plain text, no refs" }]]])
        ) as never,
    });

    const reports = await runAuditBrokenLinks({ json: true, root: "/sitecore/content" });
    expect(reports).toEqual([]);
  });

  it("reports items with refs that resolve as missing", async () => {
    setup({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content" }],
      }) as never,
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "abcdef1234567890abcdef1234567890",
          path: "/sitecore/content/A",
          name: "A",
          templateName: "Page",
          language: { name: "en" },
        };
      }) as never,
      getItemFieldsBatch: vi.fn().mockResolvedValue(
        new Map([
          [
            "abcdef1234567890abcdef1234567890",
            [
              {
                fieldId: "f1",
                name: "RelatedItem",
                // Pipe-delimited Multilist with one ref that won't exist.
                value: "{11111111-1111-1111-1111-111111111111}",
              },
            ],
          ],
        ])
      ) as never,
      itemsExistBatch: vi
        .fn()
        .mockResolvedValue(new Map([["11111111111111111111111111111111", false]])) as never,
    });

    const reports = await runAuditBrokenLinks({ json: true, root: "/sitecore/content" });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: "abcdef1234567890abcdef1234567890",
      path: "/sitecore/content/A",
      brokenRefs: [{ fieldName: "RelatedItem", refItemId: "11111111111111111111111111111111" }],
    });
  });

  it("skips Sitecore system fields (e.g. __Renderings) by default", async () => {
    setup({
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content" }],
      }) as never,
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "abcdef1234567890abcdef1234567890",
          path: "/sitecore/content/A",
          name: "A",
        };
      }) as never,
      getItemFieldsBatch: vi.fn().mockResolvedValue(
        new Map([
          [
            "abcdef1234567890abcdef1234567890",
            [
              {
                fieldId: "f1",
                name: "__Renderings",
                value: "{11111111-1111-1111-1111-111111111111}",
              },
            ],
          ],
        ])
      ) as never,
      itemsExistBatch: vi.fn().mockResolvedValue(new Map()) as never,
    });

    const reports = await runAuditBrokenLinks({ json: true, root: "/sitecore/content" });
    expect(reports).toEqual([]);
  });

  it("excludes /sitecore/system items by default but includes when --include-system", async () => {
    const fakeClient = {
      systemItem: {
        itemId: "sysitem",
        path: "/sitecore/system/Settings",
        name: "Settings",
      },
    };

    setup({
      search: vi.fn().mockResolvedValue({
        totalCount: 0,
        results: [],
      }) as never,
      searchAll: vi.fn().mockImplementation(async function* () {
        yield fakeClient.systemItem;
      }) as never,
      getItemFieldsBatch: vi.fn().mockResolvedValue(new Map()) as never,
      itemsExistBatch: vi.fn().mockResolvedValue(new Map()) as never,
    });

    const reports = await runAuditBrokenLinks({ json: true });
    expect(reports).toEqual([]);
  });
});

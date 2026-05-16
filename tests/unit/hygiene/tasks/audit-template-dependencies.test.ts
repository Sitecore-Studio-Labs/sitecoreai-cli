import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditTemplateDependencies } from "../../../../src/hygiene/tasks/audit/template-dependencies";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const TEMPLATE_GUID = "{abc12345-0000-0000-0000-000000000001}";
const TEMPLATE_NORM = "abc12345000000000000000000000001";

const setup = (
  search: (call: { field: string; value: string }) => {
    totalCount: number;
    results: Array<{
      itemId: string;
      path: string;
      name: string;
      templateId?: string;
      templateName?: string;
    }>;
  }
): HygieneApiClient => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const client = {
    search: vi
      .fn()
      .mockImplementation(
        (q: Parameters<HygieneApiClient["search"]>[0]): ReturnType<HygieneApiClient["search"]> => {
          const c = q.searchStatement?.criteria;
          if (!c) return Promise.resolve({ totalCount: 0, results: [] });
          return Promise.resolve(search({ field: c.field, value: c.value }));
        }
      ),
    searchAll: vi.fn(),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn(),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
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

describe("audit template-dependencies", () => {
  it("throws when --template-id is missing", async () => {
    setup(() => ({ totalCount: 0, results: [] }));
    await expect(runAuditTemplateDependencies({ json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("queries all reference kinds with normalized id", async () => {
    const fieldsSeen: string[] = [];
    const client = setup((call) => {
      fieldsSeen.push(call.field);
      expect(call.value).toBe(TEMPLATE_NORM);
      return { totalCount: 0, results: [] };
    });

    await runAuditTemplateDependencies({ templateId: TEMPLATE_GUID, json: true });

    expect(client.search).toHaveBeenCalledTimes(5);
    expect(fieldsSeen.sort()).toEqual([
      "__masters",
      "__source",
      "_basetemplates",
      "_template",
      "datasource template",
    ]);
  });

  it("labels each result with the originating reference kind", async () => {
    setup((call) => {
      if (call.field === "_template") {
        return {
          totalCount: 1,
          results: [{ itemId: "i1", path: "/sitecore/content/A", name: "A" }],
        };
      }
      if (call.field === "_basetemplates") {
        return {
          totalCount: 1,
          results: [{ itemId: "t1", path: "/sitecore/templates/B", name: "B" }],
        };
      }
      if (call.field === "__masters") {
        return {
          totalCount: 1,
          results: [
            {
              itemId: "sv1",
              path: "/sitecore/templates/Foo/__Standard Values",
              name: "__Standard Values",
            },
          ],
        };
      }
      if (call.field === "__source") {
        return {
          totalCount: 1,
          results: [{ itemId: "br1", path: "/sitecore/templates/Branches/Bar", name: "Bar" }],
        };
      }
      if (call.field === "datasource template") {
        return {
          totalCount: 1,
          results: [
            {
              itemId: "rd1",
              path: "/sitecore/layout/Renderings/Project/MyRendering",
              name: "MyRendering",
            },
          ],
        };
      }
      return { totalCount: 0, results: [] };
    });

    const reports = await runAuditTemplateDependencies({
      templateId: TEMPLATE_GUID,
      json: true,
    });

    expect(reports).toHaveLength(5);
    const byKind = new Map(reports.map((r) => [r.referenceKind, r]));
    expect(byKind.get("primary-template")?.path).toBe("/sitecore/content/A");
    expect(byKind.get("base-template")?.path).toBe("/sitecore/templates/B");
    expect(byKind.get("insert-options")?.path).toBe("/sitecore/templates/Foo/__Standard Values");
    expect(byKind.get("branch-source")?.path).toBe("/sitecore/templates/Branches/Bar");
    expect(byKind.get("datasource-template")?.path).toBe(
      "/sitecore/layout/Renderings/Project/MyRendering"
    );
  });

  it("respects --skip to drop a reference kind", async () => {
    const client = setup(() => ({ totalCount: 0, results: [] }));

    await runAuditTemplateDependencies({
      templateId: TEMPLATE_GUID,
      skip: ["branch-source"],
      json: true,
    });

    expect(client.search).toHaveBeenCalledTimes(4);
    const fieldsCalled = (client.search as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0].searchStatement.criteria.field
    );
    expect(fieldsCalled).not.toContain("__source");
  });

  it("caps total reports per kind at --limit", async () => {
    setup((call) => {
      if (call.field !== "_template") return { totalCount: 0, results: [] };
      // Return a full page of 100 every time the caller asks — should
      // stop after limit results, not loop forever.
      return {
        totalCount: 999,
        results: Array.from({ length: 100 }, (_, i) => ({
          itemId: `i${i}`,
          path: `/p/${i}`,
          name: `n${i}`,
        })),
      };
    });

    const reports = await runAuditTemplateDependencies({
      templateId: TEMPLATE_GUID,
      limit: 150,
      json: true,
    });

    // 150 cap for primary-template; other kinds return empty.
    expect(reports.length).toBe(150);
    expect(reports.every((r) => r.referenceKind === "primary-template")).toBe(true);
  });
});

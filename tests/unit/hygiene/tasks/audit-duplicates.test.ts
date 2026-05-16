/**
 * Coverage for the tightened grouping key on `audit duplicates`.
 *
 * Pre-2026 the key was contentHash only — items with all-empty fields
 * collapsed to the same hash and got reported as duplicates regardless
 * of template or parent. Default now widens to
 * (contentHash, templateId, parentPath); pass groupBy: ["contentHash"]
 * to opt into the looser legacy key (cross-template / cross-parent
 * deduplication).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditDuplicates } from "../../../../src/hygiene/tasks/audit/duplicates";

type ItemSpec = {
  id: string;
  path: string;
  templateId: string | null;
  templateName: string | null;
  fields: Array<{ name: string; value: string }>;
};

const setup = (items: ItemSpec[]) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map<string, Array<{ fieldId: string; name: string; value: string }>>();
  for (const it of items) {
    fieldsMap.set(
      it.id,
      it.fields.map((f, i) => ({ fieldId: `f${i}`, ...f }))
    );
  }
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content/Root" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of items) {
        yield {
          itemId: it.id,
          path: it.path,
          name: it.path.split("/").pop(),
          templateName: it.templateName,
          templateId: it.templateId,
          language: { name: "en" },
          version: 1,
          createdDate: "2026-01-01T00:00:00Z",
          updatedDate: "2026-01-02T00:00:00Z",
        };
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
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
    listUsers: vi.fn(),
    listRoles: vi.fn(),
    getUserDetail: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("audit duplicates — grouping key", () => {
  it("default key splits across different templates even when content hashes match", async () => {
    setup([
      {
        id: "a",
        path: "/sitecore/content/Root/PageItem",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
      {
        id: "b",
        path: "/sitecore/content/Root/FolderItem",
        templateId: "tmpl-folder",
        templateName: "Folder",
        fields: [{ name: "Title", value: "Hello" }],
      },
    ]);
    const result = await runAuditDuplicates({ json: true } as never);
    // Different templates → different groups. Each group has 1 member
    // so neither passes minGroupSize=2 → no duplicates reported.
    expect(result).toHaveLength(0);
  });

  it("groups across templates when groupBy is reduced to contentHash", async () => {
    setup([
      {
        id: "a",
        path: "/sitecore/content/Root/PageItem",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
      {
        id: "b",
        path: "/sitecore/content/Root/FolderItem",
        templateId: "tmpl-folder",
        templateName: "Folder",
        fields: [{ name: "Title", value: "Hello" }],
      },
    ]);
    const result = await runAuditDuplicates({
      json: true,
      groupBy: ["contentHash"],
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it("default key splits across different parents within the same template", async () => {
    setup([
      {
        id: "a",
        path: "/sitecore/content/Root/SectionA/Page",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
      {
        id: "b",
        path: "/sitecore/content/Root/SectionB/Page",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
    ]);
    const result = await runAuditDuplicates({ json: true } as never);
    expect(result).toHaveLength(0);
  });

  it("groups within the same template + parent", async () => {
    setup([
      {
        id: "a",
        path: "/sitecore/content/Root/Section/PageA",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
      {
        id: "b",
        path: "/sitecore/content/Root/Section/PageB",
        templateId: "tmpl-page",
        templateName: "Page",
        fields: [{ name: "Title", value: "Hello" }],
      },
    ]);
    const result = await runAuditDuplicates({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: "tmpl-page",
      parentPath: "/sitecore/content/Root/Section",
      count: 2,
    });
  });
});

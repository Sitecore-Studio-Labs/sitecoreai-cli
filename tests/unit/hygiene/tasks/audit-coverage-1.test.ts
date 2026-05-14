import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditAltTextMissing } from "../../../../src/hygiene/tasks/audit-alt-text-missing";
import { runAuditLargeFields } from "../../../../src/hygiene/tasks/audit-large-fields";
import { runAuditMissingMeta } from "../../../../src/hygiene/tasks/audit-missing-meta";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (
  items: Array<{
    id: string;
    fields: Array<{ name: string; value: string }>;
    templateName?: string;
  }>
) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map(
    items.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of items) {
        yield {
          itemId: it.id,
          path: `/sitecore/content/${it.id}`,
          name: it.id,
          templateName: it.templateName ?? "Page",
          language: { name: "en" },
          version: 1,
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
  } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit large-fields", () => {
  it("flags items with fields >= threshold (default 100KB)", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: "x".repeat(150_000) }] },
      { id: "b", fields: [{ name: "Body", value: "small" }] },
    ]);
    const result = await runAuditLargeFields({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].largeFields[0].size).toBeGreaterThan(100_000);
  });

  it("respects --threshold", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: "x".repeat(50_000) }] }]);
    const result = await runAuditLargeFields({ threshold: 10_000, json: true } as never);
    expect(result).toHaveLength(1);
  });

  it("excludes __-prefixed fields by default", async () => {
    setup([{ id: "a", fields: [{ name: "__Source", value: "x".repeat(150_000) }] }]);
    const result = await runAuditLargeFields({ json: true } as never);
    expect(result).toHaveLength(0);
  });

  it("sorts by total bloat descending", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: "x".repeat(110_000) }] },
      { id: "b", fields: [{ name: "Body", value: "x".repeat(200_000) }] },
    ]);
    const result = await runAuditLargeFields({ json: true } as never);
    expect(result).toHaveLength(2);
    expect(result[0].path).toContain("/b");
  });
});

describe("audit missing-meta", () => {
  it("reports items whose template defines a required field but leaves it empty", async () => {
    setup([
      {
        id: "a",
        fields: [
          { name: "Title", value: "Hello" },
          { name: "Description", value: "" }, // present on item, empty value
        ],
      },
      {
        id: "b",
        fields: [
          { name: "Title", value: "Hello" },
          { name: "Description", value: "..." },
        ],
      },
    ]);
    const result = await runAuditMissingMeta({
      requiredFields: ["title", "description"],
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].path).toContain("/a");
    expect(result[0].missingFields).toEqual(["description"]);
  });

  it("auto-skips items whose template doesn't define the required field at all", async () => {
    // Before the auto-skip, this audit fired on every item in a tenant
    // whose content model doesn't include the SEO field set (e.g. an
    // internal-tools tenant). The fix: report only fields that exist on
    // the item's template but are empty — absence is a content-model
    // property, not a content-quality issue.
    setup([
      { id: "a", fields: [{ name: "Title", value: "Hello" }] },
      { id: "b", fields: [{ name: "Title", value: "World" }] },
    ]);
    const result = await runAuditMissingMeta({
      requiredFields: ["meta-title", "meta-description"],
      json: true,
    } as never);
    expect(result).toHaveLength(0);
  });

  it("matches hyphenated and spaced variants", async () => {
    setup([{ id: "a", fields: [{ name: "Meta Description", value: "hello" }] }]);
    const result = await runAuditMissingMeta({
      requiredFields: ["meta-description"],
      json: true,
    } as never);
    expect(result).toHaveLength(0);
  });

  it("scopes by --template-pattern", async () => {
    setup([
      { id: "a", templateName: "Page", fields: [{ name: "Title", value: "" }] },
      { id: "b", templateName: "Datasource", fields: [{ name: "Title", value: "" }] },
    ]);
    const result = await runAuditMissingMeta({
      requiredFields: ["title"],
      templatePattern: "Page",
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].path).toContain("/a");
  });
});

describe("audit alt-text-missing", () => {
  it('flags Image-field values with alt=""', async () => {
    setup([
      {
        id: "a",
        fields: [
          {
            name: "Banner",
            value: '<image mediaid="{abc-def-12345-67890-abcdef123456}" alt="" />',
          },
        ],
      },
    ]);
    const result = await runAuditAltTextMissing({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].imageFields[0].fieldName).toBe("Banner");
  });

  it("flags Image fields with missing alt attribute entirely", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Banner", value: '<image mediaid="{x}" />' }],
      },
    ]);
    const result = await runAuditAltTextMissing({ json: true } as never);
    expect(result).toHaveLength(1);
  });

  it("does not flag Image fields with non-empty alt", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Banner", value: '<image mediaid="{x}" alt="A nice picture" />' }],
      },
    ]);
    const result = await runAuditAltTextMissing({ json: true } as never);
    expect(result).toHaveLength(0);
  });
});

/**
 * `scai hygiene audit personalization-broken list` — parses rendering
 * XML for personalization rule/variant refs and reports those whose
 * target items don't exist.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditPersonalizationBroken } from "../../../../src/hygiene/tasks/audit/personalization-broken";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (
  items: Array<{ id: string; fields: Array<{ name: string; value: string }> }>,
  idExists: Record<string, boolean> = {}
): HygieneApiClient => {
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
          templateName: "Page",
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
    itemsExistBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, idExists[id] ?? true);
      return Promise.resolve(m);
    }),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const VARIANT = "{abc12345-0000-0000-0000-0000000000aa}";
// Normalized (search-index) form: lowercase, no braces, no dashes.
const flat = (g: string): string => g.toLowerCase().replace(/[{}-]/g, "");
const VARIANT_NORM = flat(VARIANT);

describe("audit personalization-broken — report shape", () => {
  it("returns an empty report when no rendering fields carry personalization", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: "plain text" }] }]);
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toEqual([]);
  });

  it("flags an item whose personalization action targets a missing item", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "__Final Renderings",
              value: `<r><rules><rule><actions><action id="x" datasource="${VARIANT}" /></actions></rule></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: false }
    );
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: "a",
      brokenRefs: [{ fieldName: "__Final Renderings", refItemId: VARIANT_NORM }],
    });
  });

  it("does not flag a personalization ref whose target exists", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value: `<r><rules><rule><actions><action datasource="${VARIANT}" /></actions></rule></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: true }
    );
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toEqual([]);
  });

  it("captures rule-set refs from s:set attributes", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value: `<r><rules s:set="${VARIANT}"></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: false }
    );
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenRefs[0].refItemId).toBe(VARIANT_NORM);
  });

  it("ignores non-rendering fields even with personalization-shaped XML", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "Body",
              value: `<r><rules s:set="${VARIANT}"></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: false }
    );
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toEqual([]);
  });

  it("de-duplicates a repeated broken ref within one item", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value: `<r><rules s:set="${VARIANT}"><rule><actions><action datasource="${VARIANT}" /></actions></rule></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: false }
    );
    const reports = await runAuditPersonalizationBroken({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenRefs).toHaveLength(1);
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup(
      [
        {
          id: "a",
          fields: [
            {
              name: "__Renderings",
              value: `<r><rules s:set="${VARIANT}"></rules></r>`,
            },
          ],
        },
      ],
      { [VARIANT_NORM]: false }
    );
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    await runAuditPersonalizationBroken({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.personalization-broken.list");
    expect(parsed.count).toBe(1);
  });
});

describe("audit personalization-broken — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("boom"), { code: "CONFIG_INVALID" });
    });
    await expect(runAuditPersonalizationBroken({ json: true })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });
});

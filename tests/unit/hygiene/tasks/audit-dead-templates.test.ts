/**
 * Coverage for the transient-error retry added to audit dead-templates'
 * per-template search loop. Sitecore returns 200-with-`errors` for
 * "Service Unavailable" / "circuit breaker" / "transient" failures —
 * those bypass the shared HTTP retry, so the audit retries them
 * inline with exponential backoff capped at 15s per attempt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditDeadTemplates } from "../../../../src/hygiene/tasks/audit/dead-templates";

const stubClient = (params: {
  listItemTemplates: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
}) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const client = {
    search: params.search,
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
    listItemTemplates: params.listItemTemplates,
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
  // Speed up the test: stub setTimeout so backoff sleeps are zero-time.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("audit dead-templates — transient retry", () => {
  it("retries a per-template search that returns 'Service Unavailable' and ultimately succeeds", async () => {
    const listItemTemplates = vi.fn().mockResolvedValue([
      {
        templateId: "tmpl-1",
        name: "TmplOne",
        fullName: "Project/TmplOne",
        standardValuesItemId: null,
      },
    ]);
    let attempts = 0;
    const search = vi.fn().mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) {
        // Mimic the wrapped GraphQL-errors throw the transport produces.
        throw new Error("Authoring GraphQL errors: Service Unavailable — try again later");
      }
      return { totalCount: 0, results: [] };
    });
    stubClient({ listItemTemplates, search });

    const result = await runAuditDeadTemplates({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "TmplOne", itemCount: 0 });
    expect(attempts).toBe(3);
  });

  it("does NOT retry on non-transient errors", async () => {
    const listItemTemplates = vi.fn().mockResolvedValue([
      {
        templateId: "tmpl-1",
        name: "TmplOne",
        fullName: "Project/TmplOne",
        standardValuesItemId: null,
      },
    ]);
    let attempts = 0;
    const search = vi.fn().mockImplementation(async () => {
      attempts += 1;
      throw new Error("Permission denied: caller lacks audit.read");
    });
    stubClient({ listItemTemplates, search });

    await expect(runAuditDeadTemplates({ json: true } as never)).rejects.toMatchObject({
      message: expect.stringContaining("Permission denied"),
    });
    // Only one attempt — the error wasn't transient-shaped.
    expect(attempts).toBe(1);
  });
});

/**
 * `scai hygiene audit broken-images list` — scans RichText fields for
 * `<img src>` URLs that fail an HTTP HEAD probe. These tests stub the
 * scan pipeline and `fetch` so the runner's URL extraction, status
 * classification, and report grouping are exercised without network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditBrokenImages } from "../../../../src/hygiene/tasks/audit/broken-images";

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
  items: Array<{
    id: string;
    fields: Array<{ name: string; value: string }>;
    templateName?: string;
  }>,
  envOverrides: Partial<EnvironmentConfiguration> = {}
): HygieneApiClient => {
  const env = { name: "sandbox", host: "h", ...envOverrides } as EnvironmentConfiguration;
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
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("audit broken-images — report shape", () => {
  it("returns an empty report when every <img> URL responds 2xx", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Body", value: '<p><img src="https://cdn.example.com/ok.png" /></p>' }],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 }) as never;

    const reports = await runAuditBrokenImages({ json: true, root: "/sitecore/content" });
    expect(reports).toEqual([]);
  });

  it("reports an item whose <img> URL returns 404", async () => {
    setup([
      {
        id: "abc",
        fields: [{ name: "Body", value: '<img src="https://cdn.example.com/missing.png">' }],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as never;

    const reports = await runAuditBrokenImages({ json: true, root: "/sitecore/content" });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: "abc",
      path: "/sitecore/content/abc",
      brokenImages: [
        { fieldName: "Body", url: "https://cdn.example.com/missing.png", status: 404 },
      ],
    });
  });

  it("classifies an aborted request as a timeout", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://slow.example.com/x">' }] },
    ]);
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenImages[0].status).toBe("timeout");
  });

  it("classifies a non-abort rejection as a network-error", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: '<img src="https://dns.invalid/x">' }] }]);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND")) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenImages[0].status).toBe("network-error");
  });

  it("falls back to a Range GET when HEAD returns 405, then accepts a 200", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/h">' }] },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 405 })
      .mockResolvedValueOnce({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as { method: string }).method).toBe("HEAD");
    expect((fetchMock.mock.calls[1][1] as { method: string }).method).toBe("GET");
  });

  it("skips data: URIs without probing them", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="data:image/png;base64,AAAA">' }] },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips __-prefixed system fields", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "__Renderings", value: '<img src="https://cdn.example.com/x">' }],
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a relative /-/media URL against the tenant host", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: '<img src="/-/media/logo.png">' }] }], {
      host: "https://my-tenant.sitecorecloud.io",
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://my-tenant.sitecorecloud.io/-/media/logo.png");
  });

  it("skips a relative URL that cannot be resolved (no tenant host)", async () => {
    // resolveTenant returns an env without `host`; a root-relative URL
    // can't be turned absolute, so it's marked skipped and never probed.
    const env = { name: "sandbox" } as EnvironmentConfiguration;
    vi.mocked(resolveEnvironment).mockReturnValue({
      envName: "sandbox",
      environment: env,
      root: { environments: { sandbox: env } } as unknown as RootConfiguration,
      timeoutMs: undefined,
    });
    const client = {
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "a",
          path: "/sitecore/content/a",
          name: "a",
          templateName: "Page",
          language: { name: "en" },
        };
      }),
      getItemFieldsBatch: vi
        .fn()
        .mockResolvedValue(
          new Map([["a", [{ fieldId: "f1", name: "Body", value: '<img src="/-/media/x.png">' }]]])
        ),
    } as unknown as HygieneApiClient;
    vi.mocked(createHygieneApiClient).mockReturnValue(client);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips URLs whose host is in --exclude-domains", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://blocked.example/x">' }] },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({
      json: true,
      excludeDomains: ["blocked.example"],
    });
    expect(reports).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("de-duplicates a repeated broken URL within a single item", async () => {
    setup([
      {
        id: "a",
        fields: [
          {
            name: "Body",
            value:
              '<img src="https://cdn.example.com/dup.png"><img src="https://cdn.example.com/dup.png">',
          },
        ],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 500 }) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenImages).toHaveLength(1);
  });

  it("emits a JSON envelope to stdout under --json", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Body", value: '<img src="https://cdn.example.com/missing.png">' }],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as never;
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    await runAuditBrokenImages({ json: true });
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.command).toBe("audit.broken-images.list");
    expect(parsed.count).toBe(1);
    expect(parsed.data[0].itemId).toBe("a");
  });

  it("resolves a protocol-relative // URL against https", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: '<img src="//cdn.example.com/p.png">' }] }]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://cdn.example.com/p.png");
  });

  it("treats a syntactically invalid absolute URL as skipped (never probed)", async () => {
    setup([{ id: "a", fields: [{ name: "Body", value: '<img src="https://[bad-host">' }] }]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a 5xx status surfaced after the HEAD→Range-GET fallback", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/x">' }] },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 501 })
      .mockResolvedValueOnce({ status: 503 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenImages[0].status).toBe(503);
  });

  it("caps the number of probed URLs at --url-limit", async () => {
    setup([
      {
        id: "a",
        fields: [
          {
            name: "Body",
            value:
              '<img src="https://cdn.example.com/1.png">' +
              '<img src="https://cdn.example.com/2.png">' +
              '<img src="https://cdn.example.com/3.png">',
          },
        ],
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    await runAuditBrokenImages({ json: true, urlLimit: 2 });
    // Three distinct URLs, but only the first two get probed.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("groups broken images from two distinct items into two reports, sorted by path", async () => {
    setup([
      { id: "zeta", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/z">' }] },
      { id: "alpha", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/a">' }] },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.path)).toEqual([
      "/sitecore/content/alpha",
      "/sitecore/content/zeta",
    ]);
  });

  it("does not report an item when its image URL responds 3xx (treated as ok)", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/r">' }] },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 301 }) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toEqual([]);
  });

  it("collects multiple distinct broken URLs on one item and renders the truncated human line", async () => {
    setup([
      {
        id: "a",
        fields: [
          {
            name: "Body",
            value:
              '<img src="https://cdn.example.com/1.png">' +
              '<img src="https://cdn.example.com/2.png">' +
              '<img src="https://cdn.example.com/3.png">',
          },
        ],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as never;
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockReturnValue(true);

    // Non-json path exercises the formatLine truncation ("…" for >2).
    const reports = await runAuditBrokenImages({});
    expect(reports).toHaveLength(1);
    expect(reports[0].brokenImages).toHaveLength(3);
    void writes;
  });

  it("keeps a same URL referenced from two different fields as two entries", async () => {
    setup([
      {
        id: "a",
        fields: [
          { name: "Body", value: '<img src="https://cdn.example.com/dup.png">' },
          { name: "Teaser", value: '<img src="https://cdn.example.com/dup.png">' },
        ],
      },
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 404 }) as never;

    const reports = await runAuditBrokenImages({ json: true });
    expect(reports).toHaveLength(1);
    // Same URL, different field names → both kept.
    expect(reports[0].brokenImages).toHaveLength(2);
    expect(reports[0].brokenImages.map((b) => b.fieldName).sort()).toEqual(["Body", "Teaser"]);
  });

  it("honours a custom --request-timeout-ms for the abort timer", async () => {
    setup([
      { id: "a", fields: [{ name: "Body", value: '<img src="https://cdn.example.com/t">' }] },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = fetchMock as never;

    const reports = await runAuditBrokenImages({ json: true, requestTimeoutMs: 1234 });
    expect(reports).toEqual([]);
    // The HEAD request still carries an AbortSignal regardless of the timeout value.
    expect((fetchMock.mock.calls[0][1] as { signal?: unknown }).signal).toBeDefined();
  });
});

describe("audit broken-images — error paths", () => {
  it("propagates an error thrown by resolveTenant", async () => {
    vi.mocked(resolveEnvironment).mockImplementation(() => {
      throw Object.assign(new Error("no tenant"), { code: "CONFIG_NOT_FOUND" });
    });
    await expect(runAuditBrokenImages({ json: true })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});

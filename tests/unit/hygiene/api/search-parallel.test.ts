import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../../src/config/types";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

vi.mock("../../../../src/auth/client-credentials", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
}));

const baseEnv: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
  database: "master",
} as EnvironmentConfiguration;

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

const mockSearchResults = (pages: Array<{ items: string[] }>, total: number) => {
  let callIndex = 0;
  const fetchMock = vi.fn().mockImplementation(() => {
    const page = pages[callIndex] ?? { items: [] };
    callIndex += 1;
    return Promise.resolve(
      okResponse({
        data: {
          search: {
            totalCount: total,
            results: page.items.map((id) => ({ itemId: id, path: `/x/${id}`, name: id })),
          },
        },
      })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("searchAll — serial mode (parallel=1)", () => {
  it("walks pages in order until short page", async () => {
    mockSearchResults([{ items: ["a", "b"] }, { items: ["c", "d"] }, { items: ["e"] }], 5);
    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({}, 2, 1)) ids.push(r.itemId);
    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("stops on first page when totalCount <= pageSize", async () => {
    const fetchMock = mockSearchResults([{ items: ["a"] }], 1);
    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({}, 10, 1)) ids.push(r.itemId);
    expect(ids).toEqual(["a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("searchAll — parallel mode (parallel >= 2)", () => {
  it("fetches first page sequentially then remaining pages in windows", async () => {
    const fetchMock = mockSearchResults(
      [
        { items: ["a", "b"] }, // page 0
        { items: ["c", "d"] }, // page 1
        { items: ["e", "f"] }, // page 2
      ],
      6
    );
    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({}, 2, 4)) ids.push(r.itemId);
    expect(ids).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("preserves per-window ordering even with parallelism", async () => {
    mockSearchResults(
      [{ items: ["a", "b"] }, { items: ["c", "d"] }, { items: ["e", "f"] }, { items: ["g", "h"] }],
      8
    );
    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({}, 2, 2)) ids.push(r.itemId);
    // Window 1 = pages 1+2 (after sequential page 0), Window 2 = page 3.
    // Within a window, results yield in page-index order.
    expect(ids).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("stops early when a window returns a short page", async () => {
    const fetchMock = mockSearchResults(
      [
        { items: ["a", "b"] },
        { items: ["c", "d"] },
        { items: ["e"] }, // short page — should stop after this window
      ],
      100 // totalCount lies (or got stale)
    );
    const client = createHygieneApiClient({ environment: baseEnv });
    const ids: string[] = [];
    for await (const r of client.searchAll({}, 2, 2)) ids.push(r.itemId);
    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
    // Stopped after 3 calls (page 0 sequential + 1 window of 2). Without
    // the short-page detection we would have fanned out indefinitely.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

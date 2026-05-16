import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import { resolveItemPathsToIds } from "../../../src/publishing/api/path-resolver";
import { ScaiError } from "../../../src/shared/errors";

vi.mock("../../../src/recipe/api/graphql", () => ({
  runAuthoringGraphQL: vi.fn(),
}));

import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";
const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;

const env: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
} as EnvironmentConfiguration;

beforeEach(() => {
  mockRun.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveItemPathsToIds", () => {
  it("returns an empty resolved list for an empty input", async () => {
    expect(await resolveItemPathsToIds(env, [])).toEqual({ resolved: [] });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("issues a single batched query for multiple paths", async () => {
    mockRun.mockResolvedValue({
      i0: { itemId: "id-1", path: "/p/1" },
      i1: { itemId: "id-2", path: "/p/2" },
    });
    const result = await resolveItemPathsToIds(env, ["/p/1", "/p/2"]);
    expect(mockRun).toHaveBeenCalledOnce();
    const [, query, variables] = mockRun.mock.calls[0];
    expect(query).toContain("i0: item(where: { path: $p0 })");
    expect(query).toContain("i1: item(where: { path: $p1 })");
    expect(variables).toEqual({ p0: "/p/1", p1: "/p/2" });
    expect(result.resolved).toEqual([
      { path: "/p/1", itemId: "id-1" },
      { path: "/p/2", itemId: "id-2" },
    ]);
  });

  it("preserves caller order even when paths arrive shuffled", async () => {
    mockRun.mockResolvedValue({
      i0: { itemId: "z" },
      i1: { itemId: "a" },
    });
    const result = await resolveItemPathsToIds(env, ["/z", "/a"]);
    expect(result.resolved.map((r) => r.path)).toEqual(["/z", "/a"]);
  });

  it("de-duplicates repeated paths in the wire request but echoes them in output order", async () => {
    mockRun.mockResolvedValue({ i0: { itemId: "id-1" } });
    const result = await resolveItemPathsToIds(env, ["/p/1", "/p/1", "/p/1"]);
    expect(mockRun).toHaveBeenCalledOnce();
    const [, , variables] = mockRun.mock.calls[0];
    expect(Object.keys(variables as object)).toEqual(["p0"]); // only one variable
    expect(result.resolved).toEqual([
      { path: "/p/1", itemId: "id-1" },
      { path: "/p/1", itemId: "id-1" },
      { path: "/p/1", itemId: "id-1" },
    ]);
  });

  it("throws INPUT_INVALID listing every missing path in one error", async () => {
    mockRun.mockResolvedValue({
      i0: { itemId: "found-1" },
      i1: null,
      i2: null,
    });
    await expect(
      resolveItemPathsToIds(env, ["/found", "/missing-a", "/missing-b"])
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      hint: expect.stringContaining("/missing-a"),
    });
    await expect(
      resolveItemPathsToIds(env, ["/found", "/missing-a", "/missing-b"])
    ).rejects.toMatchObject({
      hint: expect.stringContaining("/missing-b"),
    });
  });

  it("batches across multiple GraphQL calls when over BATCH_SIZE (25)", async () => {
    const inputs: string[] = [];
    for (let i = 0; i < 30; i += 1) inputs.push(`/p/${i}`);
    let callIndex = 0;
    mockRun.mockImplementation(async (_env: unknown, _q: unknown, vars: unknown) => {
      const variables = vars as Record<string, string>;
      const keys = Object.keys(variables);
      const response: Record<string, { itemId: string } | null> = {};
      keys.forEach((key, i) => {
        response[`i${i}`] = { itemId: `${variables[key]}-id` };
      });
      callIndex += 1;
      return response;
    });
    const result = await resolveItemPathsToIds(env, inputs);
    expect(callIndex).toBe(2);
    expect(result.resolved).toHaveLength(30);
    expect(result.resolved[29]).toEqual({ path: "/p/29", itemId: "/p/29-id" });
  });

  it("rejects ScaiError instance check on missing paths", async () => {
    mockRun.mockResolvedValue({ i0: null });
    await expect(resolveItemPathsToIds(env, ["/missing"])).rejects.toBeInstanceOf(ScaiError);
  });
});

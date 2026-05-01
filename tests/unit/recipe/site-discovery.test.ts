import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config";
import { discoverSites } from "../../../src/recipe/api/site-discovery";

vi.mock("../../../src/recipe/api/auth", () => ({
  getAccessToken: vi.fn(),
}));

import { getAccessToken } from "../../../src/recipe/api/auth";
const getAccessTokenMock = vi.mocked(getAccessToken);

const env: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
} as EnvironmentConfiguration;

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const childrenResponse = (nodes: Array<{ name: string; templateName: string }>) =>
  okResponse({
    data: {
      item: {
        children: {
          nodes: nodes.map((node) => ({
            itemId: `id-${node.name}`,
            name: node.name,
            displayName: node.name,
            path: `/sitecore/content/${node.name}`,
            template: { name: node.templateName },
          })),
        },
      },
    },
  });

beforeEach(() => {
  vi.restoreAllMocks();
  getAccessTokenMock.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverSites — template name matching", () => {
  it("treats 'Headless Tenant' and 'Headless Site' as tenant + site (XM Cloud)", async () => {
    const responses = [
      // /sitecore/content children
      childrenResponse([
        { name: "Home", templateName: "Sample Item" },
        { name: "demo-registry", templateName: "Headless Tenant" },
      ]),
      // /sitecore/content/demo-registry children
      okResponse({
        data: {
          item: {
            children: {
              nodes: [
                {
                  itemId: "id-content-modelling",
                  name: "content-modelling",
                  displayName: "Content Modelling",
                  path: "/sitecore/content/demo-registry/content-modelling",
                  template: { name: "Headless Site" },
                },
              ],
            },
          },
        },
      }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra fetch call");
      return Promise.resolve(next);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      name: "content-modelling",
      displayName: "Content Modelling",
      tenantName: "demo-registry",
    });
  });

  it("still recognizes the legacy SXA names ('Tenant', 'Site')", async () => {
    const responses = [
      childrenResponse([{ name: "my-tenant", templateName: "Tenant" }]),
      childrenResponse([{ name: "my-site", templateName: "Site" }]),
    ];
    const fetchMock = vi.fn().mockImplementation(() => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra fetch call");
      return Promise.resolve(next);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ name: "my-site", tenantName: "my-tenant" });
  });

  it("skips items whose template is neither tenant nor site", async () => {
    const responses = [
      childrenResponse([
        { name: "Home", templateName: "Sample Item" },
        { name: "Misc", templateName: "Folder" },
      ]),
    ];
    const fetchMock = vi.fn().mockImplementation(() => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected extra fetch call");
      return Promise.resolve(next);
    });
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites).toEqual([]);
    // Only the root walk; no second call because there are no tenants.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

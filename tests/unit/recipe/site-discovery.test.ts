import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
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

/** A children response whose item nodes carry explicit paths. */
const childrenAt = (
  nodes: Array<{ name: string; path: string; templateName?: string; displayName?: string }>
) =>
  okResponse({
    data: {
      item: {
        children: {
          nodes: nodes.map((node) => ({
            itemId: `id-${node.name}`,
            name: node.name,
            displayName: node.displayName ?? node.name,
            path: node.path,
            template: node.templateName ? { name: node.templateName } : null,
          })),
        },
      },
    },
  });

/** A `fields(ownFields:false)` response for the hostname query. */
const fieldsResponse = (fields: Array<{ name: string; value: string | null }>) =>
  okResponse({ data: { item: { fields: { nodes: fields } } } });

/** A queued-response fetch mock; throws if drained. */
const queuedFetch = (responses: Response[]) =>
  vi.fn().mockImplementation(() => {
    const next = responses.shift();
    if (!next) throw new Error("Unexpected extra fetch call");
    return Promise.resolve(next);
  });

describe("discoverSites — empty walks", () => {
  it("returns [] and only walks the root when /sitecore/content has no children", async () => {
    // `item` is null → fetchChildren falls back to [].
    const fetchMock = queuedFetch([okResponse({ data: { item: null } })]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("walks a tenant but yields no sites when the tenant has only non-site children", async () => {
    const fetchMock = queuedFetch([
      childrenAt([
        { name: "my-tenant", path: "/sitecore/content/my-tenant", templateName: "Tenant" },
      ]),
      childrenAt([
        { name: "Media", path: "/sitecore/content/my-tenant/Media", templateName: "Folder" },
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("discoverSites — contentRoot override", () => {
  it("walks the supplied contentRoot instead of /sitecore/content", async () => {
    const fetchMock = queuedFetch([
      childrenAt([{ name: "t", path: "/custom/root/t", templateName: "Tenant" }]),
      childrenAt([{ name: "s", path: "/custom/root/t/s", templateName: "Site" }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env, { contentRoot: "/custom/root" });

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ name: "s", path: "/custom/root/t/s" });
    // The first GraphQL request must carry the overridden path variable.
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]![1].body)) as {
      variables: { path: string };
    };
    expect(firstBody.variables.path).toBe("/custom/root");
  });
});

describe("discoverSites — displayName fallback", () => {
  it("falls back to the item name when displayName is blank", async () => {
    const fetchMock = queuedFetch([
      childrenAt([{ name: "t", path: "/sitecore/content/t", templateName: "Tenant" }]),
      childrenAt([
        {
          name: "bare-site",
          path: "/sitecore/content/t/bare-site",
          templateName: "Site",
          displayName: "   ",
        },
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env);

    expect(sites[0]!.displayName).toBe("bare-site");
  });
});

describe("discoverSites — includeHostnames", () => {
  it("collects pipe-separated hostnames from Site Grouping items", async () => {
    const fetchMock = queuedFetch([
      // /sitecore/content children
      childrenAt([{ name: "t", path: "/sitecore/content/t", templateName: "Tenant" }]),
      // tenant children
      childrenAt([{ name: "s", path: "/sitecore/content/t/s", templateName: "Site" }]),
      // site children → Settings
      childrenAt([{ name: "Settings", path: "/sitecore/content/t/s/Settings" }]),
      // Settings children → Site Grouping container
      childrenAt([{ name: "Site Grouping", path: "/sitecore/content/t/s/Settings/Site Grouping" }]),
      // grouping container children → one grouping item
      childrenAt([{ name: "s", path: "/sitecore/content/t/s/Settings/Site Grouping/s" }]),
      // hostname fields for that grouping
      fieldsResponse([
        { name: "Hostname", value: "  www.example.com | example.com  " },
        { name: "Language", value: "en" },
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env, { includeHostnames: true });

    expect(sites).toHaveLength(1);
    expect(sites[0]!.hostnames).toEqual(["www.example.com", "example.com"]);
  });

  it("yields an empty hostname list when the site has no Settings item", async () => {
    const fetchMock = queuedFetch([
      childrenAt([{ name: "t", path: "/sitecore/content/t", templateName: "Tenant" }]),
      childrenAt([{ name: "s", path: "/sitecore/content/t/s", templateName: "Site" }]),
      // site children: no "Settings" node
      childrenAt([{ name: "Other", path: "/sitecore/content/t/s/Other" }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env, { includeHostnames: true });

    expect(sites[0]!.hostnames).toEqual([]);
  });

  it("yields an empty hostname list when Settings has no Site Grouping container", async () => {
    const fetchMock = queuedFetch([
      childrenAt([{ name: "t", path: "/sitecore/content/t", templateName: "Tenant" }]),
      childrenAt([{ name: "s", path: "/sitecore/content/t/s", templateName: "Site" }]),
      childrenAt([{ name: "Settings", path: "/sitecore/content/t/s/Settings" }]),
      // Settings children: no "Site Grouping" node
      childrenAt([{ name: "Other", path: "/sitecore/content/t/s/Settings/Other" }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env, { includeHostnames: true });

    expect(sites[0]!.hostnames).toEqual([]);
  });

  it("skips groupings whose Hostname field is missing or blank", async () => {
    const fetchMock = queuedFetch([
      childrenAt([{ name: "t", path: "/sitecore/content/t", templateName: "Tenant" }]),
      childrenAt([{ name: "s", path: "/sitecore/content/t/s", templateName: "Site" }]),
      childrenAt([{ name: "Settings", path: "/sitecore/content/t/s/Settings" }]),
      childrenAt([{ name: "Site Grouping", path: "/sitecore/content/t/s/Settings/Site Grouping" }]),
      childrenAt([
        { name: "g1", path: "/sitecore/content/t/s/Settings/Site Grouping/g1" },
        { name: "g2", path: "/sitecore/content/t/s/Settings/Site Grouping/g2" },
      ]),
      // g1: blank hostname → skipped
      fieldsResponse([{ name: "Hostname", value: "   " }]),
      // g2: no Hostname field at all → skipped
      fieldsResponse([{ name: "Language", value: "en" }]),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const sites = await discoverSites(env, { includeHostnames: true });

    expect(sites[0]!.hostnames).toEqual([]);
  });
});

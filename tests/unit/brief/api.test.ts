import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCreateBriefInput,
  listBriefs,
  getBrief,
  createBrief,
  deleteBrief,
  setBriefStatus,
  updateBrief,
} from "../../../src/brief/api/briefs";
import {
  createBriefType,
  deleteBriefType,
  listBriefTypes,
  updateBriefType,
} from "../../../src/brief/api/brief-types";
import { listBriefTasks } from "../../../src/brief/api/tasks";
import { listBriefComments } from "../../../src/brief/api/comments";
import { DEFAULT_BRIEF_API_BASE } from "../../../src/brief/api/types";

const baseOptions = { accessToken: "test-token" };

const okResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

const emptyPage = { totalCount: 0, next: null, data: [] };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("brief API — URL composition", () => {
  it("listBriefs hits /api/brief/v1/briefs with no query when called bare", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefs(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs`);
  });

  it("listBriefs threads pagination + locale params through the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefs(baseOptions, { limit: 25, next: "cursor-abc", locale: "en-us" });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("Limit=25");
    expect(url).toContain("Next=cursor-abc");
    expect(url).toContain("Locale=en-us");
  });

  it("getBrief URL-encodes the brief id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "ae247ac1" }));
    vi.stubGlobal("fetch", fetchMock);

    await getBrief(baseOptions, "ae247ac1/with/slashes");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/ae247ac1%2Fwith%2Fslashes`
    );
  });

  it("listBriefTypes hits /api/brief/v1/brief-types", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefTypes(baseOptions);

    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/brief-types`);
  });

  it("listBriefTasks adds BriefId and MetadataToLoad to the query string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefTasks(baseOptions, {
      briefId: "ae247ac1-a448-4451-829e-7b9733deaa1a",
      metadataToLoad: ["assignees"],
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("BriefId=ae247ac1-a448-4451-829e-7b9733deaa1a");
    expect(url).toContain("MetadataToLoad=assignees");
  });

  it("listBriefComments scopes by BriefId when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefComments(baseOptions, { briefId: "abc-123" });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_BRIEF_API_BASE}/api/brief/v1/comments?BriefId=abc-123`
    );
  });
});

describe("brief API — bearer auth + transport", () => {
  it("attaches the access token as a Bearer header on every call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefs({ accessToken: "the-token" });

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer the-token");
    expect(init.headers.Accept).toBe("application/json");
  });

  it("respects a custom baseUrl override (for regional hosts)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(emptyPage));
    vi.stubGlobal("fetch", fetchMock);

    await listBriefs({
      accessToken: "t",
      baseUrl: "https://co-brief-api-eus.sitecorecloud.io",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://co-brief-api-eus.sitecorecloud.io/api/brief/v1/briefs"
    );
  });

  it("surfaces non-2xx responses as ScaiError with BRIEF_API_FAILED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('"Brief not found"', { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getBrief(baseOptions, "missing-id")).rejects.toThrow();
  });
});

describe("brief-types CRUD", () => {
  const createInput = {
    name: "ScaiProbeType",
    label: { "en-us": "Scai probe type" } as Record<string, string>,
    description: "test",
    icon: "FileDocumentOutline",
    iconColor: "#FF00AA",
    fields: [],
  };

  it("createBriefType POSTs the input as the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "new-id", ...createInput }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createBriefType(baseOptions, createInput);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/brief-types`);
    expect((init as { method: string }).method).toBe("POST");
    expect(JSON.parse((init as { body: string }).body)).toEqual(createInput);
    expect(result).toMatchObject({ id: "new-id" });
  });

  it("updateBriefType PUTs to the item URL and returns undefined on 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateBriefType(baseOptions, "type-id-123", createInput);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/brief-types/type-id-123`);
    expect((init as { method: string }).method).toBe("PUT");
    expect(result).toBeUndefined();
  });

  it("deleteBriefType DELETEs the item URL and returns undefined on 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteBriefType(baseOptions, "type-id-123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/brief-types/type-id-123`);
    expect((init as { method: string }).method).toBe("DELETE");
    expect(result).toBeUndefined();
  });

  it("updateBriefType URL-encodes the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await updateBriefType(baseOptions, "id/with/slashes", createInput);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_BRIEF_API_BASE}/api/brief/v1/brief-types/id%2Fwith%2Fslashes`
    );
  });
});

describe("brief instance CRUD", () => {
  it("createBrief POSTs a flat briefTypeId, not a nested briefType object", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: "brief-1", name: "B" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createBrief(baseOptions, {
      name: "Allstate Evaluation",
      briefTypeId: "type-abc",
      locale: "en-us",
      fields: { Field1: { type: "RichText", value: "x" } },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs`);
    expect((init as { method: string }).method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    // The API rejects a nested `briefType` object — it requires a flat
    // `briefTypeId`. This guards the create-shape regression.
    expect(body.briefTypeId).toBe("type-abc");
    expect(body.briefType).toBeUndefined();
    expect(body.name).toBe("Allstate Evaluation");
  });

  it("deleteBrief DELETEs the item URL and returns undefined on 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteBrief(baseOptions, "brief-xyz");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/brief-xyz`);
    expect((init as { method: string }).method).toBe("DELETE");
    expect(result).toBeUndefined();
  });

  it("setBriefStatus PUTs a status-only body to the brief item URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setBriefStatus(baseOptions, "brief-xyz", "Approved");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/brief-xyz`);
    expect((init as { method: string }).method).toBe("PUT");
    expect(JSON.parse((init as { body: string }).body)).toEqual({ status: "Approved" });
    expect(result).toBeUndefined();
  });

  it("updateBrief PUTs an arbitrary partial body to the brief item URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await updateBrief(baseOptions, "brief-xyz", { name: "Renamed", locale: "en-us" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/brief-xyz`);
    expect((init as { method: string }).method).toBe("PUT");
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      name: "Renamed",
      locale: "en-us",
    });
  });

  it("assertCreateBriefInput accepts a minimal valid body", () => {
    const input = assertCreateBriefInput({ name: "B", briefTypeId: "type-1" });
    expect(input.name).toBe("B");
  });

  it("assertCreateBriefInput rejects a missing briefTypeId with a hint", () => {
    expect(() => assertCreateBriefInput({ name: "B" })).toThrowError(/briefTypeId/);
  });

  it("assertCreateBriefInput rejects an empty name", () => {
    expect(() => assertCreateBriefInput({ name: "", briefTypeId: "t" })).toThrowError(/'name'/);
  });

  it("assertCreateBriefInput rejects an array `fields`", () => {
    // The Brief API takes `fields` as an object keyed by field name; an
    // array silently 400s with a generic 'invalid body' error — assert
    // early instead.
    expect(() =>
      assertCreateBriefInput({ name: "B", briefTypeId: "t", fields: [] as unknown })
    ).toThrowError(/'fields'/);
  });

  it("setBriefStatus URL-encodes the brief id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await setBriefStatus(baseOptions, "id/with/slash", "InReview");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${DEFAULT_BRIEF_API_BASE}/api/brief/v1/briefs/id%2Fwith%2Fslash`
    );
  });
});

describe("brief API — response parsing", () => {
  it("listBriefs returns the paged envelope verbatim", async () => {
    const payload = {
      totalCount: 1,
      next: null,
      data: [{ id: "abc", name: "Test", status: "Draft" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(okResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listBriefs(baseOptions);

    expect(result).toEqual(payload);
  });
});

/**
 * Contract-pinned integration coverage for the `./unstable/brief` SDK
 * surface — Sitecore Content Operations Brief API. The write surface
 * (`createBriefType`, `createBrief`, `updateBrief`, `deleteBrief`)
 * was verified against the Agents env in May 2026; these tests pin the
 * verified wire shape so future drift surfaces as a contract failure
 * rather than a 400 against a live tenant.
 *
 * Hermetic: `fetch` is stubbed, no live HTTP. Lives in the integration
 * tier because it pins **multi-resource lifecycle workflows** (briefType
 * → brief → status transition → delete) instead of per-function shape
 * already covered by unit tests.
 *
 * Gated by `SITECOREAI_RUN_INTEGRATION=1`; skipped otherwise.
 */

import "./setup";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { createBrief, deleteBrief, updateBrief } from "../../src/brief/api/briefs";
import {
  createBriefType,
  deleteBriefType,
  updateBriefType,
  type CreateBriefTypeInput,
} from "../../src/brief/api/brief-types";
import { DEFAULT_BRIEF_API_BASE } from "../../src/brief/api/types";
import { describeIfIntegration } from "./helpers";

const { describe, it } = describeIfIntegration();

const B = DEFAULT_BRIEF_API_BASE;
const baseClient = { accessToken: "brief-token" };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

const recordCalls = (responses: Response[]): { calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn().mockImplementation((url: string, init: unknown) => {
    const i = init as { method?: string; body?: string; headers?: Record<string, string> };
    calls.push({
      url,
      method: (i.method ?? "GET").toUpperCase(),
      body: i.body ? JSON.parse(i.body) : undefined,
      headers: i.headers ?? {},
    });
    const next = responses.shift();
    if (!next) {
      throw new Error("Unexpected extra fetch call");
    }
    return Promise.resolve(next);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
};

const validBriefTypeInput = (name = "MarketingCampaign"): CreateBriefTypeInput => ({
  name,
  label: { "en-US": "Marketing Campaign" },
  description: "Brief type used by scai integration tests.",
  icon: "campaign",
  iconColor: "blue",
  fields: [],
});

describe("brief — full lifecycle: briefType → brief → status → delete", () => {
  it("verifies the documented wire shape for every step in the brief lifecycle", async () => {
    const briefTypeId = "bt-int-1";
    const briefId = "b-int-1";

    const { calls } = recordCalls([
      jsonResponse({ id: briefTypeId, name: "MarketingCampaign" }, 201),
      jsonResponse({ id: briefId, name: "Spring Launch", briefTypeId, status: "Draft" }, 201),
      jsonResponse(null, 204),
      jsonResponse(null, 204),
    ]);

    const briefType = await createBriefType(baseClient, validBriefTypeInput());
    expect(briefType.id).toBe(briefTypeId);

    const brief = await createBrief(baseClient, {
      name: "Spring Launch",
      briefTypeId,
      locale: "en-US",
    });
    expect(brief.id).toBe(briefId);

    await updateBrief(baseClient, briefId, { status: "Approved" });
    await deleteBrief(baseClient, briefId);

    // -- Wire-level contract assertions ------------------------------------

    // createBriefType — POST to /brief-types with full input body and bearer.
    expect(calls[0]).toMatchObject({
      url: `${B}/api/brief/v1/brief-types`,
      method: "POST",
    });
    expect(calls[0].body).toMatchObject({
      name: "MarketingCampaign",
      label: { "en-US": "Marketing Campaign" },
      description: expect.any(String),
      icon: "campaign",
      iconColor: "blue",
      fields: [],
    });
    expect(calls[0].headers.Authorization).toBe("Bearer brief-token");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");

    // createBrief — verified 2026-05-15: flat briefTypeId, not nested briefType.id.
    expect(calls[1]).toMatchObject({
      url: `${B}/api/brief/v1/briefs`,
      method: "POST",
    });
    expect(calls[1].body).toMatchObject({
      name: "Spring Launch",
      briefTypeId,
      locale: "en-US",
    });
    expect((calls[1].body as Record<string, unknown>).briefType).toBeUndefined();

    // updateBrief (status-only) — PUT to /briefs/{id} with status body, 204 No Content.
    expect(calls[2]).toMatchObject({
      url: `${B}/api/brief/v1/briefs/${briefId}`,
      method: "PUT",
    });
    expect(calls[2].body).toEqual({ status: "Approved" });

    // deleteBrief — DELETE to /briefs/{id}, no body.
    expect(calls[3]).toMatchObject({
      url: `${B}/api/brief/v1/briefs/${briefId}`,
      method: "DELETE",
    });
    expect(calls[3].body).toBeUndefined();
  });
});

describe("brief — input validation refuses bad briefType payloads before any HTTP", () => {
  it("rejects a name that doesn't match the server's pattern (no HTTP issued)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // `assertCreateBriefTypeInput` throws synchronously inside `createBriefType`
    // before any promise is returned — so the failure surfaces as a thrown
    // error rather than a rejected promise.
    expect(() => createBriefType(baseClient, validBriefTypeInput("1-bad-name"))).toThrow(
      expect.objectContaining({
        code: "INPUT_INVALID",
        hint: expect.stringContaining("[A-Za-z][A-Za-z0-9_]*"),
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an update that's missing required fields before the PUT", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      updateBriefType(baseClient, "bt-1", {
        // Missing label, icon, iconColor, fields
        name: "MarketingCampaign",
        description: "x",
      } as never)
    ).toThrow(
      expect.objectContaining({
        code: "INPUT_INVALID",
        message: expect.stringContaining("missing required"),
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("brief — regional baseUrl + error mapping at the wire boundary", () => {
  it("honors a per-call regional baseUrl override", async () => {
    const { calls } = recordCalls([jsonResponse(null, 204)]);

    await deleteBriefType(
      { accessToken: "brief-token", baseUrl: "https://co-brief-api-eus.sitecorecloud.io" },
      "bt-int-2"
    );

    expect(calls[0].url).toBe(
      "https://co-brief-api-eus.sitecorecloud.io/api/brief/v1/brief-types/bt-int-2"
    );
    expect(calls[0].method).toBe("DELETE");
  });

  it("maps a non-2xx response with a Sitecore error body to BRIEF_API_FAILED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: { BriefTypeId: ["Brief type is required."] },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    // Valid client-side input (non-empty name + briefTypeId) so the call
    // reaches the wire and exercises the non-2xx → BRIEF_API_FAILED mapping,
    // rather than tripping `assertCreateBriefInput` (INPUT_INVALID) first.
    await expect(
      createBrief(baseClient, { name: "bad", briefTypeId: "bt-1" })
    ).rejects.toMatchObject({
      code: "BRIEF_API_FAILED",
    });
  });
});

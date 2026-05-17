import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runBrandIngestionPipeline` / `runEnrichSectionsPipeline` request
 * shaping. `requestBrandApi` is mocked so each test asserts the
 * transport call args (path, method, body parameters) and the returned
 * run record. Both pipelines join `documentIds` / `sectionIds` /
 * `fieldIds` arrays into the comma-separated strings the API wants —
 * covered explicitly. No network.
 */
const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/brand/api/client")>(
    "../../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { runBrandIngestionPipeline, runEnrichSectionsPipeline, PIPELINE_BASE_PATH } =
  await import("../../../../src/brand/pipeline/run");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

beforeEach(() => {
  requestMock.mockReset();
});

describe("PIPELINE_BASE_PATH", () => {
  it("targets the ai-pipeline-api stream", () => {
    expect(PIPELINE_BASE_PATH).toBe("/stream/ai-pipeline-api");
  });
});

describe("runBrandIngestionPipeline", () => {
  it("POSTs to the BrandIngestionPipeline endpoint with populateSections defaulting to true", async () => {
    requestMock.mockResolvedValue({ id: "run-1" });

    const result = await runBrandIngestionPipeline({ client: FAKE_CLIENT, brandKitId: "kit-1" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      basePath: "/stream/ai-pipeline-api",
      path: "/api/data/v1/organizations/org_ABC/pipeline/BrandIngestionPipeline",
      method: "POST",
    });
    expect(req.body.parameters).toEqual({
      brand_kit_id: "kit-1",
      populateSections: true,
      documentIdsList: undefined,
    });
    expect(result).toMatchObject({ id: "run-1" });
  });

  it("honors an explicit populateSections: false", async () => {
    requestMock.mockResolvedValue({ id: "run-1" });

    await runBrandIngestionPipeline({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      populateSections: false,
    });

    expect(requestMock.mock.calls[0]![1].body.parameters.populateSections).toBe(false);
  });

  it("joins documentIds into a comma-separated documentIdsList", async () => {
    requestMock.mockResolvedValue({ id: "run-1" });

    await runBrandIngestionPipeline({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      documentIds: ["doc-a", "doc-b", "doc-c"],
    });

    expect(requestMock.mock.calls[0]![1].body.parameters.documentIdsList).toBe("doc-a,doc-b,doc-c");
  });

  it("leaves documentIdsList undefined when documentIds is an empty array", async () => {
    requestMock.mockResolvedValue({ id: "run-1" });

    await runBrandIngestionPipeline({ client: FAKE_CLIENT, brandKitId: "kit-1", documentIds: [] });

    expect(requestMock.mock.calls[0]![1].body.parameters.documentIdsList).toBeUndefined();
  });
});

describe("runEnrichSectionsPipeline", () => {
  it("POSTs to the EnrichSectionsPipeline endpoint with the brand kit id", async () => {
    requestMock.mockResolvedValue({ id: "run-2" });

    const result = await runEnrichSectionsPipeline({ client: FAKE_CLIENT, brandKitId: "kit-1" });

    const [, req] = requestMock.mock.calls[0]!;
    expect(req).toMatchObject({
      path: "/api/data/v1/organizations/org_ABC/pipeline/EnrichSectionsPipeline",
      method: "POST",
    });
    expect(req.body.parameters).toEqual({
      brand_kit_id: "kit-1",
      sectionIdsList: undefined,
      fieldIdsList: undefined,
    });
    expect(result).toMatchObject({ id: "run-2" });
  });

  it("joins sectionIds and fieldIds into comma-separated lists", async () => {
    requestMock.mockResolvedValue({ id: "run-2" });

    await runEnrichSectionsPipeline({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionIds: ["sec-1", "sec-2"],
      fieldIds: ["f-1"],
    });

    const params = requestMock.mock.calls[0]![1].body.parameters;
    expect(params.sectionIdsList).toBe("sec-1,sec-2");
    expect(params.fieldIdsList).toBe("f-1");
  });

  it("leaves sectionIdsList/fieldIdsList undefined for empty arrays", async () => {
    requestMock.mockResolvedValue({ id: "run-2" });

    await runEnrichSectionsPipeline({
      client: FAKE_CLIENT,
      brandKitId: "kit-1",
      sectionIds: [],
      fieldIds: [],
    });

    const params = requestMock.mock.calls[0]![1].body.parameters;
    expect(params.sectionIdsList).toBeUndefined();
    expect(params.fieldIdsList).toBeUndefined();
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue({ id: "run-2" });
    const signal = new AbortController().signal;

    await runEnrichSectionsPipeline({ client: FAKE_CLIENT, brandKitId: "kit-1", signal });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

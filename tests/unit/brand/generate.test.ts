import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandReviewSectionResult } from "../../../src/brand/api/types";

/**
 * `generateBrandReview` end-to-end. `requestBrandApi` is mocked so the
 * test exercises the wrapper's own logic: the `input` → `ExtractableFile`
 * encoding (`buildApiInput`), the `{reviews:[…]}` → `BrandReviewSectionResult[]`
 * flattening, `clampScore` bounds, the conservative `aggregateOverall`
 * derivation, and the `brandkitId` / `sections` body shaping. No network.
 */

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/brand/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../../src/brand/api/client")>(
    "../../../src/brand/api/client"
  );
  return { ...actual, requestBrandApi: requestMock };
});

const { _aggregateOverall, generateBrandReview } =
  await import("../../../src/brand/review/generate");

const FAKE_CLIENT = { orgId: "org_ABC", credential: { clientId: "x" } } as never;

const row = (
  score: 1 | 2 | 3 | 4 | 5,
  partial: Partial<BrandReviewSectionResult> = {}
): BrandReviewSectionResult => ({
  section: partial.section ?? "section-uuid",
  field: partial.field,
  score,
  explanation: partial.explanation,
  suggestions: partial.suggestions,
});

beforeEach(() => {
  requestMock.mockReset();
});

describe("brand/review/generate — aggregateOverall", () => {
  it("returns 5 for empty input (no findings = max alignment)", () => {
    expect(_aggregateOverall([])).toBe(5);
  });

  it("picks the minimum score across all rows", () => {
    expect(_aggregateOverall([row(5), row(3), row(2)])).toBe(2);
  });

  it("treats field-level rows the same as section-level rows", () => {
    expect(_aggregateOverall([row(4, { field: undefined }), row(1, { field: "f-uuid" })])).toBe(1);
  });

  it("clamps to 1 when every row is 1", () => {
    expect(_aggregateOverall([row(1), row(1)])).toBe(1);
  });

  it("returns 5 when every row is 5", () => {
    expect(_aggregateOverall([row(5), row(5)])).toBe(5);
  });
});

describe("generateBrandReview — request body shaping", () => {
  it("sends brandkitId (lowercase k) and encodes input.text as a base64 ExtractableFile", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "Our brand voice is bold.", label: "voice.txt" },
      selector: { brandKitId: "kit-1" },
    });

    const body = requestMock.mock.calls[0]![1].body as {
      brandkitId: string;
      input: Record<string, unknown>;
      sections?: unknown;
    };
    expect(body.brandkitId).toBe("kit-1");
    const doc = body.input.document as {
      name: string;
      type: string;
      mimeType: string;
      url: string;
      detail: string;
    };
    expect(doc.name).toBe("voice.txt");
    expect(doc.type).toBe("document");
    expect(doc.mimeType).toBe("text/plain");
    expect(doc.detail).toBe("auto");
    const expectedB64 = Buffer.from("Our brand voice is bold.", "utf8").toString("base64");
    expect(doc.url).toBe(`data:text/plain;base64,${expectedB64}`);
  });

  it("defaults the ExtractableFile name to input.txt when no label is given", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "no label here" },
      selector: { brandKitId: "kit-1" },
    });

    const body = requestMock.mock.calls[0]![1].body as { input: Record<string, unknown> };
    expect((body.input.document as { name: string }).name).toBe("input.txt");
  });

  it("merges input.extra keys into the API input map and omits document when no text", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { extra: { image: { name: "logo.png", type: "image" } } },
      selector: { brandKitId: "kit-1" },
    });

    const body = requestMock.mock.calls[0]![1].body as { input: Record<string, unknown> };
    expect(body.input).toEqual({ image: { name: "logo.png", type: "image" } });
    expect(body.input.document).toBeUndefined();
  });

  it("sends sections when the selector has a non-empty list", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1", sections: [{ sectionId: "sec-1" }] },
    });

    const body = requestMock.mock.calls[0]![1].body as { sections?: unknown };
    expect(body.sections).toEqual([{ sectionId: "sec-1" }]);
  });

  it("omits sections when the selector list is empty", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1", sections: [] },
    });

    const body = requestMock.mock.calls[0]![1].body as { sections?: unknown };
    expect(body.sections).toBeUndefined();
  });

  it("targets the brandreview generate endpoint with POST", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(requestMock.mock.calls[0]![1]).toMatchObject({
      path: "/api/skills/v1/brandreview/generate",
      method: "POST",
    });
  });

  it("threads an AbortSignal through to the transport", async () => {
    requestMock.mockResolvedValue({ reviews: [] });
    const signal = new AbortController().signal;

    await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
      signal,
    });

    expect(requestMock.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe("generateBrandReview — response flattening", () => {
  it("flattens section + field reviews with section rows first", async () => {
    requestMock.mockResolvedValue({
      reviews: [
        {
          sectionId: "sec-1",
          score: 4,
          reason: "Mostly aligned",
          suggestion: "Tighten the headline",
          fields: [{ fieldId: "f-1", score: 2, reason: "Off tone", suggestion: "Rewrite" }],
        },
      ],
    });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults).toHaveLength(2);
    expect(result.sectionResults[0]).toEqual({
      section: "sec-1",
      score: 4,
      explanation: "Mostly aligned",
      suggestions: ["Tighten the headline"],
    });
    expect(result.sectionResults[1]).toEqual({
      section: "sec-1",
      field: "f-1",
      score: 2,
      explanation: "Off tone",
      suggestions: ["Rewrite"],
    });
  });

  it("derives overallScore as the minimum across section + field rows", async () => {
    requestMock.mockResolvedValue({
      reviews: [
        { sectionId: "sec-1", score: 5, fields: [{ fieldId: "f-1", score: 1 }] },
        { sectionId: "sec-2", score: 3 },
      ],
    });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.overallScore).toBe(1);
  });

  it("defaults overallScore to 5 when the response has no reviews", async () => {
    requestMock.mockResolvedValue({ reviews: [] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.overallScore).toBe(5);
    expect(result.sectionResults).toEqual([]);
  });

  it("tolerates a missing reviews array entirely", async () => {
    requestMock.mockResolvedValue({});

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults).toEqual([]);
  });

  it("substitutes (unknown) for a review with no sectionId", async () => {
    requestMock.mockResolvedValue({ reviews: [{ score: 3 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.section).toBe("(unknown)");
  });

  it("omits suggestions when a section has no suggestion string", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: 3 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.suggestions).toBeUndefined();
  });

  it("clamps an out-of-range score above 5 down to 5", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: 9 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.score).toBe(5);
  });

  it("clamps a score below 1 up to 1", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: -2 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.score).toBe(1);
  });

  it("rounds a fractional score to the nearest integer", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: 3.6 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.score).toBe(4);
  });

  it("defaults a non-numeric score to 1", async () => {
    requestMock.mockResolvedValue({
      reviews: [{ sectionId: "sec-1", score: undefined }],
    });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.score).toBe(1);
  });

  it("defaults a NaN score to 1", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: Number.NaN }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults[0]!.score).toBe(1);
  });

  it("tolerates a section with no fields array", async () => {
    requestMock.mockResolvedValue({ reviews: [{ sectionId: "sec-1", score: 3 }] });

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.sectionResults).toHaveLength(1);
  });

  it("returns the raw API response under `raw`", async () => {
    const apiResponse = { reviews: [{ sectionId: "sec-1", score: 4 }] };
    requestMock.mockResolvedValue(apiResponse);

    const result = await generateBrandReview({
      client: FAKE_CLIENT,
      input: { text: "x" },
      selector: { brandKitId: "kit-1" },
    });

    expect(result.raw).toBe(apiResponse);
  });
});
